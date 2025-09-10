import { isEqual } from 'lodash';
import get from 'lodash/get' 
import deepDiff from 'deep-diff';
import { DatasourceField, FieldInstance } from './types';
import leven from 'leven'
import { stemmer } from 'stemmer'
import { describeVegaSpec } from './vizspecUtils';

/** Is the user asking for this metric helper */
const makeAllow = (enabled: string[]) => (k: string) => {
  if (!enabled || !Array.isArray(enabled)) return true;
  if (!k || typeof k !== 'string') return false;
  return enabled.includes(k);
};

/**
 * Scores for any field that is strictly 0 or 1
 */
export type BinaryScore = 0 | 1;

/**
 * Scores for axis accuracy: binary presence/field/orient/scale/title
 */
export interface AxisScores {
  x_axis_accuracy: BinaryScore;        
  y_axis_accuracy: BinaryScore;        
}

/**
 * Scores for interactivity (currently only tooltip)
 */
export interface InteractionScores {
  tooltip_accuracy: BinaryScore;      
}

/**
 * Minimal metadata for a CSV column, used in field similarity metrics
 */
interface Attribute {
  name: string;
  alias?: string;
  dataType?: string;
  columnRole?: 'dimension' | 'measure';
}

const SUBCATEGORY_METRICS = {
  data:          ['data_fidelity', 'field_similarity'],
  semantics:     ['chart_similarity'],
  functionality: [
    'filter_accuracy',
    'sort_accuracy',
    'axis.x_axis_accuracy',
    'axis.y_axis_accuracy',
  ],
  design:        ['aesthetic_accuracy', 'interactivity.tooltip_accuracy'],
} as const;

/** raw weights (summing to 31 in your original) */
const SUBCATEGORY_WEIGHTS = {
  data:          13,
  semantics:      7,
  functionality:  7,
  design:         4,
} as const;

type VizBuckets = { [K in keyof typeof SUBCATEGORY_METRICS]: number };

/* ---------- helpers ---------- */
/* ──────────────────────────────────────────────────────────────── *
 *  Which metric does each checkbox refer to?
 *  (use the same checkbox ids you keep in `enabledMetrics`)
 * ──────────────────────────────────────────────────────────────── */
export const UI_TO_METRIC: Record<string, string> = {
  /* data -------------------------------------------------------- */
  dataFidelity      : 'data_fidelity',
  fieldSimilarity   : 'field_similarity',
  /* semantics --------------------------------------------------- */
  chartSimilarity   : 'chart_similarity',
  chartTypeAcc      : 'chart_type_accuracy',
  /* functionality ---------------------------------------------- */
  filterAccuracy    : 'filter_accuracy',
  sortAccuracy      : 'sort_accuracy',
  xAxisAcc          : 'axis.x_axis_accuracy',
  yAxisAcc          : 'axis.y_axis_accuracy',
  /* design ------------------------------------------------------ */
  aestheticAccuracy : 'aesthetic_accuracy',
  tooltipAcc        : 'interactivity.tooltip_accuracy',
  /* natural language --------------------------------------------- */
  assumptions        : 'assumptions',
  insightfulness     : 'insightfulness',
  coherence          : 'coherence',
  followUpRelevance  : 'follow_up_relevance',  
  information_similarity : 'information_similarity',
};

/* quick lookup */
const isEnabled = (path: string, enabled?: string[]) => {
  /* legacy calls (no `enabled` arg) still count everything        */
  if (!enabled || !Array.isArray(enabled)) return true;
  if (!path || typeof path !== 'string') return false;
  
  const allowedPaths = enabled               // checkbox ids
    .map(k => UI_TO_METRIC[k])               // → metric paths
    .filter(Boolean);
  return allowedPaths.includes(path);
};

/**
 * Aggregated scores for all metrics in a single run
 */
export interface MetricScores {
  // precision, recall, and F1 scores 
  score_precision_recall_f1: { precision: number; recall: number; f1: number };
  // 1 if the models compiled data exactly matches the expected data; 0 otherwise.
  data_fidelity: BinaryScore;
  /** number of missing/extra fields in the data */
  data_field_errors: number;
  /** number of missing/extra rows in the data */
  data_value_errors: number;
  /** 0–1: how similar are the X/Y fields (stem+edit distance + dataType bump)? */
  field_similarity: number;
  // 0 or 1: do the filter transforms match exactly?
  filter_accuracy: BinaryScore;
  // 0 or 1: is the data sorted as expected? 
  sort_accuracy: BinaryScore;
  chart_type_accuracy: number; 
  /** 0, 0.5, 1, how close is the chosen chart to the “ideal” Show-Me suggestion? */
  chart_similarity: number;
  // 0 or 1: do the x and y axes match expected? Checks missing/extra/swap/orient/scale/title 
  axis: AxisScores;
  // 0 or 1: checks only titles, label format, and any unit formatting on each axis.
  axis_annotation: BinaryScore; 
  // 0 or 1: do all aesthetic encodings match exactly?
  aesthetic_accuracy: BinaryScore;
  // 0 or 1: do the tooltip encodings match exactly?
  interactivity: InteractionScores;
  // 0 - 1: cosine‑similarity between the expected reply and the model reply.
  information_similarity: number;
}


/**
 * A dictionary keyed by model name, each storing MetricScores.
 */
export type ModelMetricsMap = Record<string, MetricScores>;


/**
 * 2) Define a union for sort‐related payloads instead of `any`.
 */
export type SortValue =
  | boolean
  | string
  | string[]
  | { field: string; order?: 'ascending' | 'descending' };

/* =========================
   Utility Functions
========================= */

/**
 * Recursively removes any property whose key starts with an underscore (e.g. "_tb_wildcard").
 */
export const removeMetadata = (spec: any): any => {
  if (!spec) return spec;
  
  if (Array.isArray(spec)) {
    return spec.map(removeMetadata);
  } else if (typeof spec === 'object' && spec !== null) {
    const cleanedObj: any = {};
    Object.keys(spec).forEach((key) => {
      if (!key.startsWith('_')) {
        cleanedObj[key] = removeMetadata(spec[key]);
      }
    });
    return cleanedObj;
  }
  return spec;
};

/**
 * Recursively flattens an object into a dictionary with dot-separated keys.
 * For example, { a: { b: 1 } } becomes { "a.b": 1 }.
 */
export const flattenObject = (
  obj: any,
  parent: string = '',
  res: Record<string, any> = {}
): Record<string, any> => {
  if (!obj || typeof obj !== 'object') return res;
  
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      const propName = parent ? `${parent}.${key}` : key;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        flattenObject(obj[key], propName, res);
      } else {
        res[propName] = obj[key];
      }
    }
  }
  return res;
};

/**
 * Recursively removes specified properties from an object.
 */
export const removeSpecifiedProperties = (obj: any, propsToRemove: string[]): any => {
  if (!obj) return obj;
  if (!Array.isArray(propsToRemove)) return obj;
  
  if (Array.isArray(obj)) {
    return obj.map((item) => removeSpecifiedProperties(item, propsToRemove));
  } else if (typeof obj === 'object' && obj !== null) {
    const cleanedObj: any = {};
    Object.keys(obj).forEach((key) => {
      if (!propsToRemove.includes(key)) {
        cleanedObj[key] = removeSpecifiedProperties(obj[key], propsToRemove);
      }
    });
    return cleanedObj;
  }
  return obj;
};

/**
 * Returns the count of top-level keys (or array length if an array).
 */
const countElements = (obj: any): number => {
  if (!obj || typeof obj !== 'object') return 0;
  if (Array.isArray(obj)) return obj.length;
  return Object.keys(obj).length;
};

/**
 * Recursively collects property paths based on an object's "required" property.
 * This function looks for a "required" key (if present) and stores the full path.
 */
const getRequiredProps = (
  obj: any,
  currentPath: string = '',
  required: string[] = []
): string[] => {
  if (!obj || typeof obj !== 'object') return required;
  
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      if (item && typeof item === 'object') {
        getRequiredProps(item, `${currentPath}[${index}]`, required);
      }
    });
  } else {
    if (obj.required && Array.isArray(obj.required)) {
      obj.required.forEach((prop: string) => {
        if (typeof prop === 'string') {
          required.push(currentPath ? `${currentPath}.${prop}` : prop);
        }
      });
    }
    Object.keys(obj).forEach((key) => {
      if (obj[key] && typeof obj[key] === 'object') {
        getRequiredProps(obj[key], currentPath ? `${currentPath}.${key}` : key, required);
      }
    });
  }
  return required;
};

/**
 * Retrieves a nested value from an object given a dot-delimited path.
 * Supports array syntax like "fields[0].caption".
 */
const getValueByPath = (obj: any, path: string): any => {
  if (!obj || !path || typeof path !== 'string') return undefined;
  
  return path.split('.').reduce((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    
    const match = part.match(/(\w+)\[(\d+)\]/);
    if (match) {
      const [_, key, index] = match;
      return acc && typeof acc === 'object' && acc[key] && Array.isArray(acc[key]) 
        ? acc[key][parseInt(index, 10)] 
        : undefined;
    }
    return acc && typeof acc === 'object' ? acc[part] : undefined;
  }, obj);
};

/**
 * Helper to extract field identifiers from a spec.
 * It first checks the "fields" array; if empty, it falls back to "categoricalFilters".
 * Returns an array of strings (e.g. using fieldIdentifier or caption).
 */
const extractFieldIdentifiers = (spec: any): string[] => {
  if (!spec || typeof spec !== 'object') return [];
  
  if (Array.isArray(spec.fields) && spec.fields.length > 0) {
    const ids = spec.fields
      .map((field: any) => {
        if (field && typeof field === 'object') {
          return field.fieldIdentifier || field.caption;
        }
        return null;
      })
      .filter((id: any) => !!id);
    return ids;
  } else if (Array.isArray(spec.categoricalFilters) && spec.categoricalFilters.length > 0) {
    const ids = spec.categoricalFilters
      .map((filter: any) => {
        if (filter && typeof filter === 'object') {
          return filter.field;
        }
        return null;
      })
      .filter((f: any) => !!f);
    return ids;
  }
  return [];
};

function compareDataArrays(exp: any[] = [], act: any[] = []) {
  // Ensure inputs are arrays
  if (!Array.isArray(exp)) exp = [];
  if (!Array.isArray(act)) act = [];
  
  /* canonical string for a row */
  const norm = (r: any) => {
    if (!r || typeof r !== 'object') return '';
    return JSON.stringify(
      Object.keys(r).sort().reduce((acc, k) => {
        acc[k] = r[k];
        return acc;
      }, {} as any)
    );
  };

  /* ---------- field-level ---------- */
  const fieldSet = (rows: any[]) => {
    const fields = new Set<string>();
    rows.forEach(r => {
      if (r && typeof r === 'object') {
        Object.keys(r).forEach(field => fields.add(field));
      }
    });
    return fields;
  };
  
  const expFields = fieldSet(exp);
  const actFields = fieldSet(act);

  const missingFields = Array.from(expFields).filter(f => !actFields.has(f)).length;
  const extraFields   = Array.from(actFields).filter(f => !expFields.has(f)).length;
  const fieldErrors   = missingFields + extraFields;

  /* ---------- row-level ---------- */
  const expRows = new Set(exp.map(norm).filter(r => r !== ''));
  const actRows = new Set(act.map(norm).filter(r => r !== ''));

  const missingRows = Array.from(expRows).filter(r => !actRows.has(r)).length;
  const extraRows   = Array.from(actRows).filter(r => !expRows.has(r)).length;
  const valueErrors = missingRows + extraRows;

  return { fieldErrors, valueErrors };
}

/**  Where did this sort live? */
interface SortDescriptor {
  kind: 'scale' | 'transform';
 // for scale‐domain sorts:
  channel?: string;
  // for transform sorts:
  transformType?: string;
  // the actual sort payload (boolean | string | string[] | { field, order })
  sort: SortValue;
}

/**
 * Walk a Vega-Lite spec and pull out *all* of the places
 * you might have put a "sort" directive.
 */
function extractAllSorts(spec: any): SortDescriptor[] {
  /* ── NEW: bail early if spec is falsy or not an object ────────────── */
  if (!spec || typeof spec !== 'object') return [];

  const result: SortDescriptor[] = [];

  // 1) scale / domain sorts in encoding
  if (spec.encoding && typeof spec.encoding === 'object') {
    for (const channel of Object.keys(spec.encoding)) {
      const enc = spec.encoding[channel];
      if (enc && enc.sort !== undefined) {
        result.push({ kind: 'scale', channel, sort: enc.sort as SortValue });
      }
    }
  }

  // 2) transform-level sorts
  if (Array.isArray(spec.transform)) {
    for (const tr of spec.transform) {
      if (tr && typeof tr === 'object' && tr.sort !== undefined) {
        result.push({
          kind: 'transform',
          transformType: String(tr.type || tr.aggregate ? 'window/stack' : 'collect'),
          sort: tr.sort as SortValue,
        });
      }
      if (tr && typeof tr === 'object' && tr.type === 'window' && Array.isArray(tr.sort)) {
        result.push({ kind: 'transform', transformType: 'window', sort: tr.sort });
      }
      if (tr && typeof tr === 'object' && tr.type === 'stack' && tr.sort) {
        result.push({ kind: 'transform', transformType: 'stack', sort: tr.sort });
      }
    }
  }

  return result;
}

/**
 * Given the notionalSpec.fields, decide which chart is best and
 * which others are still plausible.
 */
export function getShowMeRecommendations(notionalSpec: { fields?: FieldInstance[] }) {
  const fields: FieldInstance[] = notionalSpec.fields ?? [];
  const isTime  = (f: FieldInstance) => f.data === 'date';
  const isQuant = (f: FieldInstance) => f.data === 'number';
  const isCat   = (f: FieldInstance) => f.data === 'string';

  const timeFields = fields.filter(isTime).length;
  const quantMeas  = fields.filter(f => isQuant(f) && f.role === 'measure').length;
  const catAll     = fields.filter(isCat).length;
  const quantAll   = fields.filter(isQuant).length;

  const plausible = new Set<string>();
  let best: string | null = null;

  // 1) time + measure : best=line, plausible={line, area, bar}
  if (timeFields >= 1 && quantMeas >= 1) {
    best = 'line';
    plausible.add('line');
    plausible.add('area');
    plausible.add('bar');
  }

  // 2) category + measure : best=bar (if not already set), plausible += {bar, pie, text}
  if (catAll >= 1 && quantMeas >= 1) {
    if (!best) best = 'bar';
    plausible.add('bar');
    plausible.add('pie');
    plausible.add('text');
  }

  // 3) two+ measures : best=scatterplot (if not set), plausible += {scatterplot, bubble}
  if (quantMeas >= 2) {
    if (!best) best = 'scatterplot';
    plausible.add('scatterplot');
    plausible.add('bubble');
  }

  // 4) exactly one category, no measures : best=text, plausible += {text, bar}
  if (catAll === 1 && quantAll === 0) {
    if (!best) best = 'text';
    plausible.add('text');
    plausible.add('bar');
  }

  // 5) exactly one measure, no cat or time : best=histogram (bar), plausible += {histogram, boxplot}
  if (quantAll === 1 && catAll === 0 && timeFields === 0) {
    if (!best) best = 'histogram';
    plausible.add('histogram');
    plausible.add('boxplot');
  }

  // just in case nothing matched above, fall back to a table
  if (!best) {
    best = 'text';
    plausible.add('text');
  }

  return { best, plausible: Array.from(plausible) };
}

// Helper to normalize and stem a field name
function stemFieldName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  
  // lowercase + strip non-letters before stemming
  const cleaned = name.toLowerCase().replace(/[^a-z]/g, ' ')
  
  return stemmer(cleaned.trim())
}

/**
 * 0–1 semantic similarity between two column attributes:
 *  - exact name match : 1
 *  - else: stem + levenshtein → base score
 *  - +0.1 bump if same dataType
 */
function semanticSimilarity(a: Attribute, b: Attribute): number {
  if (!a || !b) return 0;
  if (!a.name || !b.name) return 0;
  
  const nameA = stemFieldName(a.name)
  const nameB = stemFieldName(b.name);
  if (nameA === nameB) return 1;

  // normalized edit-distance
  const distance = leven(nameA, nameB);
  const base = Math.max(0, 1 - distance / Math.max(nameA.length, nameB.length));

  // bump for matching dataType
  if (a.dataType && b.dataType && a.dataType === b.dataType) {
    return Math.min(1, base + 0.1);
  }
  return base;
}

const DEFAULT_STOPWORDS = new Set([
  "a", "an", "and", "the", "is", "it", "on", "in", "at", "to", "of", "for", "with", "as", "by", "that", "this", "was", "were", "be"
]);


// Lower-case, strip punctuation/stopwords, split into words
function normalizeText(text: string, stopwords: Set<string> = DEFAULT_STOPWORDS): string[] {
  if (!text || typeof text !== 'string') return [];
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(word => word && !stopwords.has(word));
}


// Build a frequency map from an array of tokens
function getWordFrequency(words: string[]): Map<string, number> {
  if (!Array.isArray(words)) return new Map();
  
  const freqMap = new Map<string, number>();
  for (const word of words) {
    if (word && typeof word === 'string') {
      freqMap.set(word, (freqMap.get(word) || 0) + 1);
    }
  }
  return freqMap;
}

// Cosine similarity between two frequency maps
function cosineSimilarity(
  freqA: Map<string, number>,
  freqB: Map<string, number>
): number {
  if (!freqA || !freqB || !(freqA instanceof Map) || !(freqB instanceof Map)) {
    return 0;
  }
  
  const allWords = new Set<string>([
    ...Array.from(freqA.keys()),
    ...Array.from(freqB.keys())
  ]);

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  allWords.forEach(word => {
    const a = freqA.get(word) || 0;
    const b = freqB.get(word) || 0;
    dotProduct += a * b;
    magA += a * a;
    magB += b * b;
  });

  // if either side is zero, denominator becomes zero → return 0
  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

// Jaccard similarity between two sets of tokens
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (!setA || !setB || !(setA instanceof Set) || !(setB instanceof Set)) {
    return 0;
  }
  
  // 1) compute intersection
  let intersectionSize = 0;
  setA.forEach(w => {
    if (setB.has(w)) {
      intersectionSize++;
    }
  });

  // 2) compute union without `[...setA, ...setB]`
  const unionSet = new Set<string>();
  setA.forEach(w => unionSet.add(w));
  setB.forEach(w => unionSet.add(w));
  const unionSize = unionSet.size;

  return unionSize > 0 ? intersectionSize / unionSize : 0;
}


export function computeMetrics(
  actualSpec: any,
  expectedSpec: any,
  actualVega: any | null,
  expectedVega: any | null,
  datasourceFields: DatasourceField[],
  dataValues: any[],
  expectedNL: string,
  actualNL: string, 
  enabled: string[]
): MetricScores {
  const allow = makeAllow(enabled);
  const removableProps: string[] = [];
  const cleanActual   = removeSpecifiedProperties(actualSpec,   removableProps);
  const cleanExpected = removeSpecifiedProperties(expectedSpec, removableProps);

  

  // always start from an all-zero shell
  const metrics = emptyMetricScores();

  // Accuracy metrics 
  if (allow('precision') || allow('recall') || allow('f1')) {
  const prf = scorePrecisionRecallF1(
    cleanActual,
    cleanExpected,
    datasourceFields,
    dataValues
  );
  if (allow('precision')) metrics.score_precision_recall_f1.precision = prf.precision;
  if (allow('recall'))    metrics.score_precision_recall_f1.recall    = prf.recall;
  if (allow('f1'))        metrics.score_precision_recall_f1.f1        = prf.f1;
}

  /* ── data-level metrics (only if both Vega specs exist) ── */
  if (allow('dataFidelity')) {
  if (actualVega && expectedVega) {
    const df = scoreDataFidelity(expectedVega, actualVega);
    metrics.data_fidelity     = df.data_fidelity as BinaryScore;
    metrics.data_field_errors = df.data_field_errors;
    metrics.data_value_errors = df.data_value_errors;
  }}

 if (allow('fieldSimilarity')) { 
 metrics.field_similarity =
  expectedVega && actualVega ? scoreFieldSimilarity(expectedVega, actualVega, datasourceFields)
                              : 0;
  }
  /* ── semantic metrics ── */
  if (allow('chartTypeAcc')){  
  metrics.chart_type_accuracy = expectedVega && actualVega ? scoreChartTypeAccuracy(expectedVega, actualVega) : 0;
  }

  if (allow('chartSimilarity')) {
    metrics.chart_similarity = expectedVega && actualVega ? scoreChartSimilarity(expectedVega, actualVega) : 0; 
  }

  /* ── functionality metrics ── */
  if (allow('filterAccuracy')) {
  metrics.filter_accuracy = scoreFilterAccuracy(expectedVega, actualVega) as BinaryScore;
  }
  if (allow('sortAccuracy')) {
  metrics.sort_accuracy = scoreSortAccuracy(expectedVega, actualVega) as BinaryScore;
  }


  if (allow('xAxisAcc') || allow('yAxisAcc')) {
  metrics.axis = scoreAxisAccuracy(expectedVega, actualVega);
  }
  
  if (allow('aestheticAccuracy')){
  metrics.aesthetic_accuracy = scoreAestheticAccuracy(expectedVega, actualVega) as BinaryScore;
  } 
  if (allow('tooltipAcc')) {
  metrics.interactivity = scoreInteractivityAccuracy(expectedVega, actualVega);
  }

/* ──────────────────────────────────────────────────────────────
     INFORMATION‑EQUIVALENCE
     --------------------------------------------------------------
     If either side is missing a user‑friendly reply, fall back to
     an auto‑generated plain‑English description of the Vega spec.
  ────────────────────────────────────────────────────────────── */
  let expReply = expectedNL;
  if (!expReply && expectedVega) {
    expReply = describeVegaSpec(expectedVega, dataValues);
  }

  let actReply = actualNL;
  if (!actReply && actualVega) {
    actReply = describeVegaSpec(actualVega, dataValues);
  }

  if (allow('information_similarity')) {
    metrics.information_similarity = scoreInformationSimilarity(
      expReply ?? '',
      actReply ?? ''
    );
  }

  return metrics;
}

/* =========================
   Metric Functions
========================= */
/**
 * Field-Aware Precision, Recall, and F1.
 * 
 * - Removes the "version" field.
 * - Extracts field identifiers from the "fields" array; if empty, falls back to "categoricalFilters".
 * - Optionally adds the "chart" property.
 * - Computes set-based precision, recall, and F1.
 */

export const scorePrecisionRecallF1 = (
  actual: any,
  expected: any,
  datasourceFields: DatasourceField[],
  dataValues: any[]
): { precision: number; recall: number; f1: number } => {
  // Handle null/undefined cases
  if (!actual && !expected) {
    return { precision: 1, recall: 1, f1: 1 };
  }
  if (!actual || !expected) {
    return { precision: 0, recall: 0, f1: 0 };
  }
  
  // Remove version from both specs.
  const { version: _ignoreA, ...actualNoVersion } = actual ?? {};
  const { version: _ignoreB, ...expectedNoVersion } = expected ?? {};
  // Extract chart property.
  const actualChart = actualNoVersion.chart;
  const expectedChart = expectedNoVersion.chart;

  // Extract field identifiers.
  const actualIds: string[] = extractFieldIdentifiers(actualNoVersion);
  const expectedIds: string[] = extractFieldIdentifiers(expectedNoVersion);

  // Build sets.
  const actualSet: Set<string> = new Set(actualIds);
  const expectedSet: Set<string> = new Set(expectedIds);
  

  // Optionally add chart.
  const addChart = true;
  if (addChart) {
    if (actualChart) actualSet.add(`chart:${actualChart}`);
    if (expectedChart) expectedSet.add(`chart:${expectedChart}`);
  }
 
  // Compute precision, recall, and F1.
  const matched = Array.from(actualSet).filter((id: string) => expectedSet.has(id));
  
  const precision = actualSet.size ? matched.length / actualSet.size : 0;
  const recall = expectedSet.size ? matched.length / expectedSet.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1 };
};

// Data Fidelity
export function scoreDataFidelity(expectedVega: any, actualVega: any) {
  // Handle null/undefined cases
  if (!expectedVega && !actualVega) {
    return {
      data_fidelity: 1,
      data_field_errors: 0,
      data_value_errors: 0
    };
  }
  if (!expectedVega || !actualVega) {
    return {
      data_fidelity: 0,
      data_field_errors: 1,
      data_value_errors: 1
    };
  }
  
  const expVals: any[] = expectedVega?.data?.values ?? [];
  const actVals: any[] = actualVega?.data?.values ?? [];

  const { fieldErrors, valueErrors } = compareDataArrays(expVals, actVals);
  const perfect = fieldErrors === 0 && valueErrors === 0 ? 1 : 0;

  return {
    data_fidelity: perfect,
    data_field_errors: fieldErrors,
    data_value_errors: valueErrors
  };
}

/**
 * Look at encoding.x.field and encoding.y.field in expected vs actual,
 * stem each name, compute Levenshtein distance, convert to [0,1], 
 * Metadata lookup tries both `name` and `alias`; if none found, falls back to bare name.
 */
export function scoreFieldSimilarity(
  expected: any,
  actual: any,
  metadata: Attribute[]
): number {
  // Handle null/undefined cases
  if (!expected && !actual) return 1; // Both missing is a match
  if (!expected || !actual) return 0; // One missing, one present is a mismatch
  
  const getF = (spec: any, ch: 'x'|'y'): string | null =>
    spec?.encoding?.[ch]?.field ?? null;

  const expX = getF(expected, 'x');
  const actX = getF(actual,   'x');
  const expY = getF(expected, 'y');
  const actY = getF(actual,   'y');

  const findAttr = (field: string | null): Attribute | null => {
    if (!field) return null;
    return (
      metadata.find(m => m.name === field || m.alias === field)
      ?? { name: field }
    );
  };

  const ax = findAttr(expX);
  const bx = findAttr(actX);
  const ay = findAttr(expY);
  const by = findAttr(actY);

  const simX = (ax && bx) ? semanticSimilarity(ax, bx) : 0;
  const simY = (ay && by) ? semanticSimilarity(ay, by) : 0;

  // Handle cases where one or both axes might be missing
  if (!expX && !actX && !expY && !actY) {
    return 1; // Both specs have no fields defined
  }
  
  if ((!expX && !expY) || (!actX && !actY)) {
    return 0; // One spec has fields, the other doesn't
  }

  // If only one axis is present, only compare that one
  if (!expX && !actX) {
    return simY;
  }
  if (!expY && !actY) {
    return simX;
  }

  // final score is the average of the two channels
  return (simX + simY) / 2;
}

const getMarkType = (spec: any): string | null => {
  if (!spec || typeof spec !== 'object') return null;
  if (typeof spec.mark === 'string') return spec.mark.toLowerCase();
  if (spec.mark && typeof spec.mark === 'object' && spec.mark.type)
    return String(spec.mark.type).toLowerCase();
  return null;
};

/**
 * Map a Vega "mark" or nested spec into our conceptual chart type.
 */
export function getChartTypeFromVega(spec: any): string | null {
  if (!spec || typeof spec !== 'object') return null;
  // top–level VL spec
  let m: string|null = null;
  if (typeof spec.mark === "string") {
    m = spec.mark.toLowerCase();
  } else if (spec.mark && typeof spec.mark === 'object' && spec.mark.type) {
    m = String(spec.mark.type).toLowerCase();
  }

  // fallback to nested "marks" array (Vega output)
  if (!m && Array.isArray((spec as any).marks) && (spec as any).marks.length > 0) {
    const firstMark = (spec as any).marks[0];
    if (firstMark && typeof firstMark === 'object') {
      m = (firstMark.type || "").toLowerCase();
    }
  }
  if (!m) return null;

  // normalize Vega primitives into our conceptual types
  switch (m) {
    case "rect":       return "bar";
    case "circle":
    case "point":      return "scatterplot";
    case "line":       return "line";
    case "arc":        return "pie";
    case "text":       return "text";
    case "geoshape":   return "symbolmap";
    // add more as needed…
    default:           return m;
  }
}



/**
 * Compare the two specs' top‐level `transform.filter` arrays.
 * Returns 1 iff both have the same filters (same length and same JSON),
 * else 0.
 */
export function scoreFilterAccuracy(expected: any, actual: any): number {
  // Handle null/undefined cases
  if (!expected && !actual) return 1; // Both missing is a match
  if (!expected || !actual) return 0; // One missing, one present is a mismatch
  
  const expFilters = expected?.transform?.filter ?? [];
  const actFilters = actual?.transform?.filter ?? [];

  // Quick check on length
  if (expFilters.length !== actFilters.length) {
    return 0;
  }

  // If both are empty, that's a match
  if (expFilters.length === 0 && actFilters.length === 0) {
    return 1;
  }

  // Compare each filter by JSON stringification in order
  for (let i = 0; i < expFilters.length; i++) {
    if (JSON.stringify(expFilters[i]) !== JSON.stringify(actFilters[i])) {
      return 0;
    }
  }

  return 1;
}

/**
 * 1 if and only if the entire list of sorts in expected spec
 * matches exactly (order & semantics) the ones in the actual spec.
 */
export function scoreSortAccuracy(expected: any, actual: any): number {
  // Handle null/undefined cases
  if (!expected && !actual) return 1; // Both missing is a match
  if (!expected || !actual) return 0; // One missing, one present is a mismatch
  
  const exp = extractAllSorts(expected);
  const act = extractAllSorts(actual);

  // If both have no sorts, that's a match
  if (exp.length === 0 && act.length === 0) {
    return 1;
  }

  if (exp.length !== act.length) return 0;

  // Compare each descriptor in order
  for (let i = 0; i < exp.length; i++) {
    const a = exp[i], b = act[i];
    // same kind, same channel/transformType, and deeply equal sort payload
    if (a.kind !== b.kind) return 0;
    if (a.channel !== b.channel) return 0;
    if (a.transformType !== b.transformType) return 0;
    if (JSON.stringify(a.sort) !== JSON.stringify(b.sort)) return 0;
  }

  return 1;
}

export const scoreChartTypeAccuracy = (expected: any, actual: any): number => {
  // Handle null/undefined cases
  if (!expected && !actual) return 1; // Both missing is a match
  if (!expected || !actual) return 0; // One missing, one present is a mismatch
  
  const expMark = getMarkType(expected);
  const actMark = getMarkType(actual);
  
  return expMark === actMark ? 1 : 0;
};

/**  
 * 1 if and only if the entire axis matches on
 *   • field  
 *   • orientation  
 *   • zero‐baseline  
 *   • scale type  
 *   • title & format  
 * else 0  
 */
const analyseAxis = (
  axisKey: 'x' | 'y',
  expected: any,
  actual: any
): BinaryScore => {
  // Handle null/undefined cases
  if (!expected && !actual) return 1; // Both missing is a match
  if (!expected || !actual) return 0; // One missing, one present is a mismatch
  
  const expEnc = expected?.encoding?.[axisKey];
  const actEnc = actual?.encoding?.[axisKey];

  // missing versus extra
  if (!expEnc && !actEnc) return 1;
  if (!expEnc || !actEnc) return 0;

  // field match
  if (expEnc.field !== actEnc.field) return 0;

  // orient
  const expOrient = expEnc.axis?.orient ?? 'bottom';
  const actOrient = actEnc.axis?.orient ?? 'bottom';
  if (expOrient !== actOrient) return 0;

  // zero‐baseline
  const expZero = expEnc.scale?.zero ?? true;
  const actZero = actEnc.scale?.zero ?? true;
  if (expZero !== actZero) return 0;

  // scale type
  const expScale = expEnc.scale?.type ?? 'linear';
  const actScale = actEnc.scale?.type ?? 'linear';
  if (expScale !== actScale) return 0;

  // title/format –– reuse your existing helper to keep them in sync
  // scoreAxisAnnotation returns 1 only if both axes match,
  // so here we re‐compute per‐axis:
  const getAxisProps = (enc: any) => {
    if (!enc) return { title: '', format: '' };
    return {
      title: (enc.axis?.title as string) ?? (enc.title as string) ?? '',
      format: (enc.axis?.format as string) ?? (enc.format as string) ?? ''
    };
  };
  const expProps = getAxisProps(expEnc);
  const actProps = getAxisProps(actEnc);
  if (expProps.title !== actProps.title || expProps.format !== actProps.format) {
    return 0;
  }

  return 1;
};

/**
 * 1. If the actual mark is exactly the best according to Show Me Logic: 1
 * 2. Else if it's in the plausible set: 0.5
 * 3. Otherwise: 0
 */
export function scoreChartSimilarity(
  expectedVegaSpec: any,
  actualVegaSpec: any
): number {
  if (!actualVegaSpec) return 0;
  
  // Get the expected chart type from the expected Vega spec
  const expectedType = getChartTypeFromVega(expectedVegaSpec);
  const actualType = getChartTypeFromVega(actualVegaSpec);

  // 1) no detectable chart: zero
  if (!actualType) {
    return 0;
  }

  // 2) exact match with expected chart type
  if (expectedType && actualType === expectedType) {
    return 1;
  }

  // 3) if we have expected type but no match, check if actual is plausible
  if (expectedType) {
    // For now, consider any chart type as plausible if it's a valid chart type
    // This is a simplified approach - you might want to implement more sophisticated logic
    const validChartTypes = ['bar', 'line', 'scatterplot', 'pie', 'text', 'area', 'histogram', 'boxplot', 'bubble'];
    if (validChartTypes.includes(actualType)) {
      return 0.5;
    }
  }

  // 4) everything else
  return 0;
}

export const scoreAxisAccuracy = (
  expectedVega: any,
  actualVega: any
): AxisScores => ({
  x_axis_accuracy: analyseAxis('x', expectedVega, actualVega),
  y_axis_accuracy: analyseAxis('y', expectedVega, actualVega),
});

/**
 * 1 if ALL of the specified aesthetic channels
 *   (color, shape, opacity, text, size) are deeply equal
 *   between expected and actual specs; else 0.
 */
export function scoreAestheticAccuracy(expected: any, actual: any): number {
  // Handle null/undefined cases
  if (!expected && !actual) return 1; // Both missing is a match
  if (!expected || !actual) return 0; // One missing, one present is a mismatch
  
  const channels = ['color','shape','opacity','text','size'] as const;
  for (const ch of channels) {
    const expEnc = expected?.encoding?.[ch] ?? null;
    const actEnc = actual?.encoding?.[ch] ?? null;
    if (JSON.stringify(expEnc) !== JSON.stringify(actEnc)) {
      return 0;
    }
  }
  return 1;
}

export const scoreInteractivityAccuracy = (
  expected: any,
  actual: any
): InteractionScores => {
  // Handle null/undefined cases
  if (!expected && !actual) return { tooltip_accuracy: 1 }; // Both missing is a match
  if (!expected || !actual) return { tooltip_accuracy: 0 }; // One missing, one present is a mismatch
  
  const expTooltip = expected?.encoding?.tooltip;
  const actTooltip = actual?.encoding?.tooltip;

  /* simplest heuristic: both exist and stringify-equal (or both absent) */
  const tooltipAcc =
    JSON.stringify(expTooltip ?? null) === JSON.stringify(actTooltip ?? null)
      ? 1
      : 0;

  return { tooltip_accuracy: tooltipAcc };
};

/**
 * Cosine‑similarity between the expected ↔︎ actual natural‑language replies.
 * ‑ Lower‑cases, strips punctuation / stop‑words, builds term‑frequency vectors,
 *   then returns the cosine ∈ [0, 1]. 1 → identical vocabulary/weights.
 */
export function scoreInformationSimilarity(
  expectedReply: string,
  actualReply: string
): number {
  if (!expectedReply || !actualReply) return 0;

  const wordsE = normalizeText(expectedReply);
  const wordsA = normalizeText(actualReply);

  return cosineSimilarity(
    getWordFrequency(wordsE),
    getWordFrequency(wordsA)
  );
}

/* =========================
   Helper: make an all-zero MetricScores
========================= */
export const emptyMetricScores = (): MetricScores => ({
  score_precision_recall_f1: { precision: 0, recall: 0, f1: 0 },
  data_fidelity           : 0,
  data_field_errors       : 0,
  data_value_errors       : 0,
  field_similarity      : 0,
  filter_accuracy         : 0,
  sort_accuracy           : 0,
  chart_type_accuracy     : 0,
  chart_similarity        : 0,
  axis                    : { x_axis_accuracy: 0, y_axis_accuracy: 0 },
  axis_annotation         : 0,
  aesthetic_accuracy      : 0,
  interactivity           : { tooltip_accuracy: 0 }, 
  information_similarity : 0
});

/* =========================
   Averaging Function
========================= */
export const averageMetrics = (arr: MetricScores[]): MetricScores => {
  /* 1.  start with all-zero scores */
  const agg = emptyMetricScores();
  if (!arr || !Array.isArray(arr) || arr.length === 0) return agg;

  /* 2.  accumulate */
  arr.forEach(m => {
    if (!m || typeof m !== 'object') return;
    
    agg.score_precision_recall_f1.precision += (m.score_precision_recall_f1?.precision ?? 0);
    agg.score_precision_recall_f1.recall    += (m.score_precision_recall_f1?.recall ?? 0);
    agg.score_precision_recall_f1.f1        += (m.score_precision_recall_f1?.f1 ?? 0);

    agg.data_fidelity        += (m.data_fidelity ?? 0);
    agg.data_field_errors    += (m.data_field_errors ?? 0);
    agg.data_value_errors    += (m.data_value_errors ?? 0);
    agg.field_similarity     += (m.field_similarity ?? 0);
    agg.filter_accuracy      += (m.filter_accuracy ?? 0);
    agg.sort_accuracy        += (m.sort_accuracy ?? 0);
    agg.chart_type_accuracy  += (m.chart_type_accuracy ?? 0);
    agg.chart_similarity     += (m.chart_similarity ?? 0);
    agg.axis.x_axis_accuracy += (m.axis?.x_axis_accuracy ?? 0);
    agg.axis.y_axis_accuracy += (m.axis?.y_axis_accuracy ?? 0);
    agg.axis_annotation      += (m.axis_annotation ?? 0);
    agg.aesthetic_accuracy   += (m.aesthetic_accuracy ?? 0);
    agg.interactivity.tooltip_accuracy += (m.interactivity?.tooltip_accuracy ?? 0);
    agg.information_similarity += (m.information_similarity ?? 0);
  });

  /* 3.  divide by N to turn sums into means */
  const n = arr.length;
  agg.score_precision_recall_f1.precision /= n;
  agg.score_precision_recall_f1.recall    /= n;
  agg.score_precision_recall_f1.f1        /= n;

  agg.data_fidelity        /= n;
  agg.data_field_errors    /= n;
  agg.data_value_errors    /= n;
  agg.field_similarity     /= n;
  agg.filter_accuracy      /= n;
  agg.sort_accuracy        /= n;
  agg.chart_type_accuracy  /= n;
  agg.chart_similarity     /= n;
  agg.axis.x_axis_accuracy /= n;
  agg.axis.y_axis_accuracy /= n;
  agg.axis_annotation      /= n;
  agg.aesthetic_accuracy   /= n;
  agg.interactivity.tooltip_accuracy /= n;
  agg.information_similarity /= n;

  return agg;
};


/** arithmetic mean of a list of numbers (or 0 if empty) */
function mean(xs: number[]): number {
  if (!xs || !Array.isArray(xs) || xs.length === 0) return 0;
  
  const validNumbers = xs.filter(x => typeof x === 'number' && !isNaN(x));
  return validNumbers.length ? validNumbers.reduce((a,b) => a+b, 0) / validNumbers.length : 0;
}

/**
 * Compute each of the four [0–1] sub‐category scores
 */
export function computeVisualizationSubcategoryScores(
  ms: MetricScores,
  enabled?: string[]
): VizBuckets {
  if (!ms || typeof ms !== 'object') {
    return {
      data: NaN,
      semantics: NaN,
      functionality: NaN,
      design: NaN
    };
  }
  
  return (Object.keys(SUBCATEGORY_METRICS) as Array<keyof typeof SUBCATEGORY_METRICS>)
    .reduce((acc, bucketKey) => {
      // 1) widen the readonly tuple → string[]
      const metricPaths: string[] = [...SUBCATEGORY_METRICS[bucketKey]];

      // 2) keep only those metrics the user enabled
      const vals = metricPaths
        .filter((k: string) => isEnabled(k, enabled))     // <– k typed
        .map((k: string) => {
          const value = get(ms, k, 0);
          return typeof value === 'number' && !isNaN(value) ? value : 0;
        });

      // 3) if *all* metrics in a bucket are disabled, ignore that bucket
      return {
        ...acc,
        [bucketKey]: vals.length ? mean(vals) : NaN
      };
    }, {} as VizBuckets);
}


/**
 * Compute one overall [0–1] visualization score by weighting the
 * four buckets with your original participant-counts
 */
export function computeOverallVisualizationScore(ms: MetricScores, enabled?: string[]): number {
  if (!ms || typeof ms !== 'object') return 0;
  
  const buckets = computeVisualizationSubcategoryScores(ms, enabled);
  const valid = Object.entries(buckets).filter(([ , v ]) => typeof v === 'number' && !Number.isNaN(v));
  if (valid.length === 0) return 0;   // user disabled everything

  // total weight of the remaining buckets 
  const totalWeight = valid
     .reduce((sum,[k]) => sum + SUBCATEGORY_WEIGHTS[k as keyof VizBuckets], 0);

  return valid.reduce(
    (acc,[k,v]) =>
      acc + v * (SUBCATEGORY_WEIGHTS[k as keyof VizBuckets] / totalWeight),
    0
  );
}
