# LEXARA-RF Validation Corpus

This is the public release of the human-rated CVA evaluation corpus used to
validate **LEXARA-RF: Reference-Free Metrics for Evaluating Conversational
Visual Analytics Agents**. It contains 120 expert-rated CVA responses
spanning eight LLMs, eight data sources, and three analytical domains,
together with the source test cases and data-source schemas from which the
responses were generated.

The corpus reproduces the validation results in Section 4 and Supplementary C
of the paper.

## Contents

```
lexara_rf_corpus/
├── README.md                 # this file
├── corpus.csv                # 120 rated responses, 95 columns (see below)
└── source_test_cases/
    ├── Datasources/          # 8 YAML files describing the source data
    │   ├── sample-superstore-datasource.yaml
    │   ├── 2014-inc-500-datasource.yaml
    │   ├── american-university-ipeds-datasource.yaml
    │   ├── life-expectancy-who-datasource.yaml
    │   ├── cov-vac-uptake-2024-who-datasource.yaml
    │   ├── global-sport-finances-top-athlete-salaries-espn-datasource.yaml
    │   ├── global-sport-finances-top-teams-payroll-list-espn-datasource.yaml
    │   └── patient-billing-anon-participant-datasource.yaml
    ├── Test Cases/           # 16 YAML files (P01–P16), one per participant
    │   └── P01_testcases.yaml … P16_testcases.yaml
    └── test_case_mappings.json   # test-case file → data-source file mapping
```

## `corpus.csv` schema

One row per CVA response (N = 120). 95 columns, grouped as follows.

### Identifiers and metadata

| Column | Description |
|---|---|
| `response_id` | Stable ID (`R001`–`R120`). |
| `participant` | Source test case participant (`P01`–`P16`). |
| `test_number`, `utterance_index` | Position within the source conversation. |
| `is_followup` | Whether this turn has prior conversational context. |
| `datasource` | YAML filename in `source_test_cases/Datasources/`. |
| `domain` | `finance` \| `healthcare` \| `education`. |
| `ambiguity_type` | `syntactic` \| `semantic` \| `pragmatic`. |
| `task_type` | `descriptive` \| `comparative` \| `trend`. |
| `model` | LLM that produced the response (see below). |
| `system_prompt` | One of six system-prompt variants (`sp1_concise` … `sp6_zero_shot`). |
| `user_utterance` | Current-turn natural-language query. |
| `prior_utterances` | Prior turns in scope, `\|\|\|`-delimited. |
| `labels` | Source-corpus tags (chart type, ambiguity, intent shape). |
| `diagnostic_label` | Failure-mode label used in §4.3 / Supp C Table 2. |

### Model response (3 columns)

| Column | Description |
|---|---|
| `model_response_v_json` | JSON string of the visualization specification *V*. |
| `model_response_nl` | Natural-language explanation *NL*. |
| `expected_spec_reference_json` | Notional reference spec from the source test case (used only by reference-based comparators, not by LEXARA-RF). |

### Scores (75 columns: 15 metrics × 5 score sources)

Each row carries 15 metric scores from five sources, prefixed accordingly:

| Prefix | Source |
|---|---|
| `h1_` | Expert annotator 1 (raw 0–100 rating). |
| `h2_` | Expert annotator 2 (raw 0–100 rating). |
| `human_` | Mean of `h1_` and `h2_` — used as the ground-truth alignment target throughout §4. |
| `rf_` | LEXARA-RF reference-free score (this work). |
| `ref_` | Reference-based Lexara score (Palani & Setlur, 2026). |

The 15 metric suffixes are:

- **Expressiveness:** `data_fidelity`, `field_similarity`, `filter_accuracy`, `sort_accuracy`
- **Effectiveness:** `chart_type`, `axis_accuracy`, `visual_encoding`, `interactivity`
- **Conversational Alignment:** `factual_grounding`, `assumptions_disclosure`, `insightfulness`, `coherence`, `follow_up_relevance`
- **Aggregates:** `overall_viz`, `overall_nl` (means of the constituent metrics within each pillar)

All scores are on the [0, 100] scale.

## Coverage summary

| Dimension | Values |
|---|---|
| Responses | 120 |
| Participants | 16 (P01–P16) |
| Data sources | 8 (across finance, healthcare, education) |
| Models | 8: GPT-5, GPT-5-mini, GPT-5-pro, o3, o4-mini, Claude Opus 4, Claude 3.7 Sonnet, DeepSeek R1 (15 responses each) |
| System prompts | 6: concise, verbose, step-by-step, chain-of-thought, few-shot, zero-shot (20 responses each) |
| Follow-up turns | 96 multi-turn, 24 single-turn |
| Failure modes | 11 diagnostic labels + `no_failure` (n = 30); see paper §4.3 / Supp C Table 2 for per-mode counts |

