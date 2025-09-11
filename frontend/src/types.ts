
/**
 * Type Definitions for Language Model Comparison App
 * 
 * This module contains all TypeScript type definitions used throughout the application.
 * It includes interfaces for evaluation data, test cases, metrics, and visualization
 * specifications.
 * 
 * @author Research Team
 */

import { VisualizationSpec } from 'vega-embed';
import type { ReactNode } from 'react';
import { MetricScores, ModelMetricsMap } from './metrics';
import { ModelJudgeEval } from './NaturalLanguageOverallMetrics';

/** 
 * Type representing metric keys that are numeric and suitable for charting
 * These are the properties in metric objects that contain numeric values
 */
export type MetricKey = string;

/**
 * Interface for objects that can contain metrics data
 */
interface WithMetrics {
  metrics?: Record<string, MetricScores>;
}

/**
 * Props interface for the MetricsByLabelPanel component
 */
export interface MetricsByLabelPanelProps {
  /** Array of evaluation data records to display */
  evaluationData: EvaluationDataRecord[];
  /** Array of selected model names */
  selectedModels: string[];
  /** Optional judge model name for evaluation */
  judgeModel?: string | null;
}

/**
 * Interface for chart data points used in visualizations
 */
export interface ChartData {
  /** Label for the data point */
  label: string;
  /** Model name associated with this data point */
  model: string;
  /** Numeric value for the data point */
  value: number;
}

/**
 * Type alias for string-to-string mapping
 */
type StringMap = Record<string, string>;

/**
 * Interface representing a field in a datasource
 * Contains metadata about data fields including type, role, and values
 */
export interface DatasourceField {
    /** Optional unique key for the field */
    key?: number;
    /** Name of the field */
    name: string;
    /** Data type of the field */
    type?: 'nominal'| 'ordinal' | 'quantitative' | 'temporal' | 'number' | 'object';
    /** Role of the field in analysis (dimension or measure) */
    role?: 'dimension' | 'measure';
    /** Human-readable description of the field */
    description?: string;
    /** Array of possible values for this field */
    fieldValues?: Array<string | number>;
    /** Count of unique values in this field */
    fieldValuesCount?: number;
}
  
/**
 * Interface representing the result of an evaluation run
 * Contains test cases and metadata for a specific evaluation file
 */
export interface EvaluationResult {
  /** Name of the evaluation file */
  file: string;
  /** Array of test cases in this evaluation */
  results: TestCase[];
}

/**
 * Interface representing the results of a single evaluation run
 * Contains model outputs, visualizations, metrics, and judge evaluations
 */
export interface RunResult {
  /** Raw language model outputs for each model */
  model_outputs: Record<string, string>;
  /** Vega visualization specifications derived from model outputs */
  modelVegaSpecs?: Record<string, VisualizationSpec | null>;
  /** Conversion errors encountered per model */
  modelConversionErrors?: Record<string, string[]>;
  /** Metrics calculated for each model */
  metrics?: ModelMetricsMap;
  /** Judge model evaluations for each model */
  judge_evaluations?: Record<string, Record<string, ModelJudgeEval>>;
}
/**
 * Interface representing judge model evaluations
 * Nested structure: judge model -> evaluated model -> evaluation scores
 */
export interface JudgeEvaluations {
  /** Top-level key is the judge model name (e.g., "o1") */
  [judgeModel: string]: {
    /** Second-level key is the evaluated model name (e.g., "o3-mini") */
    [evaluatedModel: string]: {
      /** Relevance score (0-1) */
      relevance?: number;
      /** Explanation for relevance score */
      relevance_explanation?: string;
      /** Correctness score (0-1) */
      correctness?: number;
      /** Explanation for correctness score */
      correctness_explanation?: string;
      /** Assumptions score (0-1) */
      assumptions?: number;
      /** Explanation for assumptions score */
      assumptions_explanation?: string;
      /** Insightfulness score (0-1) */
      insightfulness?: number;
      /** Explanation for insightfulness score */
      insightfulness_explanation?: string;
      /** Follow-up relevance score (0-1) */
      follow_up_relevance?: number;
      /** Explanation for follow-up relevance score */
      follow_up_relevance_explanation?: string;
      /** Contextualizing score (0-1) */
      contextualizing?: number;
      /** Explanation for contextualizing score */
      contextualizing_explanation?: string;
      /** Coherence score (0-1) */
      coherence?: number;
      /** Explanation for coherence score */
      coherence_explanation?: string;
    };
  };
}



/**
 * Interface representing a single evaluation data record
 * Contains all data for a specific test case including inputs, outputs, metrics, and evaluations
 */
export interface EvaluationDataRecord {
    /** Child records for hierarchical data structures */
    children?: EvaluationDataRecord[];
    /** Index of the representative run (chosen by frontend as having best visualization scores) */
    representative_run_idx?: number;
    /** Raw data for each evaluation run (0-based index) */
    run_results?: Record<number, RunResult>;
    /** Arithmetic mean of all MetricScores fields across runs, one blob per model */
    metric_averages?: ModelMetricsMap;
    /** Whether this row is expanded to show child records */
    expanded: boolean;
    
    /** Unique key for this record */
    key: string;
    /** Source file name for this evaluation */
    file: string;
    /** Input text for this test case */
    input: string;
    /** Canonical form of the input */
    canonical?: string;
    /** Alternative phrasings of the input */
    paraphrases?: string[];
    /** Expected output specification */
    expected_output: object;
    /** Model outputs mapped by model name */
    model_outputs: StringMap;
    /** Expected Vega visualization specification */
    expectedVegaSpec?: VisualizationSpec | null;
    /** Model-generated Vega specifications mapped by model name */
    modelVegaSpecs?: Record<string, VisualizationSpec | null>;
    /** Pass/fail results for each model */
    pass_fail: Record<string, boolean>;
    /** 0-based index within its own test number */
    idx?: number;
    /** Unique identifier for the row (e.g., "file|test_number|idx") */
    row_id?: string;
    /** Metrics calculated for this record */
    metrics?: ModelMetricsMap;
    /** Test case number */
    test_number?: number;
    /** Labels associated with this test case */
    labels: string[];
    /** Conversion errors encountered per model */
    modelConversionErrors: Record<string, string[]>;
    /** Expected errors for this test case */
    expectedErrors: string[];
    
    /** Judge model evaluations for this record */
    judge_evaluations?: RunResult['judge_evaluations'];
}
  
/**
 * Interface representing a single test case
 * Contains all information needed to evaluate a specific scenario
 */
export interface TestCase {
    /** Judge model evaluations for this test case */
    judge_evaluations?: Record<string, { relevance: number; explanation: string }>;
    /** Pass/fail results for each model */
    pass_fail: Record<string, boolean>;
    /** Input text for this test case */
    input: string;
    /** Expected output as a notional specification */
    expected_output: NotionalSpec;
    /** Expected natural language reply */
    expected_nl_reply: string;
    /** Model outputs mapped by model name */
    model_outputs: StringMap;
    /** Metrics calculated for this test case */
    metrics?: WithMetrics;
    /** Test case number */
    test_number?: number;
    /** Labels associated with this test case */
    labels?: string[];
    /** Canonical form of the input */
    canonical?: string;
    /** Single paraphrase of the input */
    paraphrase?: string;   
    /** Multiple paraphrases of the input */
    paraphrases?: string[];
    /** Array of utterance variations */
    utterances: string[]; 
}
  

/**
 * Interface representing the result of converting a notional spec to Vega spec
 */
export interface ConversionResult {
    /** Generated Vega visualization specification, or null if conversion failed */
    vegaSpec: VisualizationSpec | null;
    /** Array of error messages encountered during conversion */
    errors: string[];
}

/**
 * Interface extending TestCase with metrics data
 */
export interface TestCaseWithMetrics extends TestCase {
    metrics?: WithMetrics;
}

/**
 * Interface extending EvaluationResult with metrics data
 */
export interface EvaluationResultWithMetrics extends EvaluationResult {
    results: TestCaseWithMetrics[];
}

/**
 * Notional Specification Schema Types
 * 
 * The following types are based on the notional specification schema
 * for visualization specifications
 */

/** Supported chart types for visualizations */
type ChartType = 'text' | 'heatmap' | 'bar' | 'stackedbar' | 'line' | 'area' | 'gantt' | 'scatterplot' | 'histogram' | 'symbolmap' | 'filledmap' | 'treemap' | 'pie' | 'dualline' | 'boxplot' | 'bullet' | 'bubble';

/** Supported data types for fields */
type DataType = 'number' | 'string' | 'date' | 'boolean' | 'geographic' | 'set';

/** Field type classification */
type FieldType = 'discrete' | 'continuous';

/** Role of a field in analysis */
type FieldRole = 'dimension' | 'measure';

/** Aggregation functions for measures */
type Aggregation = 'default' | 'count' | 'countd' |'sum' | 'avg' | 'max' | 'min' | 'median' |
                   'year' | 'qtr' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

/** Visual encoding channels */
type Encoding = 'color' | 'size' | 'text' | 'shape' | 'x' | 'y';

/** Sort direction options */
type SortDirection = 'asc' | 'desc';

/** Relative date period units */
type RelativeDatePeriod = 'days' | 'weeks' | 'months' | 'quarters' | 'years';

/** Relative date direction */
type RelativeDirection = 'next' | 'previous';

/** Limit type for filtering */
type LimitType = 'top' | 'bottom';

/** Condition operators for filtering */
type ConditionOperator = '>' | '>=' | '<' | '<=' | '==' | '<>';

/**
 * Interface representing a field instance in a notional specification
 */
export type FieldInstance = {
  /** Human-readable caption for the field */
  caption: string;
  /** Optional unique identifier for the field */
  fieldIdentifier?: string;
  /** Data type of the field */
  data?: DataType;
  /** Field type classification */
  type?: FieldType;
  /** Role of the field in analysis */
  role?: FieldRole;
  /** Aggregation function for measures */
  aggregation?: Aggregation;
  /** Visual encoding channel for the field */
  encoding?: Encoding;
};

/**
 * Interface representing sorting specifications
 */
export type SortingSpec = {
  /** Field to sort by */
  field?: string; 
  /** Alternative field identifier for sorting */
  by: string;
  /** Aggregation to apply before sorting */
  aggregation?: Aggregation;
  /** Sort direction */
  direction?: SortDirection;
};

/**
 * Base interface for all filter types
 */
interface BaseFilter {
  /** Field name to filter on */
  field: string;
  /** Optional field identifier */
  fieldIdentifier?: string;
  /** Whether to include null values */
  includeNull?: boolean;
}

/**
 * Interface for relative date filters
 */
export type RelativeDateFilter = BaseFilter & {
  type: 'relative-date';
  /** Number of periods to offset */
  amount: number;
  /** Period unit (days, weeks, months, etc.) */
  period: RelativeDatePeriod;
  /** Direction of the offset (next or previous) */
  direction: RelativeDirection;
  /** Optional anchor date */
  anchor?: string;
};

/**
 * Interface for date range filters
 */
export type DateRangeFilter = BaseFilter & {
  type: 'date-range';
  /** Start date of the range */
  start?: string;
  /** End date of the range */
  end?: string;
};

/**
 * Interface for numeric range filters
 */
export type NumericRangeFilter = BaseFilter & {
  type: 'numeric-range';
  /** Start value of the range */
  start?: number;
  /** End value of the range */
  end?: number;
  /** Aggregation to apply before filtering */
  aggregation?: Aggregation;
};

/**
 * Interface for limit options in categorical filters
 */
export type LimitOptions = {
  /** Type of limit (top or bottom) */
  type: LimitType;
  /** Number of items to limit to */
  limit: number;
  /** Field to apply the limit to */
  field: string;
  /** Aggregation to use for ranking */
  aggregation: Aggregation;
};

/**
 * Interface for condition options in categorical filters
 */
export type ConditionOptions = {
  type: 'condition';
  /** Value to compare against */
  value: number;
  /** Comparison operator */
  operator: ConditionOperator;
  /** Field to apply the condition to */
  field: string;
  /** Aggregation to apply before comparison */
  aggregation: Aggregation;
};

/**
 * Interface for categorical filters
 */
export type CategoricalFilter = {
  type: 'categorical';
  /** Field name to filter on */
  field: string;
  /** Optional field identifier */
  fieldIdentifier?: string;
  /** Array of values to include or exclude */
  values?: string[] | number[];
  /** Whether to exclude the specified values (default: include) */
  exclude?: boolean;
  /** Optional limit options for top/bottom filtering */
  limit?: LimitOptions;
  /** Optional condition options for value-based filtering */
  condition?: ConditionOptions;
  /** Whether to include null values */
  includeNull?: boolean;
};

/**
 * Interface representing a complete notional specification
 * This is the main structure for defining visualization requirements
 */
export type NotionalSpec = {
  /** Version of the notional specification schema */
  version: string;
  /** Array of field instances defining the data structure */
  fields: FieldInstance[];
  /** Optional chart type specification */
  chart?: ChartType;
  /** Optional array of relative date filters */
  relativeDateFilters?: RelativeDateFilter[];
  /** Optional array of date range filters */
  dateRangeFilters?: DateRangeFilter[];
  /** Optional array of numeric range filters */
  rangeFilters?: NumericRangeFilter[];
  /** Optional array of categorical filters */
  categoricalFilters?: CategoricalFilter[];
  /** Optional sorting specification */
  sort?: SortingSpec;
};

/**
 * Interface for FAQ panel items
 */
export type FAQPanel = {
  /** Unique key for the FAQ item */
  key: string;
  /** Label/title for the FAQ item */
  label: ReactNode;
  /** Content/answer for the FAQ item */
  content: ReactNode;
};
