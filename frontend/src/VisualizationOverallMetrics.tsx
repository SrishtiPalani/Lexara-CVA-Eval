import {Skeleton, Tooltip, Button, Modal } from 'antd';
import { CaretRightOutlined, DownOutlined, LeftOutlined, RightOutlined, QuestionCircleOutlined, DiffOutlined } from '@ant-design/icons';


import { computeOverallVisualizationScore, computeVisualizationSubcategoryScores } from "./metrics";
import { metricsToDisplay, labelWithInfo, InfoIcon } from "./TestCaseEvaluation";
import { EvaluationDataRecord } from "./types";
import { useState } from 'react';
import React from 'react';
import { MetricScores } from './metrics';
import { metricGridStyles, prettyModelPromptName } from './utils';
import { MetricPopover } from './MetricPopover';
import { JsonDiffViewer } from './JsonDiffViewer';

// Type guard to check if the MetricScores object is an average
function isVizAverage(ms: unknown): ms is ModelVizAverages {
  return !!ms &&
    typeof (ms as Record<string, unknown>).overall === 'number' &&
    typeof (ms as Record<string, unknown>).buckets === 'object' &&
    typeof (ms as Record<string, unknown>).subs === 'object';
}

/******************************************************************
 *  averageVisualizationMetrics
 *  - Walks through every EvaluationDataRecord, picks the metrics
 *    for one model, and averages
 *      • the overall viz-score
 *      • the four bucket scores
 *      • every leaf sub-metric you show in the drill-downs
 ******************************************************************/
type Buckets = ReturnType<typeof computeVisualizationSubcategoryScores>;

export interface ModelVizAverages {
  overall : number;     
  buckets : ReturnType<typeof computeVisualizationSubcategoryScores>;
  subs    : Record<string, number>;
}

/* which viz metrics are still enabled? */
const isMetricEnabled = (k: string, enabled: string[]) => enabled.includes(k);

/* filter the vizSubcats list once up-front */
const activeSubcats = (enabled: string[]) =>
  vizSubcats
    .map(sc => ({
      ...sc,
      metrics: sc.metrics.filter(mk => isMetricEnabled(mk, enabled))
    }))
    .filter(sc => sc.metrics.length);          // drop empty buckets

/** Average all visualisation metrics for a single model */
export function averageVisualizationMetrics(
  records: EvaluationDataRecord[],
  model: string,
  enabled : string[]
): ModelVizAverages {

  let overallSum = 0, count = 0;

    const bucketAcc = {
    data: 0,
    semantics: 0,
    functionality: 0,
    design: 0,
  } as Record<keyof Buckets, number>;
  const subAcc    : Record<string,number> = {};   // precision, chartSimilarity…

  records.forEach(rec => {
    const ms: MetricScores | undefined = rec.metrics?.[model];
    if (!ms) return;                // this record has no metrics for that model

    // overall
    overallSum += computeOverallVisualizationScore(ms, enabled);

    // bucket-level
    const b = computeVisualizationSubcategoryScores(ms, enabled);
    (Object.keys(bucketAcc) as Array<keyof Buckets>).forEach(k => {
      bucketAcc[k] += b[k];
    });

    // drill-down leaf metrics you actually display
    metricsToDisplay.forEach(mt => {
      const v = mt.displayFn(ms);        // already 0-1
      subAcc[mt.key] = (subAcc[mt.key] ?? 0) + v;
    });

    count++;
  });

  // No rows?  Guard against divide-by-0
  if (count === 0) count = 1;

  // Final averages
  const bucketsAvg: Buckets = {
    data:          bucketAcc.data          / count,
    semantics:     bucketAcc.semantics     / count,
    functionality: bucketAcc.functionality / count,
    design:        bucketAcc.design        / count,
  };

  const subsAvg: Record<string,number> = {};
  Object.keys(subAcc).forEach(k => { subsAvg[k] = subAcc[k] / count; });

  return {
    overall : overallSum / count,
    buckets : bucketsAvg,
    subs    : subsAvg,
  };
}

// maps the display title to the key you use in computeVisualizationSubcategoryScores
const vizSubcats = [
  { title: "Data",          key: "data"          as const, metrics: ["dataFidelity","fieldSimilarity"] },
  { title: "Semantics",     key: "semantics"     as const, metrics: ["chartSimilarity"] },
  { title: "Functionality", key: "functionality" as const, metrics: ["filterAccuracy","sortAccuracy","xAxisAcc","yAxisAcc"] },
  { title: "Design",        key: "design"        as const, metrics: ["aestheticAccuracy","tooltipAcc"] },
];

// Type for the props of the VisualizationOverallMetrics component
interface VisualizationOverallProps {
  record: EvaluationDataRecord;
  models:   string[]; // which models has the user selected to display
  enabled: string[];  // which metrics are enabled by the user
  runIndex?: number; // when defined show that run; otherwise use averages 
  differences?: Record<string, ModelDiffData>; // optional differences data
  showDiffButton?: boolean; // whether to show the diff button
  isSynchronized?: boolean; // whether this cell is synchronized with global run selection
  onRunNavigation?: (direction: 'prev' | 'next') => void; // callback for run navigation
  onToggleRunView?: () => void; // callback for toggling between averaged and specific run view
  currentRunIndex: number | null; // current run index from global state
  totalRuns?: number; // total number of runs
  showTooltips?: boolean; // New prop to control tooltip visibility
}

interface ModelDiffData {
  missingProperties: string[];
  unequalProperties: string[];
  total: number;
}

// Component to display overall visualization metrics for each model
// It shows the overall score and bucket scores in a grid format
// The component allows expanding/collapsing to show/hide detailed sub-metrics
// It uses Ant Design's Tooltip for additional information on each bucket
// The component also uses icons for expand/collapse functionality
// The scores are displayed as percentage pills with color coding based on the score range
// The component is responsive and adjusts the layout based on the number of models
export const VisualizationOverallMetrics: React.FC<VisualizationOverallProps> = ({
  record, models, enabled, runIndex, differences = {}, showDiffButton = true,
      isSynchronized = false, onRunNavigation, onToggleRunView, currentRunIndex = null, totalRuns, showTooltips = true
}) => {
  const [overallExpanded, setOverallExpanded] = useState(false);
  const [diffState, setDiffState] = useState<{
    open: boolean;
    modelKey?: string;
  }>({ open: false });
  const [expandedBuckets, setExpandedBuckets] = useState<Record<string, boolean>>(
    () => Object.fromEntries(vizSubcats.map(sc => [sc.key, false]))
  );

  // Helper function to conditionally wrap content with MetricPopover
  const wrapWithTooltip = (children: React.ReactNode, props: any) => {
    if (!showTooltips) {
      return <>{children}</>;
    }
    return <MetricPopover {...props}>{children}</MetricPopover>;
  };

  // Helper: choose the right MetricScores blob for one model
  const metricsFor = (model: string) => {
       if (runIndex !== undefined) {
         return record.run_results?.[runIndex]?.metrics?.[model] ?? record.metrics?.[model];
       }
       const avg = record.metric_averages?.[model] as any;
       // prefer averaged only if it looks populated
       if (avg && (isVizAverage(avg) || Object.keys(avg).length)) return avg;
       return record.metrics?.[model];
     };

  // compute the overall %
  const overallPct = models.map(m => {
  const ms = metricsFor(m);
  if (!ms) return 0;

  // <-- use the guard instead of `'overall' in ms`
  if (isVizAverage(ms)) return Math.round(ms.overall * 100);

  return Math.round(computeOverallVisualizationScore(ms, enabled) * 100);
});

  const bucketScores = models.map(m => {
  const ms = metricsFor(m);
  return isVizAverage(ms)
    ? ms.buckets
    : ms
      ? computeVisualizationSubcategoryScores(ms, enabled)
      : undefined;
});

   const badgeStyle = (pct: number) => {
    if (pct < 33)  return { color:'#E54D37', background:'rgba(229,77,55,0.1)' };
    if (pct < 66)  return { color:'#F2B134', background:'rgba(242,177,52,0.1)' };
                   return { color:'#1170AA', background:'rgba(17,112,170,0.1)' };
  };

  if (!metricsFor(models[0])) {
  return <Skeleton active paragraph={false} title={{width: 80}}/>;
}

  return (
    <div className="visualization-overall" style={metricGridStyles(models.length)}>
      {/* ——— Column headers ——— */}
      <div/><div/>
      {models.map(m => (
        <div key={m} 
        className="metricModelHeader"
        style={{ fontSize: 12, color: '#555', textAlign: 'center'}}>
        {prettyModelPromptName(m)}
        </div>
      ))}

      {/* ——— Overall row ——— */}
      {/* 1) empty placeholder for the chevron column */}
      <div />
      {/* 2) your clickable label cell */}
      <div
        className="viz-overall-label"
        onClick={() => setOverallExpanded(x => !x)}
        style={{
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          fontWeight: 'bold'
        }}
      >
        {overallExpanded
          ? <DownOutlined style={{ marginRight: 4, fontSize: 12 }} />
          : <CaretRightOutlined style={{ marginRight: 4, fontSize: 12 }} />}
        Overall Visualization Quality
      </div>


      {overallPct.map((p, i) => {
        const mk = models[i];
        return (
          <div key={mk} style={{ display:'flex', alignItems:'center', gap:4, justifyContent:'center' }}>
            <div style={{ ...badgeStyle(p), padding:'2px 4px', borderRadius:4, textAlign:'center', fontWeight:'bold' }}>
              {p}%
            </div>
            {showDiffButton && differences[mk] && (
              <Tooltip title="Examine Viz Differences">
                <Button
                  type="text"
                  size="small"
                  icon={<DiffOutlined />}
                  onClick={() => setDiffState({ open:true, modelKey: mk })}
                />
              </Tooltip>
            )}
          </div>
        );
      })}



      {/* ——— Bucket & sub-metric rows ——— */}
      {overallExpanded && activeSubcats(enabled).map(({ title, key, metrics }) => {
        const isOpen = expandedBuckets[key];
        return (
          <React.Fragment key={key}>
            {/* — Bucket row — */}
            <div/>
            <div
              onClick={() => setExpandedBuckets(prev => ({ ...prev, [key]: !prev[key] }))}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {isOpen
                ? <DownOutlined style={{ marginRight: 4, fontSize: 12 }} />
                : <CaretRightOutlined style={{ marginRight: 4, fontSize: 12 }} />}
              <span className="bucket-label">{title}</span>
              {/* tooltip only on the (i) icon; don't toggle when clicking the icon */}
              {showTooltips && (
                <span onClick={(e) => e.stopPropagation()}>
                  <InfoIcon title={bucketDefinitions[key]} />
                </span>
              )}
            </div>
            {models.map((_, i) => {
              const raw = bucketScores[i]?.[key] 
              const pct = raw === undefined || Number.isNaN(raw) ? null : Math.round(raw * 100);
              return (
                <div key={`${key}-${i}`} style={{ ...badgeStyle(pct ?? 100), padding:'2px 4px', borderRadius:4, textAlign:'center', fontWeight:'bold' }}>
                  {pct === null ? '—' : `${pct}%`}
                </div>
              );
            })}

            {/* — Sub-metrics rows — */}
            {isOpen && metrics.map(mk => {
              const def = metricsToDisplay.find(d => d.key === mk);
              if (!def) return null;

              return (
                <React.Fragment key={mk}>
                  <div />
                  <span className="subcat-label" style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                    {def.label}
                    {showTooltips && (
                      <InfoIcon title={
                        (() => {
                          const range =
                            def.range === 'binary'
                              ? (def.unit === '%' ? '0 or 100%' : '0 or 100')
                              : `${def.range[0]}–${def.range[1]}${def.unit === '%' ? '%' : ' rating'}`;
                          return (
                            <div>
                              <div style={{ fontWeight: 600 }}>{def.label}</div>
                              <div style={{ marginTop: 6 }}>{def.definition}</div>
                              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                                Range: {range}
                              </div>
                            </div>
                          );
                        })()
                      } />
                    )}
                  </span>

                  {models.map((m, j) => {
                    const ms = metricsFor(m);
                    if (!ms) return <span key={j}>—</span>;

                    const rawPct = isVizAverage(ms)
                      ? Math.round((ms.subs[mk] ?? 0) * 100)
                      : Math.round(def.displayFn(ms) * 100);

                    const { background, color } = badgeStyle(rawPct);
                    return wrapWithTooltip(
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        <div
                          style={{ backgroundColor: background, color, padding:'2px 4px', borderRadius:4, textAlign:'center', fontWeight:'bold' }}
                        >
                          {rawPct}%
                        </div>
                        {showTooltips && <QuestionCircleOutlined style={{ fontSize: 11, color: '#999', cursor: 'help' }} />}
                      </div>,
                      {
                        key: j,
                        metrics: metricsFor(m),
                        expected: record.expectedVegaSpec,
                        actual: record.modelVegaSpecs?.[m],
                        metricKey: mk
                      }
                    );
                  })}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}
      {diffState.open && diffState.modelKey && (
        <Modal
          open
          width={1000}
          footer={null}
          title="Detailed Differences"
          onCancel={() => setDiffState({ open:false })}
        >
          {(() => {
            const mk   = diffState.modelKey!;
            const md   = differences[mk];
            if (!md) {
               return <div style={{opacity:.75}}>No differences available for this model/run.</div>;
               }
            const raw  =
              runIndex !== undefined
                ? record.run_results?.[runIndex]?.model_outputs?.[mk]
                : record.model_outputs?.[mk];

            let stripped = '{}';
            try {
              const parsed = JSON.parse(raw ?? '{}');
              stripped = JSON.stringify(parsed.content ?? {}, null, 2);
            } catch {/* ignore */}

            return (
              <JsonDiffViewer
                userUtterance={record.input}
                canonical={record.canonical}
                paraphrases={record.paraphrases}
                labels={record.labels}
                expectedTitle="Expected Raw Output"
                modelTitle={`${mk} Raw Output`}
                differenceTitle="Differences"
                expectedJson={record.expected_output}
                modelJson={stripped}
                differenceList={md}
                onClose={() => setDiffState({ open:false })}
                isSynchronized={isSynchronized}
                onRunNavigation={onRunNavigation}
                currentRunIndex={currentRunIndex}
                totalRuns={totalRuns}
                showDiffButton={showDiffButton}
              />
            );
          })()}
        </Modal>
      )}

      {/* ——— Runs Navigator at bottom ——— */}
      {totalRuns && totalRuns > 1 && (
        <>
          <div /> {/* spacer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-start' }}>
                          {isSynchronized && currentRunIndex !== null ? (
              <>
                <Button
                  size="small"
                  icon={<LeftOutlined />}
                  disabled={!currentRunIndex || currentRunIndex === 0}
                  onClick={() => {
                    if (onRunNavigation) {
                      onRunNavigation('prev');
                    }
                  }}
                />
                <span style={{ fontSize: '11px', color: '#666' }}>
                  {`${currentRunIndex + 1}/${totalRuns}`}
                </span>
                <Button
                  size="small"
                  icon={<RightOutlined />}
                  disabled={currentRunIndex === (totalRuns - 1)}
                  onClick={() => {
                    if (onRunNavigation) {
                      onRunNavigation('next');
                    }
                  }}
                />
              </>
            ) : (
              <span style={{ fontSize: '11px', color: '#666' }}>
                Averaged Runs
              </span>
            )}
          </div>
          {models.map((_, i) => (
            <div key={i} /> // spacer columns
          ))}
        </>
      )}
    </div>
  );
};

// map column‐titles to the keys in the output of computeVisualizationSubcategoryScores
export const bucketKeyMap: Record<
  string,
  keyof ReturnType<typeof computeVisualizationSubcategoryScores>
> = {
  Data:          'data',
  Semantics:     'semantics',
  Functionality: 'functionality',
  Design:        'design',
};

// maps the bucket keys to their definitions
const bucketDefinitions: Record<'data' | 'semantics' | 'functionality' | 'design', string> = {
  data:          'Composite score of Data Fidelity and Field Similarity',
  semantics:     'How logical is the chart type compared to expected - based on Tableau Show Me Logic',
  functionality: 'Average correctness of filters, sort, and axes',
  design:        'Average correctness of encodings and tooltips',
};