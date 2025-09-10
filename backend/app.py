from __future__ import annotations
import os
import re
from dotenv import load_dotenv
from flask import ( Flask, request, jsonify, Response, stream_with_context, send_from_directory )
from flask_cors import CORS
import requests
import logging
import yaml
import json
import asyncio
import aiohttp
from jsonschema import validate, ValidationError
import sys
import anthropic
import openai 
from pathlib import Path
from typing import Optional, Tuple, Dict, Union, Any
from functools import partial
from uuid import uuid4
from slugify import slugify
from contextlib import suppress
from redis import Redis
from rq import Queue
from rq.job import Job
import time
from datetime import timedelta


# Load environment variables from .env
load_dotenv()  



# Path to the directory *this* file lives in
HERE = Path(__file__).resolve().parent        # …/backend
# Go up to the project root and build the rest
ROOT =  Path(__file__).resolve().parents[1]  
BUILD_DIR = ROOT / "frontend" / "build"                  
DATA_DIR = ROOT / "data"         

CUSTOM_MAP_FILE = DATA_DIR / "custom_mappings.json"

JUDGE_TIMEOUT = int(os.getenv("JUDGE_TIMEOUT", "60"))



def load_custom_mappings() -> dict[str, str]:
    """
   Read any previously-saved custom mappings.  If the file is missing or
    corrupt we just return an empty dict (and log the error).
    """
    if CUSTOM_MAP_FILE.exists():
        try:
            return json.loads(CUSTOM_MAP_FILE.read_text())
        except Exception:
            logging.exception("Corrupt custom_mappings.json – starting fresh")
    return {}

GRANULAR_PROGRESS_DEFAULT = os.getenv("GRANULAR_PROGRESS", "1") in ("1","true","True")
async def _run_evaluation_job(job_id: str, data: dict):
    """
    Run the whole evaluation in the background.
    Publishes per-run NDJSON events to Redis Pub/Sub and updates a progress JSON state.
    """
    # FIRST pull mappings sent with the job, then augment from disk
    MAPPINGS.update(data.get("mappings") or {})
    MAPPINGS.update(load_custom_mappings())

    user_api_keys: Dict[str, str] = data.get("api_keys", {})
    incoming_list = data.get("system_prompts")
    if incoming_list and isinstance(incoming_list, list):
        system_prompts = [clean_prompt(p) or default_system_prompt for p in incoming_list]
    else:
        system_prompts = [clean_prompt(data.get("system_prompt")) or default_system_prompt]

    selected_test_cases = data.get("test_cases")
    models = data.get("models")
    test_limit = data.get("testLimit")
    judge_model = data.get("judgeModel")
    runs_per_instance = max(1, min(int(data.get("runs_per_instance", 3)), 5))
    granular_progress = bool(data.get("granularProgress", GRANULAR_PROGRESS_DEFAULT))
    prompts_count = len(system_prompts)
    models_count  = len(models or [])

    # quick validation mirrors your route checks
    if judge_model and judge_model in models:
        write_state(job_id, status="failed", error="Judge model must be different")
        await rpub(job_id, {"type": "error", "error": "Judge model must be different from generation models"})
        return
    if not selected_test_cases or not models:
        write_state(job_id, status="failed", error="Missing test_cases or models")
        await rpub(job_id, {"type": "error", "error": "Please provide test cases and models."})
        return

    # Pre-count total work (for progress). We count "runs per utterance".
    requested_test_ids: set[int] = set()
    raw_ids = data.get("test_ids", [])
    if isinstance(raw_ids, list):
        for v in raw_ids:
            try:
                requested_test_ids.add(int(str(v).strip()))
            except:
                pass
    elif raw_ids is not None:
        for piece in str(raw_ids).split(","):
            piece = piece.strip()
            if piece.isdigit():
                requested_test_ids.add(int(piece))

    total_units = 0
    try:
        for tcf in selected_test_cases:
            path = TEST_CASES_DIR / tcf
            tcs = None
            
            # Try to load from disk first
            if path.exists():
                try:
                    tcs = yaml.safe_load(path.read_text("utf-8"))
                    logging.info(f"Loaded test case file {tcf} from disk with {len(tcs) if isinstance(tcs, list) else 'non-list'} items")
                except Exception as e:
                    logging.error(f"Failed to load test case file {tcf} from disk: {e}")
            
            # If not on disk, try Redis
            if tcs is None:
                try:
                    redis_client = get_redis_client()
                    tc_raw = redis_client.get(f"testcase:{tcf}")
                    if tc_raw:
                        tcs = yaml.safe_load(tc_raw.decode('utf-8'))
                        logging.info(f"Loaded test case file {tcf} from Redis with {len(tcs) if isinstance(tcs, list) else 'non-list'} items")
                    else:
                        logging.error(f"Test case file not found in disk or Redis: {tcf}")
                        continue
                except Exception as e:
                    logging.error(f"Failed to load test case file {tcf} from Redis: {e}")
                    continue
            # filter cases
            filtered = [tc for tc in tcs if not requested_test_ids or tc.get("test-number") in requested_test_ids]
            logging.info(f"Filtered to {len(filtered)} test cases from {len(tcs)} total")
            if test_limit:
                try:
                    filtered = filtered[:max(0, int(test_limit))]
                except Exception as e:
                    logging.error(f"Failed to apply test limit: {e}")
            for tc in filtered:
                utts = tc.get("utterances", [])
                per_utt = runs_per_instance
                if granular_progress:
                    # For granular progress, we get both model responses AND judge evaluations
                    # Model responses: runs_per_instance * prompts_count * models_count
                    # Judge evaluations: runs_per_instance * prompts_count * models_count (if judge model is specified)
                    per_utt *= prompts_count * models_count
                    if judge_model:
                        per_utt *= 2  # Double the count to include judge evaluations
                total_units += per_utt * len(utts)
    except Exception as e:
        logging.error(f"Error processing test cases: {e}")
        import traceback
        logging.error(f"Traceback: {traceback.format_exc()}")

    # Persist state and publish start event (include useful context for logs)
    write_state(job_id, status="started", completed=0, total=total_units)
    await rpub(job_id, {
        "type": "start",
        "total": total_units,
        "runs_per_instance": runs_per_instance,
        "granular": granular_progress
    })
    try:
        # Log complete job context at start for traceability
        job_state = read_state(job_id)
        user_id = job_state.get("user_id") or data.get("user_id")
        context = {
            "job_id": job_id,
            "total_units": total_units,
            "runs_per_instance": runs_per_instance,
            "granular": granular_progress,
            "models": models,
            "test_cases": selected_test_cases,
            "judgeModel": judge_model,
            "system_prompts": system_prompts,
        }
        logging.info("Job %s start context: %s", job_id, json.dumps(sanitize_for_logging(context)))
        if user_id:
            log_user_activity(str(user_id), "job_started", sanitize_for_logging(context))
    except Exception:
        logging.exception("Failed to log job start context for %s", job_id)

    # Track progress for nested closures (one_run uses nonlocal completed)
    completed = 0
    
    # Actual run
    connector = aiohttp.TCPConnector(limit=int(os.getenv("OUTBOUND_HTTP_LIMIT", "40")))
    timeout = aiohttp.ClientTimeout(total=0)  # No timeout
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        sem = asyncio.Semaphore(int(os.getenv("OUTBOUND_CONCURRENCY", "6")))
        logging.info(f"Starting evaluation with {total_units} total units, {runs_per_instance} runs per instance")

        async def guarded(coro):
            async with sem:
                return await coro

        # -------- your existing helpers (trimmed from /evaluate-test-cases) ----------
        async def one_run(
            run_idx: int,
            *,
            turn_idx: int,
            model_input: str,
            canonical_input: str,
            paraphrases: list,
            expected_output: dict,
            datasource: dict,
            datasource_fields: list,
            test_case_filename: str,
            test_number: Union[str, int],
            labels: list,
            previous_turns: list,
        ):
            row_id = f"{test_case_filename}|{test_number}|{turn_idx}|run{run_idx}"
            model_outputs: dict[str, str] = {}
            pass_fail_results: dict[str, bool] = {}
            model_vega_specs: dict[str, object] = {}
            judge_evaluations: dict[str, object] = {}

            # NEW: stream prompt×model fragments as they finish
            nonlocal completed
            task_coros = []
            for p_idx, sp in enumerate(system_prompts, start=1):
                def _builder(p: int, sys_prompt: str):
                    async def _gen(model: str):
                        synthetic_key = f"{model}|prompt{p}"
                        try:
                            raw = await guarded(call_model_api(
                                session, model, model_input,
                                datasource=datasource,
                                system_prompt=sys_prompt,
                                api_keys=user_api_keys,
                                conversation_history=previous_turns,
                            ))
                            try:
                                parsed = json.loads(raw)
                            except json.JSONDecodeError:
                                parsed = {"content": {}, "_error": raw.strip()}
                            notional_spec = parsed.get("content", parsed)
                            vega = None if "_error" in parsed else convert_notional_to_vega(notional_spec, datasource_fields)
                            ok = vega is not None and "_error" not in parsed
                            return synthetic_key, raw, ok, vega
                        except Exception as exc:
                            logging.exception("Failed processing %s: %s", synthetic_key, exc)
                            return synthetic_key, f"Error: {exc}", False, None
                    return _gen
                task_coros.extend(_builder(p_idx, sp)(m) for m in models)

            # Stream fragments as they complete
            logging.info(f"Processing {len(task_coros)} tasks for {row_id}")
            for fut in asyncio.as_completed([asyncio.create_task(c) for c in task_coros]):
                synthetic_key, raw, ok, vega = await fut
                logging.info(f"Completed task {synthetic_key} for {row_id}")
                model_outputs[synthetic_key] = raw
                pass_fail_results[synthetic_key] = ok
                model_vega_specs[synthetic_key] = vega

                if granular_progress:
                    frag = {
                        "type": "row-fragment",
                        "row_id": row_id,
                        "file": test_case_filename,
                        "payload": {
                            "synthetic_key": synthetic_key,
                            "raw": raw,
                            "ok": ok,
                            "vega": vega,
                        },
                    }
                    await rpub(job_id, frag)
                    persist_row(job_id, frag)
                    completed += 1
                    write_state(job_id, status="started", completed=completed, total=total_units)
                    await rpub(job_id, {"type": "progress", "completed": completed, "total": total_units})

            if judge_model:
                logging.info(f"Starting judge evaluations for {row_id}")
                judge_evaluations[judge_model] = {}
                
                # Create judge evaluation tasks for streaming
                judge_tasks = []
                for synth_key in list(model_outputs.keys()):
                    base_model = synth_key.split("|")[0]
                    if base_model == judge_model:
                        continue
                    model_response = model_outputs[synth_key]
                    
                    # Create tasks for all judge metrics
                    async def create_judge_tasks(synth_key, model_response):
                        tasks = {}
                        
                        # Relevance
                        try:
                            tasks["relevance"] = await guarded(call_judge_model_api_metric(
                                session, judge_model, model_input, model_response,
                                RELEVANCE_INSTRUCTIONS, api_keys=user_api_keys))
                        except Exception as e:
                            tasks["relevance"] = {"relevance": 1, "explanation": f"Error: {e}"}
                        
                        # Correctness
                        try:
                            tasks["correctness"] = await guarded(call_judge_model_api_metric(
                                session, judge_model, model_input, model_response,
                                CORRECTNESS_INSTRUCTIONS, api_keys=user_api_keys))
                        except Exception as e:
                            tasks["correctness"] = {"correctness": 1, "explanation": f"Error: {e}"}
                        
                        # Assumptions
                        try:
                            tasks["assumptions"] = await guarded(call_judge_model_api_metric(
                                session, judge_model, model_input, model_response,
                                ASSUMPTIONS_INSTRUCTIONS, api_keys=user_api_keys))
                        except Exception as e:
                            tasks["assumptions"] = {"assumptions": 1, "explanation": f"Error: {e}"}
                        
                        # Insightfulness
                        try:
                            tasks["insightfulness"] = await guarded(call_judge_model_api_metric(
                                session, judge_model, model_input, model_response,
                                INSIGHTFULNESS_INSTRUCTIONS, api_keys=user_api_keys))
                        except Exception as e:
                            tasks["insightfulness"] = {"insightfulness": 1, "explanation": f"Error: {e}"}
                        
                        # Follow-up relevance
                        if turn_idx == 0:
                            tasks["follow_up_relevance"] = {"follow_up_relevance": None, "explanation": "No previous turns"}
                        else:
                            pieces = []
                            for turn in previous_turns:
                                u = turn["user"]
                                prev_resp = turn["responses"].get(synth_key, "")
                                pieces.append(f"Previous User: {u}\nPrevious Model: {prev_resp}")
                            context_plus_query = "\n\n".join(pieces) + "\n\n" + model_input
                            try:
                                tasks["follow_up_relevance"] = await guarded(call_judge_model_api_metric(
                                    session, judge_model, context_plus_query, model_response,
                                    FOLLOWUP_INSTRUCTIONS, api_keys=user_api_keys))
                            except Exception as e:
                                tasks["follow_up_relevance"] = {"follow_up_relevance": 1, "explanation": f"Error: {e}"}
                        
                        # Coherence
                        try:
                            tasks["coherence"] = await guarded(call_judge_model_api_metric(
                                session, judge_model, model_input, model_response,
                                COHERENCE_INSTRUCTIONS, api_keys=user_api_keys))
                        except Exception as e:
                            tasks["coherence"] = {"coherence": 1, "explanation": f"Error: {e}"}
                        
                        return synth_key, tasks
                    
                    judge_tasks.append(create_judge_tasks(synth_key, model_response))
                
                # Stream judge evaluations as they complete
                if judge_tasks:
                    logging.info(f"Processing {len(judge_tasks)} judge evaluation tasks for {row_id}")
                    completed_judge_tasks = 0
                    
                    # Add timeout to prevent hanging - limit total judge evaluation time to 10 minutes
                    try:
                        for fut in asyncio.as_completed([asyncio.create_task(t) for t in judge_tasks]):
                            try:
                                synth_key, judge_results = await fut  # No timeout for judge tasks
                                completed_judge_tasks += 1
                                logging.info(f"Completed judge evaluation {completed_judge_tasks}/{len(judge_tasks)} for {synth_key}")
                            
                                judge_evaluations[judge_model][synth_key] = {
                                    "relevance": judge_results["relevance"].get("relevance", 1),
                                    "relevance_explanation": judge_results["relevance"].get("explanation", ""),
                                    "correctness": judge_results["correctness"].get("correctness", 1),
                                    "correctness_explanation": judge_results["correctness"].get("explanation", ""),
                                    "assumptions": judge_results["assumptions"].get("assumptions", 1),
                                    "assumptions_explanation": judge_results["assumptions"].get("explanation", ""),
                                    "insightfulness": judge_results["insightfulness"].get("insightfulness", 1),
                                    "insightfulness_explanation": judge_results["insightfulness"].get("explanation", ""),
                                    "follow_up_relevance": judge_results["follow_up_relevance"].get("follow_up_relevance"),
                                    "follow_up_relevance_explanation": judge_results["follow_up_relevance"].get("explanation", ""),
                                    "coherence": judge_results["coherence"].get("coherence", 1),
                                    "coherence_explanation": judge_results["coherence"].get("explanation", "")
                                }
                                
                                # Stream judge evaluation fragment if granular progress is enabled
                                if granular_progress:
                                    judge_frag = {
                                        "type": "judge-fragment",
                                        "row_id": row_id,
                                        "file": test_case_filename,
                                        "payload": {
                                            "synthetic_key": synth_key,
                                            "judge_model": judge_model,
                                            "judge_results": judge_evaluations[judge_model][synth_key],
                                        },
                                    }
                                    await rpub(job_id, judge_frag)
                                    persist_row(job_id, judge_frag)
                                    completed += 1
                                    write_state(job_id, status="started", completed=completed, total=total_units)
                                    await rpub(job_id, {"type": "progress", "completed": completed, "total": total_units})
                                    
                            except asyncio.TimeoutError:
                                logging.warning(f"Judge evaluation timed out for {row_id}, skipping")
                                continue
                            except Exception as e:
                                logging.error(f"Error in judge evaluation for {row_id}: {e}")
                                continue
                    except Exception as e:
                        logging.error(f"Error in judge evaluation loop for {row_id}: {e}")

            payload = {
                "file": test_case_filename,
                "row_id": row_id,
                "run_idx": run_idx,
                "run_count": runs_per_instance,
                "data": {
                    "canonical": canonical_input,
                    "paraphrases": paraphrases,
                    "expected_output": expected_output,
                    "model_outputs": model_outputs,
                    "modelVegaSpecs": model_vega_specs,
                    "pass_fail": pass_fail_results,
                    "judge_evaluations": judge_evaluations,
                },
            }
            return payload

        # -------- run all test cases and stream events --------
        try:
            logging.info(f"Starting evaluation loop for {len(selected_test_cases)} test case files")
            for test_case_filename in selected_test_cases:
                # cooperative cancel point
                if is_cancelled(job_id):
                    write_state(job_id, status="cancelled", completed=completed, total=total_units)
                    await rpub(job_id, {"type": "done", "status": "cancelled"})
                    return

                if test_case_filename not in MAPPINGS:
                    # Try to get mapping from Redis as fallback
                    try:
                        redis_client = get_redis_client()
                        mapping = redis_client.get(f"mapping:{test_case_filename}")
                        if mapping:
                            MAPPINGS[test_case_filename] = mapping.decode("utf-8")
                            logging.info(f"Loaded mapping for {test_case_filename} from Redis")
                    except Exception as e:
                        logging.error(f"Failed to load mapping from Redis for {test_case_filename}: {e}")
                
                if test_case_filename not in MAPPINGS:
                    await rpub(job_id, {"type": "error", "error": f"Invalid test case file: {test_case_filename}"})
                    continue

                test_case_path = TEST_CASES_DIR / test_case_filename
                datasource_filename = MAPPINGS[test_case_filename]
                datasource_path = DATASOURCES_DIR / datasource_filename

                # Load test cases with Redis fallback
                test_cases = None
                if test_case_path.exists():
                    try:
                        test_cases = yaml.safe_load(test_case_path.read_text("utf-8"))
                    except Exception as e:
                        logging.error(f"Failed to load test case file {test_case_filename} from disk: {e}")

                if test_cases is None:
                    try:
                        redis_client = get_redis_client()
                        tc_raw = redis_client.get(f"testcase:{test_case_filename}")
                        if tc_raw:
                            test_cases = yaml.safe_load(tc_raw.decode('utf-8'))
                            logging.info(f"Loaded test case file {test_case_filename} from Redis for evaluation")
                        else:
                            await rpub(job_id, {"type": "error", "error": f"Test case file '{test_case_filename}' not found in disk or Redis."})
                            continue
                    except Exception as e:
                        logging.error(f"Failed to load test case file {test_case_filename} from Redis: {e}")
                        await rpub(job_id, {"type": "error", "error": f"Failed to load test case file '{test_case_filename}': {e}"})
                        continue

                # Load datasource with Redis fallback
                datasource = None
                if datasource_path.exists():
                    try:
                        datasource = yaml.safe_load(datasource_path.read_text("utf-8"))
                    except Exception as e:
                        logging.error(f"Failed to load datasource file {datasource_filename} from disk: {e}")

                if datasource is None:
                    try:
                        redis_client = get_redis_client()
                        ds_raw = redis_client.get(f"datasource:{datasource_filename}")
                        if ds_raw:
                            datasource = yaml.safe_load(ds_raw.decode('utf-8'))
                            logging.info(f"Loaded datasource file {datasource_filename} from Redis for evaluation")
                        else:
                            await rpub(job_id, {"type": "error", "error": f"Datasource file '{datasource_filename}' not found in disk or Redis."})
                            continue
                    except Exception as e:
                        logging.error(f"Failed to load datasource file {datasource_filename} from Redis: {e}")
                        await rpub(job_id, {"type": "error", "error": f"Failed to load datasource file '{datasource_filename}': {e}"})
                        continue

                datasource_fields = datasource.get("datasourceFields", [])

                # Filter tests
                filtered_cases = []
                logging.info(f"Filtering {len(test_cases)} test cases with requested_test_ids: {requested_test_ids}")
                for tc in test_cases:
                    tn = tc.get("test-number")
                    logging.info(f"Test case {tn}: requested_test_ids={requested_test_ids}, including={not requested_test_ids or tn in requested_test_ids}")
                    if not requested_test_ids or tn in requested_test_ids:
                        filtered_cases.append(tc)
                logging.info(f"Filtered to {len(filtered_cases)} test cases")
                if test_limit:
                    try:
                        filtered_cases = filtered_cases[:max(0, int(test_limit))]
                    except Exception:
                        pass
                if requested_test_ids and not filtered_cases:
                    await rpub(job_id, {
                        "type": "error",
                        "error": f"No tests found in {test_case_filename} matching test_ids {sorted(requested_test_ids)}"
                    })
                    continue

                # Iterate utterances
                logging.info(f"Starting to process {len(filtered_cases)} filtered test cases")
                for tc in filtered_cases:
                    utterances = tc.get("utterances", []) or []
                    test_number = tc.get("test-number")
                    logging.info(f"Processing test case {test_number} with {len(utterances)} utterances")
                    # Keep per-run histories for follow-up scoring
                    previous_turns_runs: list[list[dict]] = [[] for _ in range(runs_per_instance)]

                    for turn_idx, utterance in enumerate(utterances):
                        logging.info(f"Processing utterance {turn_idx} for test case {test_number}")
                        if isinstance(utterance, str):
                            canonical_input = utterance
                            paraphrases = []
                        else:
                            canonical_input = (
                                utterance.get("canonical")
                                or utterance.get("utterance")
                                or utterance.get("question")
                            )
                            paraphrases = utterance.get("paraphrase") or utterance.get("paraphrases") or []
                        model_input = canonical_input or (paraphrases[0] if paraphrases else None)
                        if not model_input:
                            await rpub(job_id, {"type": "error", "error": f"No text for {test_case_filename} #{test_number} turn {turn_idx} — skipped"})
                            continue

                        labels = utterance.get("labels", [])
                        expected_output = utterance.get("notional-spec-out") or utterance.get("notional_spec_out")

                        # Run all repeats for this utterance concurrently
                        logging.info(f"Creating {runs_per_instance} tasks for utterance {turn_idx}")
                        created: list[asyncio.Task] = []
                        async with asyncio.TaskGroup() as tg:
                            for r_idx in range(runs_per_instance):
                                created.append(
                                    tg.create_task(
                                        one_run(
                                            run_idx=r_idx,
                                            turn_idx=turn_idx,
                                            model_input=model_input,
                                            canonical_input=canonical_input,
                                            paraphrases=paraphrases,
                                            expected_output=expected_output,
                                            datasource=datasource,
                                            datasource_fields=datasource_fields,
                                            test_case_filename=test_case_filename,
                                            test_number=test_number,
                                            labels=labels,
                                            previous_turns=previous_turns_runs[r_idx],
                                        ),
                                        name=f"run-{r_idx}",
                                    )
                                )

                        # Publish rows as they complete (TaskGroup guarantees they're all done)
                        logging.info(f"All tasks completed for utterance {turn_idx}, publishing results")
                        for task in created:
                            try:
                                row_payload = task.result()
                            except Exception as exc:
                                row_payload = {
                                    "file": test_case_filename,
                                    "row_id": f"{test_case_filename}|{test_number}|{turn_idx}|{task.get_name()}",
                                    "error": f"Unhandled error: {exc}",
                                }
                            # publish final row
                            await rpub(job_id, {"type": "row", "payload": row_payload})
                            persist_row(job_id, {"type": "row", "payload": row_payload})
                            # also log the full row payload for auditing (can be large)
                            try:
                                logging.info("Job %s row emitted: %s", job_id, json.dumps(sanitize_for_logging(row_payload)))
                            except Exception:
                                pass
                            # progress bump only if not granular (granular already bumped per fragment)
                            if not granular_progress:
                                completed += 1
                                write_state(job_id, status="started", completed=completed, total=total_units)
                                await rpub(job_id, {"type": "progress", "completed": completed, "total": total_units})

                            # Update history for follow-up judging in next turns
                            try:
                                r_idx = row_payload.get("run_idx", 0)
                                previous_turns_runs[r_idx].append({
                                    "user": model_input,
                                    "responses": row_payload.get("data", {}).get("model_outputs", {}),
                                })
                            except Exception:
                                pass
        except Exception as e:
            logging.error(f"Evaluation failed for job {job_id}: {e}")
            write_state(job_id, status="failed", error=str(e), completed=completed, total=total_units)
            
            # Log job failure with user_id
            job_state = read_state(job_id)
            user_id = job_state.get("user_id")
            if user_id:
                log_user_activity(user_id, "job_failed", {
                    "job_id": job_id,
                    "error": str(e),
                    "status": "failed",
                    "completed": completed,
                    "total": total_units
                })
            
            await rpub(job_id, {"type": "error", "error": str(e)})
            await rpub(job_id, {"type": "done", "status": "failed"})
            return


        # If we get here, all rows were emitted successfully
        logging.info(f"Evaluation completed successfully for job {job_id}")
        write_state(job_id, status="finished", completed=total_units, total=total_units)
        
        # Log job completion with user_id
        job_state = read_state(job_id)
        user_id = job_state.get("user_id")
        if user_id:
            log_user_activity(user_id, "job_completed", {
                "job_id": job_id,
                "status": "completed",
                "completed": total_units,
                "total": total_units
            })
        
        await rpub(job_id, {"type": "done", "status": "finished"})



# Initialize Flask app
app = Flask(__name__, static_folder=str(BUILD_DIR), static_url_path="/")

CORS(app)  # Enable CORS for all routes

logging.basicConfig(level=logging.INFO)

# Redis / RQ (background jobs + pubsub)
REDIS_URL = (
    os.getenv("REDIS_TLS_URL")      # Heroku Redis (TLS)
    or os.getenv("REDIS_URL")       # Heroku Redis (non-TLS)
    or os.getenv("REDISCLOUD_URL")  # Redis Cloud add-on
    or "redis://localhost:6379/0"   # dev fallback
)

# Enhanced Redis configuration for concurrent users
REDIS_CONFIG = {
    'host': 'localhost' if 'localhost' in REDIS_URL else None,
    'port': 6379 if 'localhost' in REDIS_URL else None,
    'url': REDIS_URL if 'localhost' not in REDIS_URL else None,
    'socket_timeout': None,
    'socket_connect_timeout': None,
    'socket_keepalive': True,
    'socket_keepalive_options': {},
    'retry_on_timeout': True,
    'health_check_interval': 30,
    'max_connections': int(os.getenv("REDIS_MAX_CONNECTIONS", "20")),
    'decode_responses': False,  # Keep as bytes for compatibility
}

# Create Redis connection with connection pooling
if 'localhost' in REDIS_URL:
    # For localhost, use host/port configuration
    redis = Redis(
        host=REDIS_CONFIG['host'],
        port=REDIS_CONFIG['port'],
        socket_timeout=REDIS_CONFIG['socket_timeout'],
        socket_connect_timeout=REDIS_CONFIG['socket_connect_timeout'],
        socket_keepalive=REDIS_CONFIG['socket_keepalive'],
        socket_keepalive_options=REDIS_CONFIG['socket_keepalive_options'],
        retry_on_timeout=REDIS_CONFIG['retry_on_timeout'],
        health_check_interval=REDIS_CONFIG['health_check_interval'],
        max_connections=REDIS_CONFIG['max_connections'],
        decode_responses=REDIS_CONFIG['decode_responses']
    )
else:
    # For remote Redis, use URL with additional config
    redis = Redis.from_url(
        REDIS_URL,
        socket_timeout=REDIS_CONFIG['socket_timeout'],
        socket_connect_timeout=REDIS_CONFIG['socket_connect_timeout'],
        socket_keepalive=REDIS_CONFIG['socket_keepalive'],
        socket_keepalive_options=REDIS_CONFIG['socket_keepalive_options'],
        retry_on_timeout=REDIS_CONFIG['retry_on_timeout'],
        health_check_interval=REDIS_CONFIG['health_check_interval'],
        max_connections=REDIS_CONFIG['max_connections'],
        decode_responses=REDIS_CONFIG['decode_responses']
    )

# Create RQ queue with enhanced configuration
q = Queue("eval", connection=redis, default_timeout=int(os.getenv("RQ_JOB_TIMEOUT", "604800")))

def get_redis_client():
    """Return the Redis client instance with connection pooling."""
    return redis

def get_redis_connection():
    """Get a fresh Redis connection from the pool for long-running operations."""
    return redis.connection_pool.get_connection('get_redis_connection')

def redis_operation_with_retry(operation, max_retries=3, retry_delay=0.1):
    """
    Execute a Redis operation with retry logic for better concurrent handling.
    
    Args:
        operation: Function that performs the Redis operation
        max_retries: Maximum number of retry attempts
        retry_delay: Delay between retries in seconds
    
    Returns:
        Result of the Redis operation
    """
    import time
    last_exception = None
    
    for attempt in range(max_retries + 1):
        try:
            return operation()
        except (redis.ConnectionError, redis.TimeoutError, redis.RedisError) as e:
            last_exception = e
            if attempt < max_retries:
                logging.warning(f"Redis operation failed (attempt {attempt + 1}/{max_retries + 1}): {e}")
                time.sleep(retry_delay * (2 ** attempt))  # Exponential backoff
            else:
                logging.error(f"Redis operation failed after {max_retries + 1} attempts: {e}")
                raise last_exception
        except Exception as e:
            # For non-Redis errors, don't retry
            logging.error(f"Non-Redis error in operation: {e}")
            raise e

# Retention / control
JOB_TTL_SECS = int(os.getenv("JOB_TTL_SECS", "86400"))          # 24h
CANCEL_KEY_FMT = "job:{job_id}:cancel"

# persisted rows (for reconnects / incremental fetch)
ROWS_KEY_FMT = "job:{job_id}:rows"

def _rows_key(job_id: str) -> str:
    return ROWS_KEY_FMT.format(job_id=job_id)

def persist_row(job_id: str, payload: dict) -> None:
    """
    Append one serialized row/fragment to a Redis list and refresh TTL.
    """
    def _persist_operation():
        line = json.dumps(payload, separators=(",", ":"))
        pipe = redis.pipeline()
        key = _rows_key(job_id)
        pipe.rpush(key, line)
        pipe.expire(key, JOB_TTL_SECS)
        return pipe.execute()
    
    try:
        redis_operation_with_retry(_persist_operation)
    except Exception:
        logging.exception("persist_row failed")

# Event/State helpers
def _state_key(job_id: str) -> str:
    return f"job:{job_id}:state"

def _channel(job_id: str) -> str:
    return f"job:{job_id}:events"

def write_state(job_id: str, **patch):
    """Merge 'patch' into the JSON state stored in Redis."""
    def _write_operation():
        cur = redis.get(_state_key(job_id))
        cur_obj = json.loads(cur) if cur else {}
        cur_obj.update(patch)
        # store with TTL so old jobs get cleaned up
        redis.set(_state_key(job_id), json.dumps(cur_obj), ex=JOB_TTL_SECS)
        return cur_obj
    
    try:
        return redis_operation_with_retry(_write_operation)
    except Exception:
        logging.exception("write_state failed")
        return {}

def log_user_activity(user_id: str, action: str, details: dict):
    """Log user activity to Redis with TTL for 1 month retention."""
    try:
        log_entry = {
            "user_id": user_id,
            "timestamp": time.time(),
            "action": action,
            **details
        }
        
        # Store in Redis with 30-day TTL
        log_key = f"user_log:{user_id}:{int(time.time())}"
        redis.setex(log_key, 30 * 24 * 60 * 60, json.dumps(log_entry))
        
        # Also log to standard logging with user context
        logging.info(f"User {user_id}: {action} - {json.dumps(details)}")
        
    except Exception as e:
        logging.error(f"Failed to log user activity for {user_id}: {e}")

def _mask_secret(value: str) -> str:
    try:
        if not isinstance(value, str):
            value = str(value)
        prefix = value[:4]
        suffix = value[-2:] if len(value) > 6 else ""
        return f"{prefix}…{suffix} (len={len(value)})"
    except Exception:
        return "***"

def sanitize_for_logging(obj: Any) -> Any:
    """Deep-copy-like sanitizer that masks sensitive secrets before logging.
    - Masks values under the 'api_keys' object
    - Leaves other fields intact so we preserve the full payload shape
    """
    try:
        if isinstance(obj, dict):
            out = {}
            for k, v in obj.items():
                if k == "api_keys" and isinstance(v, dict):
                    out[k] = { sk: _mask_secret(sv) for sk, sv in v.items() }
                else:
                    out[k] = sanitize_for_logging(v)
            return out
        if isinstance(obj, list):
            return [sanitize_for_logging(v) for v in obj]
        return obj
    except Exception:
        return "<unserializable>"

def read_state(job_id: str) -> dict:
    def _read_operation():
        cur = redis.get(_state_key(job_id))
        return json.loads(cur) if cur else {}
    
    try:
        return redis_operation_with_retry(_read_operation)
    except Exception:
        logging.exception("read_state failed")
        return {}

def set_cancel(job_id: str) -> None:
    def _set_cancel_operation():
        redis.set(CANCEL_KEY_FMT.format(job_id=job_id), "1", ex=JOB_TTL_SECS)
    
    try:
        redis_operation_with_retry(_set_cancel_operation)
    except Exception:
        logging.exception("set_cancel failed")

def is_cancelled(job_id: str) -> bool:
    def _is_cancelled_operation():
        return redis.get(CANCEL_KEY_FMT.format(job_id=job_id)) == b"1"
    
    try:
        return redis_operation_with_retry(_is_cancelled_operation)
    except Exception:
        logging.exception("is_cancelled failed")
        return False

async def rpub(job_id: str, payload: dict):
    """Publish one NDJSON-ready event to pubsub without blocking the loop."""
    loop = asyncio.get_running_loop()
    line = json.dumps(payload, separators=(",", ":"))
    await loop.run_in_executor(None, redis.publish, _channel(job_id), line)
    
def spub(job_id: str, payload: dict) -> None:
    """Synchronous publish (safe for non-async contexts)."""
    try: 
       redis.publish(_channel(job_id), json.dumps(payload, separators=(",", ":")))
    except Exception:
        pass

def background_eval(data: dict, job_id: str) -> None:
    """RQ worker entrypoint: run async job in its own loop."""
    try:
        asyncio.run(_run_evaluation_job(job_id, data))
    except Exception as e:
        write_state(job_id, status="failed", error=str(e))
        spub(job_id, {"type": "error", "error": str(e)})
        spub(job_id, {"type": "done", "status": "failed"})

#  Gateway helper – one place to POST & return text                           
async def _post_json(session, url: str, headers: Dict[str, str], payload: Dict[str, Any]) -> str:
    """
    Fire POST request, raise on non-200, return raw response text.
    """
    async with session.post(url, headers=headers, json=payload) as resp:
      raw = await resp.text()
      if resp.status != 200:
          logging.error("Gateway %s → %s", resp.status, raw[:400])
          raise aiohttp.ClientResponseError(
              resp.request_info, resp.history,
              status=resp.status, message=raw
          )
      # DeepSeek sometimes replies with plain string
      return raw

BASE_MAPPINGS = {
    "demo_tests-tc.v2.yaml": "alpo-strange-goodall-1894073.yaml",
    "call-center-tc.v2.yaml": "alpo-call-center.yaml",
    "rcg-retail-sales-tc.v2.yaml": "alpo-retail-nto.yaml",
    "tech-sales-cloud-tc.v2.yaml": "alpo-sales-cloud.yaml",
    "busy-darwin-tc.v2.yaml": "alpo-busy-darwin-5480583.yaml",
    "busy-darwin-tc.yaml": "alpo-busy-darwin-5480583.yaml",
    "busy-dirac-tc.v2.yaml": "alpo-busy-dirac-5576198.yaml",
    "busy-dirac-tc.yaml": "alpo-busy-dirac-5576198.yaml",
    "competent-thompson-tc.v2.yaml": "alpo-competent-thompson-5573741.yaml",
    "competent-thompson-tc.yaml": "alpo-competent-thompson-5573741.yaml",
    "crazy-hugle-tc.v2.yaml": "alpo-crazy-hugle-5056596.yaml",
    "crazy-hugle-tc.yaml": "alpo-crazy-hugle-5056596.yaml",
    "elastic-dewdney-tc.v2.yaml": "alpo-elastic-dewdney-5563485.yaml",
    "elastic-dewdney-tc.yaml": "alpo-elastic-dewdney-5563485.yaml",
    "exciting-hawking-tc.v2.yaml": "alpo-exciting-hawking-5570874.yaml",
    "exciting-hawking-tc.yaml": "alpo-exciting-hawking-5570874.yaml",
    "hardcore-shockley-tc.v2.yaml": "alpo-hardcore-shockley-2292340.yaml",
    "hardcore-shockley-tc.yaml": "alpo-hardcore-shockley-2292340.yaml",
    "inspiring-rubin-tc.v2.yaml": "alpo-inspiring-rubin-5576171.yaml",
    "inspiring-rubin-tc.yaml": "alpo-inspiring-rubin-5576171.yaml",
    "pedantic-beaver-tc.v2.yaml": "alpo-pedantic-beaver-3862887.yaml",
    "pedantic-beaver-tc.yaml": "alpo-pedantic-beaver-3862887.yaml",
    "romantic-ishizaka-tc.v2.yaml": "alpo-romantic-ishizaka-5217239.yaml",
    "romantic-ishizaka-tc.yaml": "alpo-romantic-ishizaka-5217239.yaml",
    "sad-kapitsa-tc.v2.yaml": "alpo-strange-goodall-1894073.yaml",
    "sad-kapitsa-tc.yaml": "alpo-strange-goodall-1894073.yaml",
    "vigilant-goodall-tc.v2.yaml": "alpo-vigilant-goodall-3410424.yaml",
    "vigilant-goodall-tc.yaml": "alpo-vigilant-goodall-3410424.yaml",
    "superstore-testcases.yaml": "superstore-datasource.yaml",
}

# Merge built-ins with anything we loaded from disk
MAPPINGS: dict = {**BASE_MAPPINGS, **load_custom_mappings()}

def save_custom_mappings():
    dynamic = {k: v for k, v in MAPPINGS.items() if k not in BASE_MAPPINGS}
    CUSTOM_MAP_FILE.write_text(json.dumps(dynamic, indent=2))

CLAUDE_MODEL_IDS = {
              "anthropic-claude-3.7-sonnet": "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
              "anthropic-claude-opus-4":     "us.anthropic.claude-opus-4-20250514-v1:0",
          }

# Friendly‑name → actual OpenAI model id
OPENAI_MODEL_IDS = {
    "openai-gpt-5":           "gpt-5",           # GPT-5 (latest flagship model)
    "openai-gpt-5-mini":      "gpt-5-mini",      # GPT-5 Mini (faster, more efficient)
    "openai-gpt-5-nano":      "gpt-5-nano",      # GPT-5 Nano (smallest, fastest)
    "openai-gpt-4.1":         "gpt-4.1",         # GPT-4.1 announced Apr-2025
    "openai-gpt-4o":          "gpt-4o",          # 4o full-sized
    "openai-o3":              "o3",              # reasoning model (2025-04)
    "openai-o4-mini":         "o4-mini",         # compact reasoning model
}
    


TEST_CASES_DIR  = DATA_DIR / "test_cases"
DATASOURCES_DIR = DATA_DIR / "datasources" 

for _d in (DATA_DIR, TEST_CASES_DIR, DATASOURCES_DIR):
    _d.mkdir(parents=True, exist_ok=True)
class Config:
    OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
    SALESFORCE_API_KEY = os.getenv('SALESFORCE_API_KEY')
    SALESFORCE_API_BASE = "https://backend4.codegen.salesforceresearch.ai/v1"  # New base URL for xgen3
    ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')

notional_spec_schema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Notional Specification",
  "description": "A high-level representation of a visualization",
   "version": "0.2.0",
  "type": "object",
  "properties": {
    "version": {
      "type": "string"
    },
    "fields": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/FieldInstance"
      }
    },
    "chart": {
      "type": "string",
      "enum": [
        "text",
        "heatmap",
        "bar",
        "stackedbar",
        "line",
        "dualline",
        "area",
        "gantt",
        "boxplot",
        "scatterplot",
        "histogram",
        "symbolmap",
        "filledmap",
        "treemap",
        "pie",
        "bullet",
        "bubble"
      ]
    },
    "relativeDateFilters": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/RelativeDateFilter"
      }
    },
    "dateRangeFilters": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/DateRangeFilter"
      }
    },
    "rangeFilters": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/NumericRangeFilter"
      }
    },
    "categoricalFilters": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/CategoricalFilter"
      }
    },
    "sort": {
      "$ref": "#/definitions/SortingSpec"
    }
  },
  "definitions": {
    "FieldInstance": {
      "type": "object",
      "properties": {
        "caption": {
          "type": "string"
        },
        "data": {
          "type": "string",
          "enum": [
            "number",
            "string",
            "date",
            "boolean",
            "geographic",
            "set"
          ]
        },
        "type": {
          "type": "string",
          "enum": [
            "discrete",
            "continuous"
          ]
        },
        "role": {
          "type": "string",
          "enum": [
            "dimension",
            "measure"
          ]
        },
        "aggregation": {
          "type": "string",
          "enum": [
            "default",
            "count",
            "countd",
            "sum",
            "avg",
            "max",
            "min",
            "median",
            "year",
            "qtr",
            "month",
            "week",
            "day",
            "hour",
            "minute",
            "second"
          ]
        },
        "encoding": {
          "type": "string",
          "enum": [
            "color",
            "size",
            "text",
            "shape",
            "x",
            "y"
          ]
        },
        "fieldIdentifier": {
          "type": "string"
        }
      },
      "required": [
        "caption",
        "data",
        "type",
        "role"
      ]
    },
    "SortingSpec": {
      "type": "object",
      "properties": {
        "field": {
          "type": "string"
        },
        "by": {
          "type": "string"
        },
        "aggregation": {
          "type": "string",
          "enum": [
            "default",
            "count",
            "countd",
            "sum",
            "avg",
            "max",
            "min",
            "median",
            "year",
            "qtr",
            "month",
            "week",
            "day",
            "hour",
            "minute",
            "second"
          ]
        },
        "direction": {
          "type": "string",
          "enum": [
            "asc",
            "desc"
          ]
        }
      },
      "required": [
        "by"
      ]
    },
    "RelativeDateFilter": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "relative-date"
          ]
        },
        "field": {
          "type": "string"
        },
        "includeNull": {
          "type": "boolean"
        },
        "amount": {
          "type": "number"
        },
        "period": {
          "type": "string",
          "enum": [
            "days",
            "weeks",
            "months",
            "quarters",
            "years"
          ]
        },
        "direction": {
          "type": "string",
          "enum": [
            "next",
            "previous"
          ]
        },
        "anchor": {
          "type": "string"
        },
        "fieldIdentifier": {
          "type": "string"
        }
      },
      "required": [
        "type",
        "field",
        "amount",
        "period",
        "direction"
      ]
    },
    "DateRangeFilter": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "date-range"
          ]
        },
        "field": {
          "type": "string"
        },
        "includeNull": {
          "type": "boolean"
        },
        "start": {
          "type": "string"
        },
        "end": {
          "type": "string"
        },
        "fieldIdentifier": {
          "type": "string"
        }
      },
      "required": [
        "type",
        "field"
      ]
    },
    "NumericRangeFilter": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "numeric-range"
          ]
        },
        "field": {
          "type": "string"
        },
        "includeNull": {
          "type": "boolean"
        },
        "start": {
          "type": "number"
        },
        "end": {
          "type": "number"
        },
        "aggregation": {
          "type": "string",
          "enum": [
            "default",
            "count",
            "countd",
            "sum",
            "avg",
            "max",
            "min",
            "median",
            "year",
            "qtr",
            "month",
            "week",
            "day",
            "hour",
            "minute",
            "second"
          ]
        },
        "fieldIdentifier": {
          "type": "string"
        }
      },
      "required": [
        "type",
        "field"
      ]
    },
    "CategoricalFilter": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "categorical"
          ]
        },
        "field": {
          "type": "string"
        },
        "values": {
          "type": "array",
          "items": {
            "type": [
              "string",
              "number"
            ]
          }
        },
        "exclude": {
          "type": "boolean"
        },
        "limit": {
          "$ref": "#/definitions/LimitOptions"
        },
        "condition": {
          "$ref": "#/definitions/ConditionOptions"
        },
        "fieldIdentifier": {
          "type": "string"
        }
      },
      "required": [
        "type",
        "field"
      ]
    },
    "LimitOptions": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "top",
            "bottom"
          ]
        },
        "limit": {
          "type": "number"
        },
        "field": {
          "type": "string"
        },
        "aggregation": {
          "type": "string",
          "enum": [
            "default",
            "count",
            "countd",
            "sum",
            "avg",
            "max",
            "min",
            "median",
            "year",
            "qtr",
            "month",
            "week",
            "day",
            "hour",
            "minute",
            "second"
          ]
        }
      },
      "required": [
        "type",
        "limit",
        "field",
        "aggregation"
      ]
    },
    "ConditionOptions": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "condition"
          ]
        },
        "value": {
          "type": "number"
        },
        "operator": {
          "type": "string",
          "enum": [
            ">",
            ">=",
            "<",
            "<=",
            "==",
            "<>"
          ]
        },
        "field": {
          "type": "string"
        },
        "aggregation": {
          "type": "string",
          "enum": [
            "default",
            "count",
            "countd",
            "sum",
            "avg",
            "max",
            "min",
            "median",
            "year",
            "qtr",
            "month",
            "week",
            "day",
            "hour",
            "minute",
            "second"
          ]
        }
      },
      "required": [
        "type",
        "value",
        "operator",
        "field",
        "aggregation"
      ]
    }
  },
  "required": [
    "version",
    "fields"
  ]
}

# Constants for Instructions
RELEVANCE_INSTRUCTIONS = """
You are a judge model. Evaluate the model output's relevance to the user's request.
relevance (1-5):
1 -> doesn't address the request at all.
2 -> partly addresses but misses key aspects.
3 -> mostly addresses but misses minor aspects.
4 -> completely addresses but could be more direct.
5 -> perfect, no improvement needed.Provide a JSON object:
{
"relevance": <number between 1 and 5>,
"explanation": "<string explaining reasoning>"
}
"""

CORRECTNESS_INSTRUCTIONS = """
    You are a system that evaluates the correctness of a generated visualization specification.
    Consider how closely the actual (model) visualization spec matches the expected visualization spec.
    Look at fields, chart type, filters, aggregations, and ensure they align well.

    correctness (1-5):
    1 -> The spec is largely incorrect, major discrepancies from expected.
    2 -> Partly correct but key aspects are wrong (fields, chart type, etc.).
    3 -> Mostly correct but some elements differ from the expected output.
    4 -> Correct but not perfect, minor differences from expected.
    5 -> Perfectly correct, matches the expected spec with no or negligible differences.

    Return ONLY a JSON object:
    {
      "correctness": <1 to 5>,
      "explanation": "<explain differences/similarities>"
    }
    """

# Does the natural language response list any assumptions that were made?
ASSUMPTIONS_INSTRUCTIONS = """
You are a judge model. Evaluate whether the natural‐language response clearly identifies assumptions made in interpreting the data or generating the visualization.

Scoring (1-5):
1: None: No assumptions mentioned.
2: Implicit: Assumptions are implied but not stated directly.
3: Surface-level: At least one assumption is explicitly stated, but it's general or not clearly tied to the analysis.
4: Relevant: Two or more assumptions are explicitly stated and clearly relevant to the data or task.
5: Comprehensive: Multiple assumptions are clearly articulated, each directly tied to aspects of the data or visualization task, with justification.

Return ONLY a JSON object:
{
  "assumptions": <1-5>,
  "explanation": "<explain why you assigned this score, referring to the rubric>"
}

Examples:
1 (None): "The average sales are $5.2M." (No mention of filters, time frame, or aggregation method.)
2 (Implicit): "This shows an increase in recent months." (Assumes a time‐based view, but doesn't say what "recent" means.)
3 (Surface-level): "Assuming this is monthly data…" (States one assumption but doesn't tie it to the conclusion.)
4 (Relevant): "This assumes the 'Region' filter is set to North America and that values are aggregated monthly." (Multiple, relevant assumptions.)
5 (Comprehensive): "We assume data excludes returns, is filtered to 2023, and that 'Sales' reflects total revenue, not net. If any of these are wrong, the insight changes." (Multiple, contextual, justified.)
"""


# Does the visualization response contain relevant and rich details about data, insights,
# and actionable key takeaways that answer the user's prompt?
# This could include complex trends, pattern synthesis, exceptions, or commonplace concepts.
INSIGHTFULNESS_INSTRUCTIONS = """
You are a judge model. Evaluate how insightful the natural-language response is with respect to the user's prompt. It should focus on data-driven trends, patterns, exceptions, and actionable takeaways.

Scoring (1-5):
1 : Off-topic or empty: No data-related observations; response is vague or incorrect.
2 : Basic observations: One or two relevant facts or values mentioned without deeper analysis.
3 : General trends: Includes relevant trends or comparisons, but lacks depth or synthesis.
4 : Detailed insights: Identifies trends, patterns, or exceptions; some synthesis or interpretation is present.
5 : Relevant Insights: Provides trends, comparisons, exceptions, and implications with specific references to the data. Includes actionable or strategic takeaways.

Return ONLY a JSON object:
{
  "insightfulness": <1-5>,
  "explanation": "<explain using the rubric>"
}

Examples:
1 (Off-topic): "The chart shows data." (No meaningful insight.)
2 (Basic): "Sales increased." (True but vague—no numbers or context.)
3 (General trends): "Sales rose steadily from Q1 to Q4, especially in the West region." (Slightly informative, but missing "why.")
4 (Detailed insights): "Sales increased 25% from Q1 to Q4 in the West, driven by Electronics, while other regions stayed flat." (Specific and interprets drivers.)
5 (Relevant Insights): "From Q1 to Q4, Electronics in the West grew by 25% due to holiday promotions. Apparel in the South declined 10%, suggesting resource shifts for Q1 next year. " (Trends, exceptions, causal inference, and actionable takeaway.)
"""


# If it's a follow-up in a conversation (i.e. if ther are previous prompts in the conversation), 
# does the natural language response contain relevant information 
# and does it present it in a context-aware manner? Is it grounded to user prompt and the conversation so far?
FOLLOWUP_INSTRUCTIONS = """
You are a judge model. If this response is a follow-up in a conversation (i.e. there are previous prompts), evaluate whether it is context-aware and grounded in prior turns. Does it explicitly reference or build on earlier inputs?

Scoring (1-5):
1 : No incorporation: Ignores or contradicts earlier conversation turns.
2 : Minimal linkage: Mentions prior topics vaguely but does not use them in reasoning.
3 : Partial alignment: Correctly references previous prompts or data but misses key contextual elements.
4 : Relevant use: Refers to and builds upon earlier inputs in a relevant and accurate way.
5 : Fully grounded: Response explicitly integrates earlier conversation, adapting reasoning based on prior user inputs. Shows clear continuity.

Return ONLY a JSON object:
{
  "follow_up_relevance": <1-5>,
  "explanation": "<explain using the rubric>"
}

Examples:
1 (No incorporation): "Here's a bar chart of profit by segment." (No reference to prior request for a trend over time.)
2 (Minimal linkage): "I included segment data like you asked earlier." (Refers but doesn't apply it meaningfully.)
3 (Partial alignment): "Building on your question about segments, here's overall profit." (Topic correct but misses nuance, e.g. no trend detail.)
4 (Relevant use): "Since you asked about high-growth segments in Q3, this chart shows monthly growth by segment in Q3 only." (Clearly uses prior context.)
5 (Fully grounded): "Following your request for Q3 high-growth segments, this line chart filters to Q3 and compares growth across segments. Notably, Tech outperformed in September, continuing last week's trend." (Rich integration.)
"""

# Is the response logical and well-structured? 
COHERENCE_INSTRUCTIONS = """
You are a judge model. Evaluate the logical structure and flow of the natural‐language response. Is it well-organized, with a clear progression of ideas?

Scoring (1-5):
1 : Illogical: Contradictory or confusing statements; poor sentence flow.
2 : Disorganized: Ideas are present but not logically ordered; hard to follow.
3 : Mostly coherent: Basic structure (beginning/middle/end) but some unclear transitions.
4 : Well‐structured: Logical flow of ideas, consistent reasoning, clear transitions.
5 : Clear and precise: Highly organized with step‐by‐step structure, no ambiguity, strong internal consistency.

Return ONLY a JSON object:
{
  "coherence": <1-5>,
  "explanation": "<explain using the rubric>"
}

Examples:
1 (Illogical): "Sales are up, but that means profit is lower, so we should cut inventory." (Contradictory.)
2 (Disorganized): "Inventory is down. Sales are good. So profit is low. Maybe a trend?" (Loosely related but unclear.)
3 (Mostly coherent): "Sales increased, possibly leading to higher profit. Inventory dropped, though, which is a concern." (Logical but some jumps.)
4 (Well-structured): "Sales rose in Q4, contributing to higher profits. However, inventory levels dropped significantly, which may cause supply issues next quarter." (Clear progression.)
5 (Clear and precise): "Q4 sales rose 20%, leading to a 15% profit increase—driven by promotions. However, inventories fell 30%, threatening Q1 fulfillment. Strategic inventory planning is advised." (Logical, precise, actionable.)
"""

# Regular expression to clean the prompt
_CLEAN_PROMPT_RE = re.compile(r'^"(.*)"$', flags=re.DOTALL)
def clean_prompt(prompt: Optional[str]) -> Optional[str]:
    if prompt is None:
        return None
    prompt = prompt.strip()
    return _CLEAN_PROMPT_RE.sub(r"\1", prompt)

default_system_prompt = """You are a system that converts analytical queries into visualization specs following a strict JSON schema.
         You must return a valid JSON object with exactly two top-level fields:
         1) "content": the notional spec (matching the schema)
         2) "user_friendly_reply": a short description in plain English of what the visualization shows, and if it is a follow-up then acknowledge that and structure the response accordingly.
         """

# Check the structure of the datasource YAML
def validate_datasource_yaml(data: dict):
    """Raise ValueError if the minimal datasource schema is missing."""
    # Check if data has a title and datasourceFields
    if 'title' not in data:
        raise ValueError("missing 'title'")
    if 'datasourceFields' not in data or not isinstance(data['datasourceFields'], list):
        raise ValueError("missing 'datasourceFields' list")
    # For each datasourceField, check if it has 'name' and 'fieldValues'
    for f in data['datasourceFields']:
        if 'name' not in f or 'fieldValues' not in f:
            raise ValueError("each datasourceField needs 'name' and 'fieldValues'")

# Check the structure of the test case YAML
def validate_testcase_yaml(data: list):
    """Minimal checks on the array-of-tests structure."""
    # Check if data is a non-empty list
    if not isinstance(data, list) or not data:
        raise ValueError("root must be a non-empty list")
    # Check each test case
    for idx, tc in enumerate(data):
        # Check if there is a test-number and utterances
        if 'test-number' not in tc:
            raise ValueError(f"test[{idx}] missing 'test-number'")
        if 'utterances' not in tc or not tc['utterances']:
            raise ValueError(f"test[{idx}] missing 'utterances'")
        # Check each utterance for required fields: canonical or paraphrase, and expected notional-spec-out
        for u in tc['utterances']:
            if not (u.get('canonical') or u.get('paraphrase') or u.get('paraphrases')):
              raise ValueError("each utterance needs canonical or paraphrase(s)")
            if not (u.get('notional-spec-out') or u.get('notional_spec_out')):
                raise ValueError("each utterance needs notional-spec-out")

# Upload datsasource and test case YAML files 
@app.route('/upload-custom-assets', methods=['POST'])
def upload_custom_assets():
    """
    Body: { datasourceYaml: <string>, testCaseYaml: <string> }
    Returns filenames that are now available for selection.
    """
    body = request.get_json(force=True)
    ds_raw = body.get('datasourceYaml')
    tc_raw = body.get('testCaseYaml')
  # Check if both datasourceYaml and testCaseYaml are provided
    if not ds_raw or not tc_raw:
        return jsonify({"error": "Both datasourceYaml and testCaseYaml required"}), 400
  # Validate the structure of the datasource and test case YAMLs
    try:
        ds_dict = yaml.safe_load(ds_raw)
        tc_list = yaml.safe_load(tc_raw)
        validate_datasource_yaml(ds_dict)
        validate_testcase_yaml(tc_list)
    except Exception as e:
        return jsonify({ "error": f"Validation failed: {e}" }), 400

    # Check for duplicate files before creating new ones
    duplicate_check = check_for_duplicate_files(ds_dict, tc_list, ds_raw, tc_raw)
    if duplicate_check['is_duplicate']:
        return jsonify({
            "is_duplicate": True,
            "existing_test_case_file": duplicate_check['existing_test_case_file'],
            "existing_datasource_file": duplicate_check['existing_datasource_file'],
            "message": "This file already exists. The existing file has been selected automatically."
        })

    # deterministic yet unique filenames
    base = slugify(ds_dict.get('title', 'custom'))[:30]  # safe prefix
    ds_fname = f"{base}-{uuid4().hex[:6]}.yaml"
    tc_fname = f"{base}-{uuid4().hex[:6]}.v2.yaml"

    # Store files in Redis for cross-dyno access
    redis_client = get_redis_client()
    redis_client.set(f"datasource:{ds_fname}", ds_raw, ex=JOB_TTL_SECS)  # Use JOB_TTL_SECS for longer expiry
    redis_client.set(f"testcase:{tc_fname}", tc_raw, ex=JOB_TTL_SECS)   # Use JOB_TTL_SECS for longer expiry
    redis_client.set(f"mapping:{tc_fname}", ds_fname, ex=JOB_TTL_SECS)  # Store mapping in Redis for cross-dyno access
    
    # Also write to disk for web dyno access
    (DATASOURCES_DIR / ds_fname).write_text(ds_raw, encoding='utf-8')
    (TEST_CASES_DIR / tc_fname).write_text(tc_raw, encoding='utf-8')
    MAPPINGS[tc_fname] = ds_fname  
    save_custom_mappings()
    
    # Update the MAPPINGS dictionary with the new test case and datasource filenames        
    return jsonify({
        "is_duplicate": False,
        "datasourceFile": ds_fname,
        "testCaseFile":  tc_fname,
        # lightweight meta so the UI can show nice tags right away
        "meta": {
            "title":      ds_dict.get("title", base),
            # fallbacks so tags always render
            "difficulty": ds_dict.get("difficulty", "uploaded"),
            "domain":     ds_dict.get("domain", "uploaded")
        }
    })

def check_for_duplicate_files(ds_dict, tc_list, ds_raw, tc_raw):
    """
    Check if the uploaded files are duplicates of existing files.
    Returns a dict with is_duplicate flag and existing file names if found.
    """
    # Get all existing test case files
    existing_test_cases = []
    
    # Check disk files
    for f in TEST_CASES_DIR.glob("*.yaml"):
        existing_test_cases.append(f.name)
    
    # Check Redis files
    try:
        redis_client = get_redis_client()
        redis_keys = redis_client.keys("testcase:*")
        for key in redis_keys:
            test_case_name = key.decode("utf-8").replace("testcase:", "")
            if test_case_name not in existing_test_cases:
                existing_test_cases.append(test_case_name)
    except Exception as e:
        app.logger.error(f"Failed to get test cases from Redis: {e}")
    
    # Check each existing test case for duplicates
    for test_case_file in existing_test_cases:
        try:
            # Load existing test case content
            existing_tc_content = None
            
            # Try to load from disk first
            test_case_path = TEST_CASES_DIR / test_case_file
            if test_case_path.exists():
                existing_tc_content = test_case_path.read_text(encoding='utf-8')
            else:
                # Try Redis
                try:
                    redis_client = get_redis_client()
                    tc_raw = redis_client.get(f"testcase:{test_case_file}")
                    if tc_raw:
                        existing_tc_content = tc_raw.decode('utf-8')
                except Exception as e:
                    app.logger.error(f"Failed to load test case from Redis: {e}")
                    continue
            
            if not existing_tc_content:
                continue
                
            # Parse existing test case
            existing_tc_list = yaml.safe_load(existing_tc_content)
            
            # Check if test case content matches (normalized comparison)
            if test_cases_match(tc_list, existing_tc_list):
                # Found matching test case, now check datasource
                datasource_file = MAPPINGS.get(test_case_file)
                if not datasource_file:
                    # Try Redis for mapping
                    try:
                        redis_client = get_redis_client()
                        mapping = redis_client.get(f"mapping:{test_case_file}")
                        if mapping:
                            datasource_file = mapping.decode("utf-8")
                    except Exception as e:
                        app.logger.error(f"Failed to load mapping from Redis: {e}")
                        continue
                
                if datasource_file:
                    # Load existing datasource content
                    existing_ds_content = None
                    
                    # Try disk first
                    datasource_path = DATASOURCES_DIR / datasource_file
                    if datasource_path.exists():
                        existing_ds_content = datasource_path.read_text(encoding='utf-8')
                    else:
                        # Try Redis
                        try:
                            redis_client = get_redis_client()
                            ds_raw = redis_client.get(f"datasource:{datasource_file}")
                            if ds_raw:
                                existing_ds_content = ds_raw.decode('utf-8')
                        except Exception as e:
                            app.logger.error(f"Failed to load datasource from Redis: {e}")
                            continue
                    
                    if existing_ds_content:
                        # Parse existing datasource
                        existing_ds_dict = yaml.safe_load(existing_ds_content)
                        
                        # Check if datasource content matches
                        if datasources_match(ds_dict, existing_ds_dict, ds_raw, existing_ds_content):
                            return {
                                'is_duplicate': True,
                                'existing_test_case_file': test_case_file,
                                'existing_datasource_file': datasource_file
                            }
        
        except Exception as e:
            app.logger.error(f"Error checking test case {test_case_file} for duplicates: {e}")
            continue
    
    return {'is_duplicate': False}

def test_cases_match(tc_list1, tc_list2):
    """
    Compare two test case lists for content equality.
    Normalizes the data for comparison by sorting and removing irrelevant fields.
    """
    if not isinstance(tc_list1, list) or not isinstance(tc_list2, list):
        return False
    
    if len(tc_list1) != len(tc_list2):
        return False
    
    # Normalize test cases for comparison
    def normalize_test_case(tc):
        # Create a copy and sort utterances for consistent comparison
        normalized = {
            'test-number': tc.get('test-number'),
            'description': tc.get('description'),
            'utterances': []
        }
        
        for utterance in tc.get('utterances', []):
            normalized_utterance = {
                'canonical': utterance.get('canonical'),
                'notional-spec-out': utterance.get('notional-spec-out')
            }
            normalized['utterances'].append(normalized_utterance)
        
        # Sort utterances by canonical text for consistent comparison
        normalized['utterances'].sort(key=lambda u: u.get('canonical', ''))
        
        return normalized
    
    # Normalize both lists
    normalized1 = [normalize_test_case(tc) for tc in tc_list1]
    normalized2 = [normalize_test_case(tc) for tc in tc_list2]
    
    # Sort by test number for consistent comparison
    normalized1.sort(key=lambda tc: tc.get('test-number', 0))
    normalized2.sort(key=lambda tc: tc.get('test-number', 0))
    
    return normalized1 == normalized2

def datasources_match(ds_dict1, ds_dict2, ds_raw1, ds_raw2):
    """
    Compare two datasource dictionaries for content equality.
    Checks both structured data and raw content.
    """
    # First check if titles match
    title1 = ds_dict1.get('title', '').strip()
    title2 = ds_dict2.get('title', '').strip()
    
    if title1 and title2 and title1 != title2:
        return False
    
    # Normalize datasource for comparison
    def normalize_datasource(ds_dict):
        normalized = {
            'title': ds_dict.get('title', '').strip(),
            'description': ds_dict.get('description', '').strip(),
            'datasourceFields': []
        }
        
        for field in ds_dict.get('datasourceFields', []):
            normalized_field = {
                'name': field.get('name', '').strip(),
                'fieldValues': sorted(field.get('fieldValues', []))
            }
            normalized['datasourceFields'].append(normalized_field)
        
        # Sort fields by name for consistent comparison
        normalized['datasourceFields'].sort(key=lambda f: f['name'])
        
        return normalized
    
    # Normalize both datasources
    normalized1 = normalize_datasource(ds_dict1)
    normalized2 = normalize_datasource(ds_dict2)
    
    # Compare normalized structures
    if normalized1 != normalized2:
        return False
    
    # Also do a raw content comparison (normalized) as a final check
    # Remove whitespace differences and sort field values
    def normalize_raw_content(raw_content):
        # Parse and re-serialize to normalize formatting
        parsed = yaml.safe_load(raw_content)
        return yaml.dump(parsed, default_flow_style=False, sort_keys=True)
    
    try:
        normalized_raw1 = normalize_raw_content(ds_raw1)
        normalized_raw2 = normalize_raw_content(ds_raw2)
        return normalized_raw1 == normalized_raw2
    except Exception:
        # If raw normalization fails, fall back to structured comparison
        return True

_CTRL_CHARS_RE = re.compile(r"[\x00-\x1F\x7F]+")
def clean_name(name: Optional[str]) -> str:
    """
    Trim whitespace / control chars that sometimes sneak
   into <option> values coming back from the browser.
    """
    if not name:
        return ""
    return _CTRL_CHARS_RE.sub("", name.strip())

# Function to load data values 
def load_data_values(datasource_filename):
    datasource_path = DATASOURCES_DIR / datasource_filename
    if os.path.exists(datasource_path):
        with open(datasource_path, 'r') as f:
            datasource = yaml.safe_load(f)
            data_values = datasource.get('dataValues', [])
            return data_values
    else:
        return []
      

# Function to load datasource fields
def load_datasource(datasource_filename):
     datasource_path = DATASOURCES_DIR / datasource_filename
     
     # Try to load from disk first
     if os.path.exists(datasource_path):
        with open(datasource_path, 'r') as f:
            datasource = yaml.safe_load(f)
            return datasource
     
     # If not on disk, try Redis
     try:
         redis_client = get_redis_client()
         ds_raw = redis_client.get(f"datasource:{datasource_filename}")
         if ds_raw:
             return yaml.safe_load(ds_raw.decode('utf-8'))
     except Exception as e:
         logging.error(f"Failed to load datasource {datasource_filename} from Redis: {e}")
     
     return None
    

def construct_data_values_from_field_values(datasource):
    field_names = [f['name'] for f in datasource.get('datasourceFields', [])]
    field_values_list = [f.get('fieldValues', []) for f in datasource.get('datasourceFields', [])]

    lengths = [len(v) for v in field_values_list if v]
    max_length = max(lengths) if lengths else 0
    if max_length == 0:
        return []

    data_values = []
    for i in range(max_length):
        rec = {}
        for j, name in enumerate(field_names):
            vals = field_values_list[j]
            rec[name] = vals[i] if i < len(vals) else None
        data_values.append(rec)
    return data_values
  
# Function to pick a key from user keys or environment variables
def pick_key(name: str, user_keys: Dict[str, str]) -> Tuple[Optional[str], str]:
    """
    Return (key, 'user' | 'env' | 'missing').
    """
    if (key := user_keys.get(name)):
        return key, "user"
    if (key := os.getenv(name)):
        return key, "env"
    return None, "missing"

# Sample route to get available models
@app.route('/get-models', methods=['GET'])
def get_models():
    models = [
        {"provider": "OpenAI", "models": list(OPENAI_MODEL_IDS.keys())},
        {"provider": "Salesforce", "models": ["anthropic-claude-3.7-sonnet", "deepseek-r1", "SFR-Tableau-Finetuned"]}
    ]
    return jsonify(models)
    
@app.route('/get-test-cases', methods=['GET'])
def get_test_cases():
    """
    Return a *clean* list of YAML filenames so dropdown values
    never contain stray CR/LF characters.
    """
    try:
        files = [
            clean_name(f.name)
            for f in TEST_CASES_DIR.glob("*.yaml")
        ]
        
        # Also include test cases that might be in Redis but not on disk
        try:
            redis_client = get_redis_client()
            # Get all keys that start with "testcase:"
            redis_keys = redis_client.keys("testcase:*")
            for key in redis_keys:
                test_case_name = key.decode("utf-8").replace("testcase:", "")
                if test_case_name not in files:
                    files.append(test_case_name)
        except Exception as e:
            app.logger.error(f"Failed to get test cases from Redis: {e}")
        
        return jsonify(files)
    except Exception as e:
        app.logger.exception("Error fetching test cases")
        return jsonify(error="Failed to fetch test cases"), 500
    
@app.route('/get-datasource', methods=['GET'])
def get_datasource():
    MAPPINGS.update(load_custom_mappings())
    test_case = clean_name(request.args.get("test_case"))
    if not test_case:
        return jsonify({'error': 'test_case is required'}), 400

    # Get the corresponding datasource filename using the MAPPINGS dictionary
    datasource_filename = MAPPINGS.get(test_case)
    
    # If not in MAPPINGS, try Redis as fallback
    if not datasource_filename:
        try:
            redis_client = get_redis_client()
            mapping = redis_client.get(f"mapping:{test_case}")
            if mapping:
                datasource_filename = mapping.decode("utf-8")
                MAPPINGS[test_case] = datasource_filename  # Cache it for future use
        except Exception as e:
            app.logger.error(f"Failed to load mapping from Redis for {test_case}: {e}")
    
    if not datasource_filename:
        return jsonify({"error": "Invalid test case filename"}), 400

    datasource_path = os.path.join(DATASOURCES_DIR, datasource_filename)
    datasource = None

    # Try to load from disk first
    if os.path.exists(datasource_path):
        try:
            with open(datasource_path, 'r') as datasource_file:
                datasource = yaml.safe_load(datasource_file)
        except Exception as e:
            app.logger.error(f"Error reading datasource file from disk '{datasource_filename}': {str(e)}")
    
    # If not on disk, try Redis
    if datasource is None:
        try:
            redis_client = get_redis_client()
            ds_raw = redis_client.get(f"datasource:{datasource_filename}")
            if ds_raw:
                datasource = yaml.safe_load(ds_raw.decode('utf-8'))
            else:
                app.logger.error(f"Datasource file '{datasource_filename}' not found in disk or Redis.")
                return jsonify({"error": f"Datasource file '{datasource_filename}' not found."}), 500
        except Exception as e:
            app.logger.error(f"Error reading datasource file from Redis '{datasource_filename}': {str(e)}")
            return jsonify({"error": f"Error reading datasource file '{datasource_filename}': {str(e)}"}), 500

    # If we still don't have a datasource, return error
    if datasource is None:
        return jsonify({"error": f"Could not load datasource file '{datasource_filename}'"}), 500

    # Construct dataValues from fieldValues
    data_values = construct_data_values_from_field_values(datasource)
    datasource['dataValues'] = data_values

    # Return the datasource content as a JSON response
    return jsonify(datasource)

@app.route('/get-test-case-mappings', methods=['GET'])
def get_test_case_mappings():
    """
    Return the *latest* mapping every time — including anything
    uploaded by other requests or workers.
    """
    MAPPINGS.update(load_custom_mappings())        # refresh from disk
    
    # Also include mappings from Redis
    try:
        redis_client = get_redis_client()
        # Get all keys that start with "mapping:"
        redis_keys = redis_client.keys("mapping:*")
        for key in redis_keys:
            test_case_name = key.decode("utf-8").replace("mapping:", "")
            if test_case_name not in MAPPINGS:
                mapping = redis_client.get(key)
                if mapping:
                    MAPPINGS[test_case_name] = mapping.decode("utf-8")
    except Exception as e:
        app.logger.error(f"Failed to get mappings from Redis: {e}")
    
    return jsonify(MAPPINGS)

# Function to convert notional spec to Vega-Lite spec
def convert_notional_to_vega(notional_spec, datasource_fields):
    """
    Convert a notional spec to a Vega-Lite spec.
    """
    try:
        if not notional_spec:        
            return None
        # Helper function to normalize strings
        def normalize_string(s):
            return s.strip().lower()

        # Map datasource fields for quick lookup
        datasource_fields_map = {normalize_string(field['name']): field for field in datasource_fields}

        fields = notional_spec.get('fields', [])
        field_types = {
            'catTime': [],
            'catAll': [],
            'quantMeasure': [],
            'quantAll': [],
        }

        # Identify field types based on datasource fields
        for field_spec in fields:
            field_name = field_spec.get('caption')
            normalized_field_name = normalize_string(field_name)
            datasource_field = datasource_fields_map.get(normalized_field_name)

            if not datasource_field:
                app.logger.warning(f"No matching datasource field found for '{field_name}'")
                continue  # Skip fields not found in datasource

            field_type = (datasource_field.get('type') or datasource_field.get('data', 'nominal')).lower()
            
            if field_type in ['date', 'ordinal', 'temporal']:
                field_types['catTime'].append(field_name)
            elif field_type in ['string', 'nominal', 'discrete']:
                field_types['catAll'].append(field_name)
            elif field_type in ['number', 'quantitative', 'continuous']:
                field_types['quantAll'].append(field_name)
                field_types['quantMeasure'].append(field_name)

        all_fields = field_types['catAll'] + field_types['quantAll']

        vega_spec = None

        # Apply conditional logic to determine chart type
        if len(field_types['catTime']) >= 1 and len(field_types['quantMeasure']) >= 1:
            # Line Chart
            x_field = field_types['catTime'][0]
            y_field = field_types['quantMeasure'][0]

            # Check for aggregation
            field_spec = next((f for f in fields if f.get('caption') == y_field), {})
            aggregation = field_spec.get('aggregation')

            y_encoding = {'field': y_field, 'type': 'quantitative'}
            if aggregation:
                y_encoding['aggregate'] = aggregation

            vega_spec = {
                '$schema': 'https://vega.github.io/schema/vega-lite/v5.json',
                'data': {'name': 'data'},
                'mark': 'line',
                'encoding': {
                    'x': {'field': x_field, 'type': 'temporal'},
                    'y': y_encoding,
                },
            }
        elif len(field_types['catAll']) >= 1 and len(field_types['quantMeasure']) >= 1:
            # Bar Chart
            x_field = field_types['catAll'][0]
            y_field = field_types['quantMeasure'][0]

            # Check for aggregation
            field_spec = next((f for f in fields if f.get('caption') == y_field), {})
            aggregation = field_spec.get('aggregation')

            y_encoding = {'field': y_field, 'type': 'quantitative'}
            if aggregation:
                y_encoding['aggregate'] = aggregation

            vega_spec = {
                '$schema': 'https://vega.github.io/schema/vega-lite/v5.json',
                'data': {'name': 'data'},
                'mark': 'bar',
                'encoding': {
                    'x': {'field': x_field, 'type': 'nominal'},
                    'y': y_encoding,
                },
            }
        elif len(field_types['quantMeasure']) >= 2:
            # Scatter Plot
            x_field = field_types['quantMeasure'][0]
            y_field = field_types['quantMeasure'][1]

            vega_spec = {
                '$schema': 'https://vega.github.io/schema/vega-lite/v5.json',
                'data': {'name': 'data'},
                'mark': 'point',
                'encoding': {
                    'x': {'field': x_field, 'type': 'quantitative'},
                    'y': {'field': y_field, 'type': 'quantitative'},
                },
            }
        elif len(all_fields) == 1 and len(field_types['catAll']) == 1:
            # Text List
            y_field = field_types['catAll'][0]

            vega_spec = {
                '$schema': 'https://vega.github.io/schema/vega-lite/v5.json',
                'data': {'name': 'data'},
                'mark': 'text',
                'encoding': {
                    'y': {'field': y_field, 'type': 'nominal'},
                    'text': {'field': y_field, 'type': 'nominal'},
                },
            }
        elif len(all_fields) == 1 and len(field_types['quantAll']) == 1:
            # Histogram
            x_field = field_types['quantAll'][0]

            vega_spec = {
                '$schema': 'https://vega.github.io/schema/vega-lite/v5.json',
                'data': {'name': 'data'},
                'mark': 'bar',
                'encoding': {
                    'x': {'field': x_field, 'type': 'quantitative', 'bin': True},
                    'y': {'aggregate': 'count', 'type': 'quantitative'},
                },
            }
        else:
            app.logger.warning("No suitable chart type found for the given fields.")
            return None

        return vega_spec

    except Exception as e:
        app.logger.error(f"Error converting notional spec to Vega-Lite spec: {e}")
        return None


@app.route('/get-test-case-yaml', methods=['GET'])
def get_test_case_yaml():
    MAPPINGS.update(load_custom_mappings())
    fname = clean_name(request.args.get("test_case"))
    if not fname:
        return jsonify({"error": "Parameter 'test_case' is required"}), 400
    if fname not in MAPPINGS:
        # Try to get mapping from Redis as fallback
        try:
            redis_client = get_redis_client()
            mapping = redis_client.get(f"mapping:{fname}")
            if mapping:
                MAPPINGS[fname] = mapping.decode("utf-8")
            else:
                return jsonify({"error": "Unknown test-case file"}), 400
        except Exception as e:
            app.logger.error(f"Failed to load mapping from Redis for {fname}: {e}")
            return jsonify({"error": "Unknown test-case file"}), 400

    path = TEST_CASES_DIR / fname
    if not path.exists():
        # Try to get from Redis as fallback
        try:
            redis_client = get_redis_client()
            tc_raw = redis_client.get(f"testcase:{fname}")
            if tc_raw:
                return Response(tc_raw.decode("utf-8"), mimetype="text/plain")
        except Exception as e:
            app.logger.error(f"Failed to load test case from Redis for {fname}: {e}")
        
        return jsonify({"error": f"Test-case file {fname} not found"}), 404

    return Response(path.read_text("utf-8"), mimetype="text/plain")

@app.post("/evaluate-test-cases")
def enqueue_evaluation():
    """Enqueue the evaluation job and return {jobId} immediately (202)."""
    data = request.get_json(force=True)
    # Log full incoming payload (with API keys masked)
    try:
        user_id_for_log = (data or {}).get("user_id", "<unknown>")
        logging.info(
            "evaluate-test-cases request payload: %s",
            json.dumps(sanitize_for_logging(data), ensure_ascii=False)
        )
        # Also store a copy in the per-user activity log stream
        if user_id_for_log and isinstance(user_id_for_log, str):
            log_user_activity(user_id_for_log, "evaluate_request", {
                "payload": sanitize_for_logging(data)
            })
    except Exception:
        logging.exception("Failed to log incoming evaluate-test-cases payload")
    # quick validation before enqueuing a doomed job
    if not data or not data.get("test_cases") or not data.get("models"):
        return jsonify({"error": "Please provide test_cases and models."}), 400
    
    # Validate user_id is provided
    user_id = data.get("user_id")
    if not user_id or not user_id.strip():
        return jsonify({"error": "Please provide a valid user_id."}), 400
    
    jm = data.get("judgeModel")
    if jm and jm in data.get("models", []):
       return jsonify({"error": "Judge model must be different from generation models"}), 400
    
    # Include a snapshot of mappings just for the requested test cases
    data["mappings"] = {
        tc: MAPPINGS.get(tc) for tc in data.get("test_cases", []) if tc in MAPPINGS
    }
    
    job_id = uuid4().hex
    
    # Log job creation with full (sanitized) payload including runs/system prompts
    log_user_activity(user_id, "job_created", {
        "job_id": job_id,
        "payload": sanitize_for_logging(data),
        "runs_per_instance": data.get("runs_per_instance", 1),
        "system_prompts": data.get("system_prompts") or ([data.get("system_prompt")] if data.get("system_prompt") else []),
    })
    
    write_state(job_id, status="queued", completed=0, total=0, user_id=user_id)
    # Use RQ's job_id so worker logs are easy to correlate
    # Set job timeout to 7 days to prevent timeouts
    q.enqueue(background_eval, data, job_id, job_id=job_id, job_timeout=604800, result_ttl=JOB_TTL_SECS)
    resp_obj = {"jobId": job_id}
    try:
        logging.info("evaluate-test-cases response: %s", json.dumps(resp_obj))
        log_user_activity(user_id, "evaluate_response", {"response": resp_obj})
    except Exception:
        pass
    return jsonify(resp_obj), 202

@app.get("/evaluate-status/<job_id>")
def evaluate_status(job_id):
    """Poll current status and progress. 202=processing, 200=finished, 500=failed."""
    st = read_state(job_id)
    if not st:
        return jsonify({"error": "unknown job"}), 404
    status = st.get("status", "queued")
    code = 202
    if status == "finished":
        code = 200
    elif status == "failed":
        code = 500
    return jsonify(st), code

@app.get("/evaluate-results/<job_id>")
def evaluate_results(job_id):
    """
    Fetch persisted rows/fragments for a job.
    Query param ?start=<int> enables incremental polling:
      - we return rows[start:]
      - response includes "next" offset for the next call
    """
    if not read_state(job_id):
        return jsonify({"error": "unknown job"}), 404
    try:
        start = int(request.args.get("start", "0"))
    except ValueError:
        start = 0

    key = _rows_key(job_id)
    rows = redis.lrange(key, start, -1) or []
    out = []
    for r in rows:
        try:
            out.append(json.loads(r))
        except Exception:
            out.append({})
    resp = {"rows": out, "next": start + len(rows)}
    try:
        logging.info("evaluate-results %s response: %s", job_id, json.dumps(sanitize_for_logging(resp)))
    except Exception:
        pass
    return jsonify(resp)

@app.get("/evaluate-events/<job_id>")
def evaluate_events(job_id):
    """
    Stream NDJSON events for this job from Redis Pub/Sub.
    Emits {} heartbeat lines every ~12s to keep Heroku happy.
    """
    HEARTBEAT_SECS = int(os.getenv("STREAM_HEARTBEAT_SECS", "12"))
    channel = _channel(job_id)
    # early guard: unknown job id
    if not read_state(job_id):
        return jsonify({"error": "unknown job"}), 404
    ps = redis.pubsub(ignore_subscribe_messages=True)
    ps.subscribe(channel)
    last_send = time.monotonic()

    def gen():
        nonlocal last_send
        # initial heartbeat so the router sees activity quickly
        yield "{}\n"
        try:
            while True:
                msg = ps.get_message(timeout=1.0)
                now = time.monotonic()
                if msg and msg.get("type") == "message":
                    data = msg.get("data")
                    try:
                        text = data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else str(data)
                    except Exception:
                        text = "{}"
                    # forward as-is; ensure newline
                    yield text + "\n"
                    last_send = now
                    try:
                        obj = json.loads(text)
                        if obj.get("type") == "done":
                            break
                    except Exception:
                        pass
                elif now - last_send >= HEARTBEAT_SECS:
                    yield "{}\n"
                    last_send = now
        finally:
            with suppress(Exception):
                ps.unsubscribe(channel)
                ps.close()

    return Response(
      stream_with_context(gen()), 
      mimetype="application/x-ndjson", 
      headers={
        "Cache-Control": "no-store, no-cache, must-revalidate", 
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
        },
      )

@app.post("/evaluate-cancel/<job_id>")
def evaluate_cancel(job_id):
    """Best-effort cancel: flip a flag the running job checks, and try to cancel RQ if not started."""
    if not read_state(job_id):
        return jsonify({"error": "unknown job"}), 404
    set_cancel(job_id)
    try:
        job = Job.fetch(job_id, connection=redis)
        job.cancel()
    except Exception:
        pass
    # If the job is already running, it will see the flag and exit quickly
    return jsonify({"ok": True})

# -----------------------------------------------------------------
# React catch-all: any URL that isn't an API hits index.html so the
# client-side router (react-router-dom) can handle it.
# -----------------------------------------------------------------
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path: str):
    """
    Serve the React SPA from ``frontend/build``.

    • If the requested asset exists (JS/CSS/images) return it.
    • If the path is ``/`` or any client-side route (e.g. /dashboard),
      fall back to index.html so React-Router handles it.
    """
    asset = BUILD_DIR / path
    if path and asset.exists():
        return send_from_directory(BUILD_DIR, path)       # real file
    return send_from_directory(BUILD_DIR, "index.html")   # SPA entry-point


async def call_model_api(session, model, input_text, datasource=None, system_prompt=None, api_keys: Optional[Dict[str, str]] = None, conversation_history: Optional[list[dict]] = None  ):
    api_keys = api_keys or {}
    """
    Call the appropriate model API based on the specified model.
    Generate a notional spec JSON for Tableau visualization rendering.
    """
    # Add rate limiting delay to prevent API rate limits
    await asyncio.sleep(0.5)  # 500ms delay between API calls
    try:
        # converts notional_spec_schema to a JSON
        schema_info = json.dumps(notional_spec_schema, indent=2)
        # converts datasource to JSON
        datasource_info = json.dumps(datasource or '', indent=2)
        # choose override or default
        system_msg = system_prompt.strip() if system_prompt else default_system_prompt
        # build chat history messages (if any)
        history_msgs = []
        if conversation_history:
            for turn in conversation_history:
              # ensure the minimal keys exist before using the turn
              if "user" not in turn or "responses" not in turn:
                logging.warning("Skipping malformed conversation turn: %s", turn)
                continue
              
              # each turn holds `"user"` + the model replies
              history_msgs.append(
                  {"role": "user", "content": turn["user"]}
              )
              #   pick this model-prompt's reply when available,
              #   else any reply (so history is never empty)
              reply = next(
              (v for k, v in turn["responses"].items() 
               if k.split("|")[0] == model),
                    next(iter(turn["responses"].values()), "")
              )
              history_msgs.append(
                {"role": "assistant", "content": reply}
              )
        
        # 3) Embed dynamic context into the system message
        full_system_msg = (
          f"{system_msg}\n\n"
          f"Schema: {schema_info}\n"
          f"Datasource: {datasource_info}\n"
          f"User Query: {input_text}\n"
          "Please return ONLY the JSON object (no code fences or extra text)."
      )
        
        einstein_api_key = api_keys.get("EINSTEIN_API_KEY") or os.getenv("EINSTEIN_API_KEY")
        openai_key, openai_src = pick_key("OPENAI_API_KEY", api_keys)
        if model in {"openai-gpt-4.1", "openai-gpt-4o", "openai-o3", "openai-o4-mini"}:
            if not openai_key:
                return json.dumps({"error": "Missing OpenAI API key."})
            logging.info(f"OPENAI credential source for {model}: {openai_src}")
        salesforce_key, sf_src = pick_key("SALESFORCE_API_KEY", api_keys)
        logging.info(f"Salesforce Gateway key source: {sf_src}")
        # Extra sanity-check: log key length & first 6 chars (never the full secret)
        if salesforce_key:
            logging.info("SFR key len=%s …%s", len(salesforce_key), salesforce_key[:6])
                
        # OpenAI Models
        if model in OPENAI_MODEL_IDS:
            real_model = OPENAI_MODEL_IDS[model]
            prompt_messages = (
                [{"role": "system", "content": full_system_msg}]
                + history_msgs
                + [{"role": "user", "content": input_text}]
            )
            headers = {
                "Authorization": f"Bearer {openai_key}",
                "Content-Type": "application/json"
            }
            openai_data = {"model": real_model, "messages": prompt_messages}

            try:
                async with session.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers=headers,
                    json=openai_data,
                ) as response:
                    if response.status != 200:
                        # capture body before raising so upstream handler can wrap it
                        err_body = await response.text()
                        raise aiohttp.ClientResponseError(
                            response.request_info,
                            response.history,
                            status=response.status,
                            message=err_body,
                        )

                    response_content = await response.json()
                    model_response = response_content["choices"][0]["message"]["content"]
            except aiohttp.ClientResponseError:
                # Let the outer except convert it into the standard `_error` stub
                raise
                
            # Remove code fences if present
            model_response = model_response.replace("```json", "").replace("```", "").strip()
                
            try:
                    parsed = json.loads(model_response)
            except json.JSONDecodeError:
                    parsed = { "content": {}, "user_friendly_reply": "<Could not parse JSON>" }
                
            final_result = {
                    "content": parsed.get("content", {}),
                    "user_friendly_reply": parsed.get("user_friendly_reply", "")
                }
                
            return json.dumps(final_result, indent=2, default=str)

        # Anthropic Claude-3.5 sonnet
        elif model in {"anthropic-claude-3.7-sonnet", "anthropic-claude-opus-4"}:
          # Send a POST request to the Salesforce Research Claude-3 endpoint with the prompt
          url = "https://gateway.salesforceresearch.ai/claude3/process"
          headers = {
              "accept": "application/json",
              "X-Api-Key": salesforce_key,
              "Content-Type": "application/json",
          }

          # Bedrock-style: system message in its own field, messages list WITHOUT role=system
          claude_id = CLAUDE_MODEL_IDS[model]
          messages  = history_msgs + [{"role": "user", "content": input_text}]
          payload   = {
              "model_id": claude_id,
              "system": full_system_msg,         
              "prompts":  messages,               
              "stream": False,
              "temperature": 0.7,
              "max_tokens": 2000,
          }

          async with session.post(url, headers=headers, json=payload) as response:
              raw = await response.text()                 # grab payload first
              if response.status != 200:                  # log + raise w/ context
                  logging.error("Gateway %s → %s",
                                response.status, raw[:400])
                  raise aiohttp.ClientResponseError(
                      response.request_info, response.history,
                      status=response.status, message=raw
                  )

              # The gateway sometimes returns *either* a dict with {"result": "..."}
              # OR a bare JSON-encoded string (e.g. `"text here"`).  Handle both.
              try:
                  body = json.loads(raw)                  # parse whatever JSON type
              except Exception:
                  body = raw                              # leave as-is if not JSON

              # Normalise to a *raw string* that contains the model text
              if isinstance(body, dict):
                  if "result" in body or "output" in body:           
                    chunk_data = body.get("result") or body.get("output")
                    
                    if isinstance(chunk_data, list):
                        raw_text = "\n".join(
                            item.get("text", str(item)) if isinstance(item, dict) else str(item)
                            for item in chunk_data
                        )
                    else:                                          # single string / dict
                        raw_text = str(chunk_data)

                  elif "text" in body:                               # new schema
                      raw_text = str(body["text"])
                  else:
                      raw_text = str(body)                           # fallback
              elif isinstance(body, list):                           # streaming list
                  # join all "text" chunks (or str() each part)
                  raw_text = "\n".join(
                      str(part.get("text", part)) if isinstance(part, dict) else str(part)
                      for part in body
                  )
              else:                                                  # already str
                  raw_text = str(body)


              raw_text = raw_text.strip()

              # 2) Remove code fences / <think> blocks / newlines
              raw_text = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.S)
              raw_text = raw_text.replace("```json", "").replace("```", "").strip()

             # 3) Extract the *first* JSON object if the string includes extra text
              m = re.search(r"\{.*\}", raw_text, flags=re.S)
              json_str = m.group(0) if m else raw_text

              # 4) Robust JSON parse (including double‑encoded payloads)
              try:
                  parsed_json = json.loads(json_str)
                  if isinstance(parsed_json, str):
                      parsed_json = json.loads(parsed_json)
              except Exception:
                  logging.warning(f"Claude parse‑error ⇒ {json_str[:120]}…")
                  parsed_json = {
                      "content": {},
                      "user_friendly_reply": "<Could not parse JSON from Claude>"
                  }

              # 5) Ensure we always return the two‑field object
              final_result = {
                  "content": parsed_json.get("content", parsed_json),
                  "user_friendly_reply": parsed_json.get("user_friendly_reply", "")
              }
              return json.dumps(final_result, indent=2, default=str)  
        #XGen Base Model
        elif model == "xgen-9b-instruct-together":
          url = "https://gateway.salesforceresearch.ai/xgen-9b-instruct-together/process"
          headers = {
              "accept": "application/json",
              "X-Api-Key": salesforce_key,
              "Content-Type": "application/json"
          }

          payload = {
              "prompts": (
                  [{"content": full_system_msg, "role": "system"}]
                  + history_msgs
                  + [{"content": input_text, "role": "user"}]
             ),
              "temperature": 0.7,
              "top_p": 0.95,
              "max_tokens": 1024
          }

          async with session.post(url, headers=headers, json=payload) as response:
              response.raise_for_status()
              response_content = await response.json()

              # Usually we get a field named "output" containing the entire text
              output_text = response_content.get("output", "")

              # Optional: Use regex to find JSON block within triple backticks
              # Some models may or may not do that, but we'll preserve existing logic:
              match = re.search(r'```json\s*(\{[\s\S]*?\})\s*```', output_text)
              if match:
                  json_str = match.group(1).strip()
              else:
                  # If no code fences found, assume entire output is JSON
                  json_str = output_text.strip()

              # Now parse the 2-field JSON
              try:
                  parsed_json = json.loads(json_str)
              except json.JSONDecodeError:
                  parsed_json = {
                      "content": {},
                      "user_friendly_reply": "<Could not parse JSON from xgen>"
                  }

              final_result = {
                  "content": parsed_json.get("content", {}),
                  "user_friendly_reply": parsed_json.get("user_friendly_reply", "")
              }

              return json.dumps(final_result, indent=2, default=str)

        
        # DeepSeek models
        elif model == "deepseek-r1":
          url = "https://gateway.salesforceresearch.ai/deepseek-v3-0324/chat/completions"
          headers = {
              "accept": "application/json",
              "X-Api-Key": salesforce_key,
              "Content-Type": "application/json"
          }

          payload = {
              "messages": (
                  [{"content": full_system_msg, "role": "system"}]
                  + history_msgs
                  + [{"content": input_text, "role": "user"}]
              ),
              "stream": False,                
              "temperature": 0.7,
              "max_tokens": 2048
          }

          async with session.post(url, headers=headers, json=payload) as response:
              response.raise_for_status()

              # bypass content‑type check (gateway sets text/event‑stream for SSE)
              data = await response.json(content_type=None)

          # ── extract assistant text ───────────────────────────────────────
          choice = data["choices"][0]
          assistant_text = (
              choice.get("message", {}).get("content") or
              choice.get("delta", {}).get("content")   or
              choice.get("text", "")
          ).strip()

          # strip think blocks / code fences
          assistant_text = re.sub(r"<think>.*?</think>", "", assistant_text, flags=re.S)
          assistant_text = assistant_text.replace("```json", "").replace("```", "").strip()

          # parse once (and twice if double‑encoded)
          try:
              chunk_data = json.loads(assistant_text)
              if isinstance(chunk_data, str):
                  chunk_data = json.loads(chunk_data)
          except json.JSONDecodeError:
              logging.warning(f"DeepSeek parse‑error ⇒ {assistant_text[:120]}…")
              chunk_data = {"content": {}, "user_friendly_reply": "<Could not parse JSON from DeepSeek>"}

          result_obj = {
              "content": chunk_data.get("content", chunk_data),
              "user_friendly_reply": chunk_data.get("user_friendly_reply", "")
          }
          return json.dumps(result_obj, indent=2, default=str)

        elif model == "SFR-Tableau-Finetuned":
            url = "https://bot-svc-llm.sfproxy.einstein.aws-dev4-uswest2.aws.sfdc.cl/v1.0/generations"
            
            headers = {
                "Content-Type": "application/json",
                "X-Org-Id": "00DRO000000PTlS2AW",
                "x-sfdc-core-tenant-id": "core/dev/00DRO000000PTlS2AW",
                "x-sfdc-app-context": "EinsteinGPT",
                "x-client-feature-id": "Exploratory_Trial",
                "Authorization": f"API_KEY {einstein_api_key}",
            }

            datasource_fields_str = "\n".join([
                f"- dataType: {field.get('data', 'string')}\n  fieldName: {field.get('caption', '')}"
                for field in (datasource.get("datasourceFields", []) if datasource else [])
            ])

            payload = {
                "prompt": input_text,
                "num_generations": 1,
                "max_tokens": 1024,
                "enable_pii_masking": None,
                "enable_input_safety_scoring": False,
                "enable_output_safety_scoring": True,
                "temperature": 0.01,
                "stop_sequences": None,
                "frequency_penalty": None,
                "presence_penalty": None,
                "model": "llmgateway__EinsteinTableauGPT",
                "localization": None,
                "parameters": {
                    "top_p": 0.99,
                    "additionalProperties": {
                        "messages": [],
                        "datasourceFields": datasource_fields_str,
                        "notional_spec_in": {"version": "0.2.0", "fields": []}
                    },
                    "llm_service_name": "einstein_for_tableau"
                },
                "tags": {"present": False},
                "turn_id": None
            }

            async with session.post(url, headers=headers, json=payload) as response:
                response.raise_for_status()
                response_content = await response.json()

                # The entire model response is in "text"
                raw_text = response_content.get("generations", [{}])[0].get("text", "{}").strip()

                try:
                    # Parse the raw model JSON
                    parsed_json = json.loads(raw_text)
                    
                    # Grab BOTH "content" (the notional spec) and "user_friendly_reply"
                    final_result = {
                        "content": parsed_json.get("content", {}), 
                        "user_friendly_reply": parsed_json.get("user_friendly_reply", "")
                    }

                    # Return both as a single JSON object
                    return json.dumps(final_result, indent=2, default=str)

                except json.JSONDecodeError:
                    return "{}"  # or handle differently if needed

        else:
            raise ValueError(f"Unsupported model: {model}")
    
    # If the server returned an unsuccessful HTTP status code, log the error and returns a simple error message.
    except aiohttp.ClientResponseError as e:
        logging.error(f"HTTP Error with model {model}: {str(e)}")
        # Always hand back machine-parsable JSON so downstream code never
        # crashes on json.loads()
        err_obj = {
            "content": {},
            "user_friendly_reply": "",
            "_error": f"HTTP {e.status}: {e.message}"
        }
        return json.dumps(err_obj, indent=2)
    # Even if the HTTP request succeeds (e.g., 200 OK), the returned body might not be well-formed JSON or may not match the expected format, in that case return the error
    except Exception as e:
        logging.error(f"Unexpected error with model {model}: {str(e)}")
        err_obj = {
            "content": {},
            "user_friendly_reply": "",
            "_error": f"Unexpected: {str(e)}"
        }
        return json.dumps(err_obj, indent=2)

async def call_judge_model_api_metric(
    session: aiohttp.ClientSession,
    judge_model: str,
    user_utterance: str,
    model_response: str,
    instructions: str, 
    api_keys: Optional[Dict[str, str]] = None
) -> dict:
    api_keys = api_keys or {}
    openai_key, src = pick_key("OPENAI_API_KEY", api_keys)
    salesforce_key, _ = pick_key("SALESFORCE_API_KEY", api_keys)
    logging.info(f"Judge model key source: {src}")
    """
    Calls the judge LLM with custom instructions and returns
    a dict like { metric_key: score, 'explanation': text }.
    """
    # Add rate limiting delay to prevent API rate limits
    await asyncio.sleep(0.3)  # 300ms delay between judge API calls
    prompt = f"""{instructions.strip()}

User Utterance:
{user_utterance}

Model Response:
{model_response}
""" 
    async def openai_chat(model_id: str) -> str:
        headers = {
            "Authorization": f"Bearer {openai_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": model_id,
            "messages": [
                {"role": "system",
                 "content": "Respond with *only* the JSON object."},
                {"role": "user", "content": prompt},
            ],
        }
        async with session.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=body,
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
            return data["choices"][0]["message"]["content"].strip()
    # Helper that wraps every *real* network call in a timeout so one
    # slow request never blocks the whole run.
    async def _with_timeout(coro, *, seconds: int = JUDGE_TIMEOUT, metric_key: str = "metric") -> str:
        try:
             # If the inner coroutine already returns JSON, keep it,
              # otherwise wrap it so the caller is always dealing with JSON.
             raw = await asyncio.wait_for(coro, timeout=seconds)
             return raw if raw.lstrip().startswith("{") else json.dumps({metric_key: raw})
        except Exception as e:
            logging.warning("Judge call timed-out or failed: %s", e)
            # Always return *valid* JSON so json.loads() never explodes downstream.
            return json.dumps(
                {metric_key: 1, "explanation": str(e) or "timeout/err"}
            )
    try:
       # pull the first JSON-key (e.g. "relevance", "correctness", …)
        m = re.search(r'"([A-Za-z_]+)"\s*:', instructions)
        metric_name = m.group(1) if m else "metric"
        # ── OpenAI family ──────────────────────────────────────────────
        if judge_model in OPENAI_MODEL_IDS: 
            if not openai_key:
              # keep going, but return a default 1 so the pipeline never dies
              logging.warning("Judge model %s requested but no OPENAI_API_KEY provided", judge_model)
              return {metric_name: 1, "explanation": "Missing OPENAI_API_KEY"}
            real_model = OPENAI_MODEL_IDS[judge_model]
            content = await openai_chat(real_model)


       # ── Claude‑3 via SFR gateway ──────────────────────────────────
        elif judge_model in {"anthropic-claude-3.7-sonnet", "anthropic-claude-opus-4"}:
            url = "https://gateway.salesforceresearch.ai/claude3/process"
            headers = {
                "accept": "application/json",
                "X-Api-Key": salesforce_key,
                "Content-Type": "application/json",
          }
            payload = {
                "model_id": CLAUDE_MODEL_IDS[judge_model],
                "system": "Respond with only valid JSON.",
                "prompts": [{"role": "user", "content": prompt}],
                "stream": False,
                "temperature": 0.5,
                "max_tokens": 1024,
            }
            # identical gateway – reuse _post_json then normalise like above
            raw = await _post_json(session, url, headers, payload)

            try:
                body = json.loads(raw)              # may still be dict/str/list
            except json.JSONDecodeError:
                body = raw

            if isinstance(body, dict) and "result" in body:
                chunk_data = body["result"]
                if isinstance(chunk_data, list):
                    content = "\n".join(
                        p.get("text", str(p)) if isinstance(p, dict) else str(p)
                        for p in chunk_data
                    )
                else:
                    content = str(chunk_data)
            else:
                content = str(body)


        # ── DeepSeek‑R1 ───────────────────────────────────────────────
        elif judge_model == "deepseek-r1":
            url = (
                "https://gateway.salesforceresearch.ai/"
                "deepseek-v3-0324/chat/completions"
            )
            headers = {
                "accept": "application/json",
                "X-Api-Key": salesforce_key,
                "Content-Type": "application/json",
            }
            payload = {
                "messages": [{"content": prompt, "role": "user"}],
                "stream": False,
            }
            raw = await _post_json(session, url, headers, payload)

            try:
                data = json.loads(raw)
                choice = data["choices"][0]
                content = (
                    choice.get("message", {}).get("content") or
                    choice.get("delta", {}).get("content")   or
                    choice.get("text", "")
                )
            except Exception:
                content = raw
        else:
            return {metric_name: 1, "explanation": f"Unsupported judge model: {judge_model}"}

        # -------------------- strip code‑fences & parse -----------------
        cleaned = str(content or "").replace("```json", "").replace("```", "").strip()
        return json.loads(cleaned)

    except json.JSONDecodeError as e:
        # fallback to a 1 with parse error
        key = "metric"
        if "{" in cleaned:
            try:
                # grab everything from the first '{' onward
                partial = "{" + cleaned.split("{", 1)[1]
                parsed_partial = json.loads(partial)
                # if it's a dict, pick its first key
                if isinstance(parsed_partial, dict) and parsed_partial:
                    key = next(iter(parsed_partial))
            except Exception:
                # if anything goes wrong, stick with key="metric"
                pass

        return {
            key: 1,
            "explanation": f"Parse error: {e} — got: {cleaned}"
        }

@app.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint to monitor Redis connectivity and system status.
    Useful for load balancers and monitoring systems.
    """
    health_status = {
        "status": "healthy",
        "timestamp": time.time(),
        "services": {}
    }
    
    # Check Redis connectivity
    try:
        redis_ping = redis.ping()
        redis_info = redis.info()
        health_status["services"]["redis"] = {
            "status": "healthy" if redis_ping else "unhealthy",
            "connected_clients": redis_info.get("connected_clients", 0),
            "used_memory_human": redis_info.get("used_memory_human", "unknown"),
            "total_commands_processed": redis_info.get("total_commands_processed", 0)
        }
    except Exception as e:
        health_status["services"]["redis"] = {
            "status": "unhealthy",
            "error": str(e)
        }
        health_status["status"] = "degraded"
    
    # Check RQ queue status
    try:
        queue_length = len(q)
        health_status["services"]["rq"] = {
            "status": "healthy",
            "queue_length": queue_length,
            "queue_name": q.name
        }
    except Exception as e:
        health_status["services"]["rq"] = {
            "status": "unhealthy",
            "error": str(e)
        }
        health_status["status"] = "degraded"
    
    # Check active jobs
    try:
        active_jobs = len([job for job in q.jobs if job.get_status() in ['queued', 'started']])
        health_status["services"]["active_jobs"] = active_jobs
    except Exception as e:
        health_status["services"]["active_jobs"] = {"error": str(e)}
    
    # Determine overall status
    if health_status["status"] == "healthy":
        return jsonify(health_status), 200
    else:
        return jsonify(health_status), 503

@app.route('/metrics', methods=['GET'])
def metrics():
    """
    Prometheus-style metrics endpoint for monitoring.
    """
    try:
        redis_info = redis.info()
        metrics = {
            "redis_connected_clients": redis_info.get("connected_clients", 0),
            "redis_used_memory_bytes": redis_info.get("used_memory", 0),
            "redis_total_commands_processed": redis_info.get("total_commands_processed", 0),
            "redis_keyspace_hits": redis_info.get("keyspace_hits", 0),
            "redis_keyspace_misses": redis_info.get("keyspace_misses", 0),
            "rq_queue_length": len(q),
            "rq_active_jobs": len([job for job in q.jobs if job.get_status() in ['queued', 'started']]),
            "rq_failed_jobs": len([job for job in q.jobs if job.get_status() == 'failed']),
            "app_uptime_seconds": time.time() - app.start_time if hasattr(app, 'start_time') else 0
        }
        return jsonify(metrics), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/user-logs/<user_id>', methods=['GET'])
def get_user_logs(user_id):
    """Get user activity logs from Redis."""
    try:
        # Get all logs for this user
        pattern = f"user_log:{user_id}:*"
        keys = redis.keys(pattern)
        
        logs = []
        for key in keys:
            try:
                log_data = redis.get(key)
                if log_data:
                    log_entry = json.loads(log_data)
                    logs.append(log_entry)
            except Exception as e:
                logging.error(f"Error parsing log entry {key}: {e}")
                continue
        
        # Sort by timestamp (newest first)
        logs.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
        
        return jsonify({"logs": logs}), 200
    except Exception as e:
        logging.error(f"Error getting user logs for {user_id}: {e}")
        return jsonify({"error": str(e)}), 500

# Initialize app start time for metrics
app.start_time = time.time()

if __name__ == '__main__':
    app.run(debug=True)
