import { useCallback, useRef, useState } from "react";
import { API_BASE } from "./api";

type EvalRow = {
  file: string;
  row_id: string; // "<test_case>|<test_number>|<turn_idx>|run<r>"
  run_idx: number;
  run_count: number;
  data: {
    canonical: string | null;
    paraphrases: string[];
    expected_output?: unknown;
    model_outputs: Record<string, string>;        // e.g. "openai-gpt-4o|prompt1" -> raw text/JSON
    modelVegaSpecs: Record<string, unknown>;      // same keys as model_outputs
    pass_fail: Record<string, boolean>;           // same keys as model_outputs
    judge_evaluations?: Record<string, Record<string, any>>; // judge -> (modelKey -> scores)
  };
};

type EvalEvent =
  | { type: "start"; total: number; runs_per_instance?: number; granular?: boolean }
  | { type: "row"; payload: EvalRow }
  | { type: "row-fragment"; row_id: string; file: string; payload: { synthetic_key: string; raw: string; ok: boolean; vega: unknown } }
  | { type: "judge-fragment"; row_id: string; file: string; payload: { synthetic_key: string; judge_model: string; judge_results: any } }
  | { type: "progress"; completed: number; total: number }
  | { type: "error"; error: string }
  | { type: "done"; status: "finished" | "failed" };

export type EvalState = {
  status: "idle" | "running" | "done" | "error";
  error?: string;
  total: number;
  completed: number;
  runs_per_instance: number;
  granular: boolean;
  // normalized store: row_id -> modelKey -> cell
  cells: Record<
    string,
    Record<
      string,
      {
        output: string;
        vega?: unknown;
        ok: boolean;
        judge?: any;
      }
    >
  >;
  // fragment-level streaming for real-time updates
  fragments: Array<{
    type: "row-fragment" | "judge-fragment";
    row_id: string;
    synthetic_key: string;
    timestamp: number;
    data: any;
  }>;
};

export function useEvaluationStream() {
  const [state, setState] = useState<EvalState>({
    status: "idle",
    total: 0,
    completed: 0,
    runs_per_instance: 1,
    granular: false,
    cells: {},
    fragments: [],
  });

  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState((s) => ({ ...s, status: "idle" }));
  }, []);

  const start = useCallback(
    async (payload: any) => {
      cancel(); // abort any previous stream
      setState({ status: "running", total: 0, completed: 0, runs_per_instance: 1, granular: false, cells: {}, fragments: [] });

      // 1) kick off job
      const jobResp = await fetch(`${API_BASE}/evaluate-test-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const { jobId, error } = await jobResp.json();
      // Removed local request/response logging

      if (!jobResp.ok || !jobId) {
        setState({ status: "error", total: 0, completed: 0, runs_per_instance: 1, granular: false, cells: {}, fragments: [], error: error || "Failed to start job" });
        return;
      }

      // Store job ID for logging completion
      const currentJobId = jobId;
      const startTime = Date.now();

      // 2) stream events
      const ctrl = new AbortController();
      controllerRef.current = ctrl;

      const res = await fetch(`${API_BASE}/evaluate-events/${jobId}`, { signal: ctrl.signal });
      if (!res.body) {
        setState((s) => ({ ...s, status: "error", error: "No readable stream" }));
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let completed = 0;
      let total = 0;

      const flushLine = (line: string) => {
        if (!line) return; // heartbeat {}
        let evt: EvalEvent;
        try {
          evt = JSON.parse(line);
        } catch {
          // ignore partial or malformed line
          return;
        }

        if (evt.type === "start") {
          total = evt.total || 0;
          const startEvent = evt as { type: "start"; total: number; runs_per_instance?: number; granular?: boolean };
          setState((s) => ({ 
            ...s, 
            total,
            runs_per_instance: startEvent.runs_per_instance || 1,
            granular: startEvent.granular || false
          }));
          return;
        }

        if (evt.type === "row-fragment") {
          const { row_id, payload } = evt;
          const { synthetic_key, raw, ok, vega } = payload;
          
          // Add to fragments for real-time display
          setState((s) => ({
            ...s,
            fragments: [...s.fragments, {
              type: "row-fragment",
              row_id,
              synthetic_key,
              timestamp: Date.now(),
              data: { raw, ok, vega }
            }]
          }));

          // Update cells
          setState((s) => {
            const cells = { ...s.cells };
            const mapForRow = { ...(cells[row_id] || {}) };
            mapForRow[synthetic_key] = {
              output: raw,
              vega,
              ok,
              judge: undefined,
            };
            cells[row_id] = mapForRow;
            return { ...s, cells };
          });
          return;
        }

        if (evt.type === "judge-fragment") {
          const { row_id, payload } = evt;
          const { synthetic_key, judge_model, judge_results } = payload;
          
          // Add to fragments for real-time display
          setState((s) => ({
            ...s,
            fragments: [...s.fragments, {
              type: "judge-fragment",
              row_id,
              synthetic_key,
              timestamp: Date.now(),
              data: { judge_model, judge_results }
            }]
          }));

          // Update cells with judge data
          setState((s) => {
            const cells = { ...s.cells };
            const mapForRow = { ...(cells[row_id] || {}) };
            if (mapForRow[synthetic_key]) {
              mapForRow[synthetic_key] = {
                ...mapForRow[synthetic_key],
                judge: judge_results,
              };
            }
            cells[row_id] = mapForRow;
            return { ...s, cells };
          });
          return;
        }

        if (evt.type === "row") {
          const row = evt.payload;
          completed += 1;

          // Build a batch update for this row's cells
          setState((s) => {
            const cells = { ...s.cells };
            const mapForRow = { ...(cells[row.row_id] || {}) };

            for (const [modelKey, output] of Object.entries(row.data.model_outputs)) {
              mapForRow[modelKey] = {
                output,
                vega: row.data.modelVegaSpecs?.[modelKey],
                ok: !!row.data.pass_fail?.[modelKey],
                judge: row.data.judge_evaluations
                  ? // pick the single judge (object with judge_model -> { modelKey: scores })
                    Object.values(row.data.judge_evaluations)[0]?.[modelKey]
                  : undefined,
              };
            }

            cells[row.row_id] = mapForRow;
            return {
              ...s,
              cells,
              completed,
            };
          });
          // optional: fire your own side-effect here (toast, scroll, etc.)
          return;
        }

        if (evt.type === "progress") {
          completed = evt.completed;
          total = evt.total;
          setState((s) => ({ ...s, completed, total }));
          return;
        }

        if (evt.type === "error") {
          const e = evt as Extract<EvalEvent, { type: "error" }>;
          setState((s) => ({ ...s, status: "error", error: e.error }));
          
          // Removed local job_failed logging
          
          ctrl.abort();
          return;
        }

        if (evt.type === "done") {
          setState((s) => ({ ...s, status: "done" }));
          
          // Removed local job_completed logging
          
          ctrl.abort();
        }
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });

          // consume complete lines
          for (;;) {
            const i = buf.indexOf("\n");
            if (i < 0) break;
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            flushLine(line);
          }
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setState((s) => ({ ...s, status: "error", error: String(e) }));
        }
      } finally {
        controllerRef.current = null;
      }
    },
    [cancel]
  );

  return { state, start, cancel };
}
