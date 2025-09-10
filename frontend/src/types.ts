
import { VisualizationSpec } from 'vega-embed';
import type { ReactNode } from 'react';
// MetricScores interface imported from metrics module
import { MetricScores, ModelMetricsMap } from './metrics';
import { ModelJudgeEval } from './NaturalLanguageOverallMetrics';

/** 
 * The set of possible keys (properties) in metric objects that are numeric 
 * and we intend to chart 
 */
export type MetricKey = string;

interface WithMetrics {
  metrics?: Record<string, MetricScores>;
}

export interface MetricsByLabelPanelProps {
  evaluationData: EvaluationDataRecord[];
  selectedModels: string[];
  judgeModel?: string | null;
}



export interface ChartData {
  label: string;
  model: string;
  value: number;
}

type StringMap = Record<string, string>;

export interface DatasourceField {
    key?: number;
    name: string;
    type?: 'nominal'| 'ordinal' | 'quantitative' | 'temporal' | 'number' | 'object';
    role?: 'dimension' | 'measure';
    description?: string;
    fieldValues?: Array<string | number>;
    fieldValuesCount?: number;
  }
  
  export interface EvaluationResult {
    file: string;
    results: TestCase[];
  }
  

export interface RunResult {
  /** Raw LLM replies */
  model_outputs: Record<string, string>;
  /** Vega specs derived from those replies */
  modelVegaSpecs?: Record<string, VisualizationSpec | null>;
  /** Conversion errors (per model) */
  modelConversionErrors?: Record<string, string[]>;
  /** Per‑model metric bundle */
  metrics?: ModelMetricsMap;
  /** Per‑model judge scores  ← NEW */
  judge_evaluations?: Record<string, Record<string, ModelJudgeEval>>;
}
export interface JudgeEvaluations {
  // Top‐level key is the judge model (e.g. “o1”)
  [judgeModel: string]: {
    // Second‐level key is the evaluated model (e.g. “o3-mini”)
    [evaluatedModel: string]: {
      relevance?: number;
      relevance_explanation?: string;
      correctness?: number;
      correctness_explanation?: string;
      assumptions?: number;
      assumptions_explanation?: string;
      insightfulness?: number;
      insightfulness_explanation?: string;
      follow_up_relevance?: number;
      follow_up_relevance_explanation?: string;
      contextualizing?: number;
      contextualizing_explanation?: string;
      coherence?: number;
      coherence_explanation?: string;
    };
  };
}



  export interface EvaluationDataRecord {
     children?: EvaluationDataRecord[];
     /** which run index is considered the “representative” one (chosen by FE as the best viz scores) */
     representative_run_idx?: number;
    /** raw data for each run (0‑based index) */
    run_results?: Record<number, RunResult>;
    /** once all runs have arrived this is the simple arithmetic
       mean of every MetricScores field, one blob per model        */
    metric_averages?: ModelMetricsMap;
    /** whether this row is expanded to show children */
    expanded: boolean;
    
    key: string;
    file: string;
    input: string;
    canonical?: string;
    paraphrases?: string[];
    expected_output: object;
    model_outputs: StringMap;
    expectedVegaSpec?: VisualizationSpec | null;
    modelVegaSpecs?:  Record<string, VisualizationSpec | null>;
    pass_fail: Record<string, boolean>;
    /** 0‑based index *within its own test‑number* */
    idx?: number;
    /** Unique identifier for the row, e.g. "file|test_number|idx" */
    row_id?: string;
    metrics?: ModelMetricsMap;
    test_number?: number;
    labels: string[];
    modelConversionErrors: Record<string, string[]>;
    expectedErrors: string[];
    
    judge_evaluations?: RunResult['judge_evaluations'];
  }
  
  export interface TestCase {
    judge_evaluations?: Record<string, { relevance: number; explanation: string }>;
    pass_fail: Record<string, boolean>;
    input: string;
    expected_output: NotionalSpec;
    expected_nl_reply: string;
    model_outputs: StringMap;
    metrics?: WithMetrics;
    test_number?: number;
    labels?: string[];
    canonical?: string;
    paraphrase?: string;   
    paraphrases?: string[];
    utterances: string[]; 
    
  }
  

export interface ConversionResult {
    vegaSpec: VisualizationSpec | null;
    errors: string[];
}

export interface TestCaseWithMetrics extends TestCase {
    metrics?: WithMetrics;
}
export interface EvaluationResultWithMetrics extends EvaluationResult {
    results: TestCaseWithMetrics[];
}


// The following types are from: what Mike and Seb shared as Tableau's notional spec schema: https://salesforce.quip.com/k403AqIQyB7g
type ChartType = 'text' | 'heatmap' | 'bar' | 'stackedbar' | 'line' | 'area' | 'gantt' | 'scatterplot' | 'histogram' | 'symbolmap' | 'filledmap' | 'treemap' | 'pie' | 'dualline' | 'boxplot' | 'bullet' | 'bubble';
type DataType = 'number' | 'string' | 'date' | 'boolean' | 'geographic' | 'set';
type FieldType = 'discrete' | 'continuous';
type FieldRole = 'dimension' | 'measure';
type Aggregation = 'default' | 'count' | 'countd' |'sum' | 'avg' | 'max' | 'min' | 'median' |
                   'year' | 'qtr' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';
type Encoding = 'color' | 'size' | 'text' | 'shape' | 'x' | 'y';
type SortDirection = 'asc' | 'desc';
type RelativeDatePeriod = 'days' | 'weeks' | 'months' | 'quarters' | 'years';
type RelativeDirection = 'next' | 'previous';
type LimitType = 'top' | 'bottom';
type ConditionOperator = '>' | '>=' | '<' | '<=' | '==' | '<>';

export type FieldInstance = {
  caption: string;
  fieldIdentifier?: string;
  data?: DataType;
  type?: FieldType;
  role?: FieldRole;
  aggregation?: Aggregation;
  encoding?: Encoding;
};

export type SortingSpec = {
  field?: string; 
  by: string;
  aggregation?: Aggregation;
  direction?: SortDirection;
};

interface BaseFilter {
  field: string;
  fieldIdentifier?: string;
  includeNull?: boolean;
}

export type RelativeDateFilter = BaseFilter & {
  type: 'relative-date';
  amount: number;
  period: RelativeDatePeriod;
  direction: RelativeDirection;
  anchor?: string;
};

export type DateRangeFilter = BaseFilter & {
  type: 'date-range';
  start?: string;
  end?: string;
};

export type NumericRangeFilter = BaseFilter & {
  type: 'numeric-range';
  start?: number;
  end?: number;
  aggregation?: Aggregation;
};

export type LimitOptions = {
  type: LimitType;
  limit: number;
  field: string;
  aggregation: Aggregation;
};

export type ConditionOptions = {
  type: 'condition';
  value: number;
  operator: ConditionOperator;
  field: string;
  aggregation: Aggregation;
};

export type CategoricalFilter = {
  type: 'categorical';
  field: string;
  fieldIdentifier?: string;
  values?: string[] | number[];
  exclude?: boolean;
  limit?: LimitOptions;
  condition?: ConditionOptions;
  includeNull?: boolean;
};

export type NotionalSpec = {
  version: string;
  fields: FieldInstance[];
  chart?: ChartType;
  relativeDateFilters?: RelativeDateFilter[];
  dateRangeFilters?: DateRangeFilter[];
  rangeFilters?: NumericRangeFilter[];
  categoricalFilters?: CategoricalFilter[];
  sort?: SortingSpec;
};

export type FAQPanel = {
  key: string;
  label: ReactNode;
  content: ReactNode;
};
