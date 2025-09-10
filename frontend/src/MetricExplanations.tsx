import React from 'react';
import { Collapse } from 'antd';
import type { MetricScores } from './metrics';
import { ModelJudgeEval, JudgeMetricKey, judgeMetricsInfo } from './NaturalLanguageOverallMetrics';

/* This component renders human‑readable explanations for issues in a model's reply
(visualisation, specification, and natural‑language buckets).
Drives the text in the collapsible "Issues" panel that lives under
every model‑response card.
For each metric that scores <100 % (or <5 ★) we generate a concise
sentence that tells reviewers exactly *why* the metric was penalised,
referencing the expected vs. actual Vega‑Lite specs.*/

//   score argument is optional (some metrics ignore it)
//   can return plain text or rich JSX
type ExplainFn = (score?: number) => React.ReactNode;

/**
 * Type for Vega-Lite specifications that includes only the properties
 * actually used by MetricExplanations component
 */
type VegaSpecForMetrics = {
  encoding?: {
    x?: { 
      field?: string; 
      sort?: any;
      scale?: { type?: string };
    };
    y?: { 
      field?: string; 
      sort?: any;
      scale?: { type?: string };
    };
    tooltip?: any;
    [key: string]: any;
  };
  mark?: any; // Allow any mark type since it can be string or object
  transform?: any[]; // Allow any transform array since we access by index
  [key: string]: any; // Allow other properties that might be accessed
};

// Utility function to extract metric values from the metrics object
const getMetricValue = (key: string, metrics?: MetricScores): number => {
  if (key.startsWith('axis.')) {
    return (metrics?.axis as any)?.[key.split('.')[1]] ?? 1;
  }
  if (key === 'interactivity.tooltip_accuracy') {
    return metrics?.interactivity?.tooltip_accuracy ?? 1;
  }
  return (metrics as any)?.[key] ?? 1;
};

// Utility function to check if a metric is perfect (>= 0.999)
const isPerfect = (key: string, metrics?: MetricScores): boolean => {
  const val = getMetricValue(key, metrics);
  return typeof val === 'number' && val >= 0.999;
};


// Maps our internal bucket‑keys to UI labels
const bucketLabel: Record<string,string> = {
  data:          'Data',
  semantics:     'Semantics',
  functionality: 'Functionality',
  design:        'Design',
};

/* Prettier names shown in the bullet list */
const METRIC_LABEL: Record<string,string> = {
  data_fidelity                   : 'Data fidelity',
  field_similarity                : 'Field similarity',
  chart_similarity                : 'Chart similarity',
  filter_accuracy                 : 'Filter accuracy',
  sort_accuracy                   : 'Sort accuracy',
  'axis.x_axis_accuracy'          : 'X‑axis accuracy',
  'axis.y_axis_accuracy'          : 'Y‑axis accuracy',
  aesthetic_accuracy              : 'Visual encoding accuracy',
  'interactivity.tooltip_accuracy': 'Tooltip accuracy',
};

/* Mirrors the four visualisation “pill” buckets so that
explanations are emitted in the same order. */
const BUCKET_METRICS = {
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



/**
 * Simple helper that renders a titled bullet-list.  
 * Keeps markup identical everywhere we need a labelled list of issues.
 */
const SectionList: React.FC<{ title: string; items: React.ReactNode[] }> = ({
  title,
  items,
}) => (
  <>
    <p style={{ 
      fontWeight: 600, 
      marginBottom: 4,
      wordWrap: 'break-word',
      overflowWrap: 'break-word',
      whiteSpace: 'normal'
    }}>{title}</p>
    <ul
      style={{
        paddingInlineStart: 20,
        marginTop: 0,
        marginBottom: 8,
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        whiteSpace: 'normal'
     }}
   >
      {items}
    </ul>
  </>
);


interface Props {
  // metrics:  MetricScores for one model+run
  metrics?: MetricScores;
  // judge:  Per‑metric judge scores / explanations (optional)
  judge?:  ModelJudgeEval;
  // expectedVega: Gold‑standard Vega‑Lite spec
  expectedVega?: VegaSpecForMetrics | null;
  //  actualVega: Model‑generated Vega‑Lite spec
  actualVega?: VegaSpecForMetrics | null;
  // bare: When true, render only bullet lists (used inside aggregate/overview cards to avoid nested panels)
  bare?: boolean;
  /** If present, emit a single explanation for this metric key */
  metricKey?: string;
}


export const MetricExplanations: React.FC<Props> = ({ metrics, judge, expectedVega, actualVega, bare = false, metricKey, }) => {
  if (!metrics && !judge) return null;
    /* ------------------------------------------------------------------
     BUILD metric‑specific explainers **inside** the component so they
     can reference expected/actual specs for concrete differences.
  ------------------------------------------------------------------ */
  const makeExplainers = (): Record<string, ExplainFn> => ({
    
    data_fidelity: (): React.ReactNode => {
      const fieldErr = metrics?.data_field_errors ?? 0;
      const rowErr   = metrics?.data_value_errors ?? 0;
      if (fieldErr === 0 && rowErr === 0)
        return 'Model rows & columns identical to expected.';
      if (fieldErr && !rowErr)
        return `Column mismatch: ${fieldErr} missing/extra column${fieldErr>1?'s':''}.`;
      if (rowErr && !fieldErr)
        return `Row mismatch: ${rowErr} duplicate / missing row${rowErr>1?'s':''}.`;
      return `${fieldErr} column & ${rowErr} row differences detected.`;
    },

    //  Field Similarity Explanations
    field_similarity: (v?: number): React.ReactNode => {
      const expX = expectedVega?.encoding?.x?.field ?? '—';
      const expY = expectedVega?.encoding?.y?.field ?? '—';
      const actX = actualVega?.encoding?.x?.field ?? '—';
      const actY = actualVega?.encoding?.y?.field ?? '—';

      if (v === 1) {
        // exact X / Y hit
        return (
          <>
            Exact field match: <code>{expX}</code> / <code>{expY}</code>.
          </>
        );
      }

      /* v === 0 happens when one axis is missing altogether */
      if (v === 0) {
        return (
          <>
            Axis field missing: expected&nbsp;
            <code>{expX}</code>/<code>{expY}</code> vs model&nbsp;
            <code>{actX}</code>/<code>{actY}</code>.
          </>
       );
      }

      // near identical (high lexical similarity + same type bonus)
      if (v! >= 0.9)
        return (
          <>
            Near‑match: high lexical similarity &amp; same data type
            (expected&nbsp;<code>{expX}</code>/<code>{expY}</code> vs model&nbsp;
           <code>{actX}</code>/<code>{actY}</code>).
          </>
        );

      // related semantics / same data‑type but different wording
      if (v! >= 0.75)
        return (
          <>
            Related fields – similar semantics or data type but not identical
            (expected&nbsp;<code>{expX}</code>/<code>{expY}</code> vs model&nbsp;
            <code>{actX}</code>/<code>{actY}</code>).
          </>
        );

      // unrelated but at least share discrete / continuous nature
      if (v! >= 0.5)
        return (
          <>
            Partially related – limited semantic overlap
            (expected&nbsp;<code>{expX}</code>/<code>{expY}</code> vs model&nbsp;
            <code>{actX}</code>/<code>{actY}</code>).
          </>
        );

      return (
        <>
          Unrelated fields: little lexical or semantic similarity.
          (expected&nbsp;<code>{expX}</code>/<code>{expY}</code> vs model&nbsp;
          <code>{actX}</code>/<code>{actY}</code>).
        </>
      );
    },

    // Chart Similarity Explanations 
    chart_similarity: v => {
      const expMark = expectedVega?.mark?.type ?? expectedVega?.mark;
      const actMark = actualVega?.mark?.type ?? actualVega?.mark;
      return v === 0 ? (
        <>
          Chart type mismatch:  expected <code>{expMark}</code>, model used{' '}
          <code>{actMark}</code>.
        </>
      ) : (
        <>
          Chart type <code>{actMark}</code> is plausible, but&nbsp;
          <code>{expMark}</code> would better match these fields.
        </>
      );
    },

    // Filter Accuracy Explanations
     filter_accuracy: (): React.ReactNode => {
      const exp = expectedVega?.transform?.[0];
      const act = actualVega?.transform?.[0];
      if (!act)
        return (
        <>
          Required filter missing: expected <code>{JSON.stringify(exp)}</code>,
          model: none.
        </>
      );
      if (!exp)
        return (
        <>
          Model added extra filter <code>{JSON.stringify(act)}</code>.
        </>
      );
      return (
        <>
          Expected&nbsp;<code>{JSON.stringify(exp)}</code> vs model&nbsp;
          <code>{JSON.stringify(act)}</code>.
        </>
      );
    },

    // Sort Accuracy Explanations 
    sort_accuracy: (): React.ReactNode => {
      const exp = expectedVega?.encoding?.x?.sort ?? expectedVega?.encoding?.y?.sort;
      const act = actualVega?.encoding?.x?.sort ?? actualVega?.encoding?.y?.sort;
      if (!act)
        return (
          <>
            Required sort missing: expected <code>{JSON.stringify(exp)}</code>, model: none.
          </>
        );
      if (!exp)
        return (
          <>
            Model added extra sort <code>{JSON.stringify(act)}</code>.
          </>
        );
      return (
        <>
          Expected sort <code>{JSON.stringify(exp)}</code> vs model{' '}
          <code>{JSON.stringify(act)}</code>.
        </>
      );
    },

    // Axis Accuracy Explanations 
    'axis.x_axis_accuracy': () => describeAxis('x'),
    'axis.y_axis_accuracy': () => describeAxis('y'),
    // Visual Encoding Accuracy / Aesthetic Accuracy 
    aesthetic_accuracy: (): React.ReactNode => {
      const expEnc = expectedVega?.encoding ?? {};
      const actEnc = actualVega?.encoding ?? {};
      const channels = ['color','shape','size','text','opacity'] as const;
      const missing = channels.filter(c => expEnc[c] && !actEnc[c]);
      const extra   = channels.filter(c => actEnc[c] && !expEnc[c]);
      if (!missing.length && !extra.length)
        return 'All aesthetic channels match.';
     if (missing.length && !extra.length)
        return `Missing channel${missing.length>1?'s':''}: ${missing.join(', ')}.`;
      if (extra.length && !missing.length)
        return `Extra channel${extra.length>1?'s':''}: ${extra.join(', ')}.`;
      return `Mismatch in channels – missing ${missing.join(', ')}, extra ${extra.join(', ')}.`;
    },

    // Tooltip Accuracy 
    'interactivity.tooltip_accuracy': (): React.ReactNode => {
      const expTip = JSON.stringify(expectedVega?.encoding?.tooltip ?? null);
      const actTip = JSON.stringify(actualVega?.encoding?.tooltip ?? null);

      if (expTip === actTip)
        return 'Tooltip exactly matches.';

      if (actTip === 'null')
        return (
          <>
            Tooltip absent in model: expected&nbsp;<code>{expTip}</code>.
          </>
        );

      if (expTip === 'null')
        return (
          <>
            Tooltip unexpected: model added&nbsp;<code>{actTip}</code>.
          </>
        );

      return (
        <>
          Tooltip differs: expected&nbsp;<code>{expTip}</code> vs model&nbsp;
          <code>{actTip}</code>.
        </>
      );
    },
    
  });

  /** helper for axis mismatch explanation */
  function describeAxis(ch: 'x' | 'y'): React.ReactNode {
    const expEnc = expectedVega?.encoding?.[ch] ?? {};
    const actEnc = actualVega?.encoding?.[ch] ?? {};
    if (!actEnc.field)
      return (
        <>
          Model omitted <code>{expEnc.field}</code> on the {ch.toUpperCase()}‑axis.
        </>
      );
    if (expEnc.field !== actEnc.field)
        return (
        <>
          Axes incorrect: expected <code>{expEnc.field}</code>, model used{' '}
          <code>{actEnc.field}</code>.
        </>
      );
    const expScale = expEnc.scale?.type ?? 'linear';
    const actScale = actEnc.scale?.type ?? 'linear';
    if (expScale !== actScale)
      return (
        <>
          Wrong scale: expected <code>{expScale}</code>, model used{' '}
          <code>{actScale}</code>.
        </>
      );
    return `Title, baseline or orientation differs on the ${ch.toUpperCase()}‑axis.`;
  }

  
  const vizExplainers = makeExplainers();

  /* ----- collect viz‑metric explanations by bucket and ≤ 99 % ----- */
  const vizBuckets: Record<string, React.ReactNode[]> = {};
    (Object.entries(BUCKET_METRICS) as [keyof typeof BUCKET_METRICS, readonly string[]][]).forEach(
        ([bucket, metricsInBucket]) => {
          metricsInBucket
          /* filter → only include the wanted metric when metricKey is set */
          .filter(k => !metricKey || k === metricKey)
          .forEach(k => {
            const fn = vizExplainers[k];
            if (!fn) return;
        
            const numeric = getMetricValue(k, metrics);

            /* Always push – but mark “✓ Matches expected” when perfect.     */
            const expl =
              numeric >= 0.999
                ? '✓ Matches expected.'
               : fn(numeric);

            (vizBuckets[bucket] ||= []).push(
              <li key={k}>
                <strong>{METRIC_LABEL[k]}:</strong> {expl}
              </li>
            );
          }); 
        }     
  );     
  /* ─── metric-level pop-over : early-out ─── */
  if (metricKey) {
        // Check if it's a visualization bucket-level metric (data, semantics, functionality, design)
    if (['data', 'semantics', 'functionality', 'design'].includes(metricKey)) {
      // For bucket-level metrics, we need to check if all sub-metrics in that bucket are perfect
      // Map the bucket keys to the actual metric names used in the data
      const metricNameMap: Record<string, string[]> = {
        'data': ['data_fidelity', 'field_similarity'],
        'semantics': ['chart_similarity'],
        'functionality': ['filter_accuracy', 'sort_accuracy', 'axis.x_axis_accuracy', 'axis.y_axis_accuracy'],
        'design': ['aesthetic_accuracy', 'interactivity.tooltip_accuracy']
      };
      
      const bucketMetrics = metricNameMap[metricKey];
      if (bucketMetrics) {
        const allPerfect = bucketMetrics.every((subMetric: string) => {
          return isPerfect(subMetric, metrics);
        });
        
        if (allPerfect) {
          const label = bucketLabel[metricKey] || metricKey;
          return (
            <div>
              <div style={{ fontWeight: 600 }}>{label}</div>
              <div style={{ marginTop: 6 }}>
                All sub-metrics in this bucket match expected values.
              </div>
            </div>
          );
        }
      }
      // If not all perfect, return empty (no tooltip)
      return null;
    }

    // Check if it's a specific visualization metric
    // Map the metric keys from vizSubcats to the actual metric names used in the data
    const metricKeyMap: Record<string, string> = {
      'dataFidelity': 'data_fidelity',
      'fieldSimilarity': 'field_similarity',
      'chartSimilarity': 'chart_similarity',
      'filterAccuracy': 'filter_accuracy',
      'sortAccuracy': 'sort_accuracy',
      'xAxisAcc': 'axis.x_axis_accuracy',
      'yAxisAcc': 'axis.y_axis_accuracy',
      'aestheticAccuracy': 'aesthetic_accuracy',
      'tooltipAcc': 'interactivity.tooltip_accuracy'
    };
    
    const actualMetricKey = metricKeyMap[metricKey] || metricKey;
    const allVizMetrics = Object.values(BUCKET_METRICS).flat();
    if (allVizMetrics.includes(actualMetricKey as any)) {
      // Find the specific metric explanation
      const fn = vizExplainers[actualMetricKey];
      if (fn) {
        const numeric = getMetricValue(actualMetricKey, metrics);
        
        // Helper function to generate "Model: ___ Matches Expected ___" message for perfect scores
        const generatePerfectMatchMessage = (metricKey: string): React.ReactNode => {
          switch (metricKey) {
            case 'field_similarity':
              const expX = expectedVega?.encoding?.x?.field ?? '—';
              const expY = expectedVega?.encoding?.y?.field ?? '—';
              return (
                <>
                  Model: <code>{expX}</code>/<code>{expY}</code> Matches Expected <code>{expX}</code>/<code>{expY}</code>
                </>
              );
            
            case 'chart_similarity':
              const expMark = expectedVega?.mark?.type ?? expectedVega?.mark ?? '—';
              return (
                <>
                  Model: <code>{expMark}</code> Matches Expected <code>{expMark}</code>
                </>
              );
            
            case 'filter_accuracy':
              const expFilter = expectedVega?.transform?.[0];
              const filterStr = expFilter ? JSON.stringify(expFilter) : '—';
              return (
                <>
                  Model: <code>{filterStr}</code> Matches Expected <code>{filterStr}</code>
                </>
              );
            
            case 'sort_accuracy':
              const expSort = expectedVega?.encoding?.x?.sort ?? expectedVega?.encoding?.y?.sort;
              const sortStr = expSort ? JSON.stringify(expSort) : '—';
              return (
                <>
                  Model: <code>{sortStr}</code> Matches Expected <code>{sortStr}</code>
                </>
              );
            
            case 'axis.x_axis_accuracy':
              const expXField = expectedVega?.encoding?.x?.field ?? '—';
              return (
                <>
                  Model: <code>{expXField}</code> Matches Expected <code>{expXField}</code>
                </>
              );
            
            case 'axis.y_axis_accuracy':
              const expYField = expectedVega?.encoding?.y?.field ?? '—';
              return (
                <>
                  Model: <code>{expYField}</code> Matches Expected <code>{expYField}</code>
                </>
              );
            
            case 'aesthetic_accuracy':
              return <>Model: All aesthetic channels match expected</>;
            
            case 'interactivity.tooltip_accuracy':
              const expTooltip = expectedVega?.encoding?.tooltip;
              const tooltipStr = expTooltip ? JSON.stringify(expTooltip) : '—';
              return (
                <>
                  Model: <code>{tooltipStr}</code> Matches Expected <code>{tooltipStr}</code>
                </>
              );
            
            case 'data_fidelity':
              return <>Model: Data rows & columns match expected</>;
            
            default:
              return <>Model matches expected</>;
          }
        };
        
        const expl = numeric >= 0.999 ? generatePerfectMatchMessage(actualMetricKey) : fn(numeric);
        
        const content = (
          <li>
            <strong>{METRIC_LABEL[actualMetricKey] || metricKey}:</strong> {expl}
          </li>
        );
        
        return bare
          ? <>{content}</>
          : <ul style={{ paddingInlineStart: 20, margin: 0 }}>{content}</ul>;
      }
    }

    // Check if it's the overall visualization metric
    if (metricKey === 'overall') {
      // For overall metric, check if all buckets are perfect
      const allBuckets = ['data', 'semantics', 'functionality', 'design'];
      const allPerfect = allBuckets.every(bucketKey => {
        const metricNameMap: Record<string, string[]> = {
          'data': ['data_fidelity', 'field_similarity'],
          'semantics': ['chart_similarity'],
          'functionality': ['filter_accuracy', 'sort_accuracy', 'axis.x_axis_accuracy', 'axis.y_axis_accuracy'],
          'design': ['aesthetic_accuracy', 'interactivity.tooltip_accuracy']
        };
        
        const bucketMetrics = metricNameMap[bucketKey];
        if (!bucketMetrics) return false;
        
        return bucketMetrics.every((subMetric: string) => {
          return isPerfect(subMetric, metrics);
        });
      });
      
      if (allPerfect) {
        return (
          <div>
            <div style={{ fontWeight: 600 }}>Overall Visualization Quality</div>
            <div style={{ marginTop: 6 }}>
              All visualization metrics match expected values.
            </div>
          </div>
        );
      }
      // If not all perfect, return empty (no tooltip)
      return null;
    }

    // Check if it's a natural language metric
    if (judge) {
      // Special case for information_similarity
      if (metricKey === 'information_similarity') {
        // Get the percentage from metrics data instead of judge evaluation
        const score = metrics?.information_similarity;
        const percentage = typeof score === 'number' ? Math.round(score * 100) : 0;
        
        const content = (
          <li>
            <strong>Information Similarity:</strong> Cosine Similarity between model and expected NL response: {percentage}%
          </li>
        );
        
        return bare
          ? <>{content}</>
          : <ul style={{ paddingInlineStart: 20, margin: 0 }}>{content}</ul>;
      }
      
      const nlMetricKey = metricKey as JudgeMetricKey;
      const explanation = (judge as any)[`${nlMetricKey}_explanation`];
      
      if (explanation) {
        const metricInfo = judgeMetricsInfo.find(info => info.key === nlMetricKey);
        const label = metricInfo?.label || nlMetricKey;
        
        const content = (
          <li>
            <strong>{label}:</strong> {explanation}
          </li>
        );
        
        return bare
          ? <>{content}</>
          : <ul style={{ paddingInlineStart: 20, margin: 0 }}>{content}</ul>;
      }
    }











    // If no match found, return empty
    return null;
  }
    

  /* ----- spec-accuracy (precision / recall / f1) ----- */
  const specItems: React.ReactNode[] = [];

const prf = metrics?.score_precision_recall_f1;     
if (prf) {
  const { precision = 1, recall = 1, f1 = 1 } = prf;

  if (precision < 0.999)
    specItems.push(
      <li key="prec">
         Precision: extra or incorrect spec elements produced.
      </li>
    );
  if (recall < 0.999)
    specItems.push(
      <li key="rec">
       Recall: some expected elements missing.
      </li>
    );
  if (f1 < 0.999)
    specItems.push(
      <li key="f1">
        F1: harmonic mean reflects combined misses and extras.
        and extras.
      </li>
    );
}

  /* group NL metrics ➜ { analytical:[…], conversational:[…], factual:[…] } */
  const nlBuckets: Record<string, React.ReactNode[]> = {
    analytical     : [],
    conversational : [],
    factual        : [],
  };

  if (judge) {
    type NLKey = 'assumptions' | 'insightfulness' | 'follow_up_relevance' | 'coherence' | 'information_similarity';
    const CONFIG: [NLKey,string,'analytical'|'conversational'|'factual'][] = [
      ['assumptions',            'Assumptions disclosure',  'analytical'    ],
     ['insightfulness',         'Insightfulness',          'analytical'    ],
      ['follow_up_relevance',    'Follow‑up relevance',     'conversational'],
      ['coherence',              'Coherence',               'conversational'],
      ['information_similarity','Information similarity', 'factual'       ],
    ];

    CONFIG.forEach(([k,label,bkt]) => {
      const raw   = (judge as any)[k];
      const score = typeof raw === 'number' ? raw : null;
      const expl  = (judge as any)[`${k}_explanation`] as string | undefined;
      if (score !== null && score < 5 && expl) {
        nlBuckets[bkt].push(
          <li key={k}>
            {label}: {expl}
          </li>
        );
      }
    });
  }

  /* nothing to show? */
  const vizIssueCount = Object.values(vizBuckets).reduce((s, a) => s + (a?.length ?? 0), 0);
  const anyNlIssues   = Object.values(nlBuckets).some(arr => arr.length > 0);
  if (vizIssueCount === 0 && specItems.length === 0 && !anyNlIssues) return null;

    // ----- when used inside the overview cards --------------------
  if (bare) {
    return (
      <>
        {/* Only the inner groups, **no** parent Collapse */}
        {Object.keys(vizBuckets).length > 0 && (
          <>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>Visualization response</p>
           {(['data', 'semantics', 'functionality', 'design'] as const).map(
          (b) =>
            vizBuckets[b]?.length && (
              <SectionList
                key={b}
                title={bucketLabel[b]}
                items={vizBuckets[b]}
              />
            ),
        )}
          </>
        )}

        {Object.values(nlBuckets).some(a => a.length) && (
          <>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>Issues: Natural Language Response</p>
            {nlBuckets.analytical.length > 0 && (
              <SectionList
                title="Analytical Thinking"
                items={nlBuckets.analytical}
              />
            )}
            {nlBuckets.conversational.length > 0 && (
              <SectionList
                title="Conversational Quality"
                items={nlBuckets.conversational}
              />
            )}
            {nlBuckets.factual.length > 0 && (
              <SectionList
                title="Information Similarity"
                items={nlBuckets.factual}
              />
            )}
          </>
        )}
      </>
    );
  }

  return (
    <Collapse
      size="small"
      bordered={false}
      style={{ marginTop: 12 }}
    >
      {/* ────────── Visualization response ────────── */}
      {Object.keys(vizBuckets).length > 0 && (
        <Collapse.Panel header="Issues: Visualization Response" key="viz">
        {(['data','semantics','functionality','design'] as const).map(b => (
            vizBuckets[b]?.length ? (
              <React.Fragment key={b}>
                <p style={{ fontWeight:600, marginBottom:4 }}>
                  {bucketLabel[b]}
                </p>
                <ul style={{ paddingInlineStart: 20, marginTop:0, marginBottom:8 }}>
                  {vizBuckets[b]}
                </ul>
             </React.Fragment>
            ) : null
          ))}
        </Collapse.Panel>
      )}

      {/* ────────── Natural-language response ────────── */}
      {(nlBuckets.analytical.length ||
       nlBuckets.conversational.length ||
        nlBuckets.factual.length) > 0 && (
        <Collapse.Panel header="Issues: Natural Language Response" key="nl">
         {nlBuckets.analytical.length > 0 && (
            <>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Analytical Thinking</p>
              <ul style={{ paddingInlineStart: 20, marginTop: 0, marginBottom: 8 }}>
                {nlBuckets.analytical}
              </ul>
            </>
          )}
          {nlBuckets.conversational.length > 0 && (
            <>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Conversational Quality</p>
              <ul style={{ paddingInlineStart: 20, marginTop: 0, marginBottom: 8 }}>
                {nlBuckets.conversational}
              </ul>
            </>
          )}
          {nlBuckets.factual.length > 0 && (
            <>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Information Equivalence</p>
              <ul style={{ paddingInlineStart: 20, margin: 0 }}>
                {nlBuckets.factual}
              </ul>
            </>
          )}
        </Collapse.Panel>
      )}
    </Collapse>
  );
};
