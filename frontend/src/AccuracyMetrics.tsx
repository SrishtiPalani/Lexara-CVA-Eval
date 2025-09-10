import React, { useState, useMemo } from "react";
import { EvaluationDataRecord } from "./types";
import { metricsToDisplay, modelNameMap, labelWithInfo, InfoIcon } from "./TestCaseEvaluation";
import { Tooltip, Rate, Skeleton, Button } from 'antd';
import { CaretRightOutlined, DownOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { prettyModelPromptName } from "./utils";
import { MetricPopover } from './MetricPopover';

export interface AccuracyMetricsProps {
  // The record containing metrics and model outputs
  record: EvaluationDataRecord;
  // List of model names to display
  models: string[];
  enabled: Record<'precision' | 'recall' | 'f1', boolean>;
  runIndex?: number; // when defined show that run; otherwise use averages
  isSynchronized?: boolean; // whether this cell is synchronized with global run selection
  onRunNavigation?: (direction: 'prev' | 'next') => void; // callback for run navigation
  onToggleRunView?: () => void; // callback for toggling between averaged and specific run view
  currentRunIndex: number | null; // current run index from global state
  totalRuns?: number; // total number of runs
  /** token that changes as streaming results arrive to force recalculation */
  refreshToken?: number;
  showTooltips?: boolean; // New prop to control tooltip visibility
}

// Component to display a score cell with color coding based on the value
const ScoreCell: React.FC<{ value: number }> = ({ value }) => {
  const style = React.useMemo(() => {
    let bg: string, color: string;
    if (value < 33)  { color = '#E54D37'; bg = 'rgba(229,77,55,0.1)'; }
    else if (value < 66)  { color = '#F2B134'; bg = 'rgba(242,177,52,0.1)'; }
    else { color = '#1170AA'; bg = 'rgba(17,112,170,0.1)'; }
    return {
      backgroundColor: bg,
      color,
      padding: '2px 4px',
      borderRadius: 4,
      textAlign: 'center' as const,
      fontWeight: 'bold' as const,
      whiteSpace: 'nowrap' as const,
    };
  }, [value]);

  return <div style={style}>{value}%</div>;
};

// Style for the label in the tooltip
const labelStyle: React.CSSProperties = {
  paddingLeft: 16,
  fontSize: 12,
  whiteSpace: 'nowrap',
};



export const AccuracyMetrics: React.FC<AccuracyMetricsProps> = ({ 
  record, models, enabled, runIndex, isSynchronized = false, 
      onRunNavigation, onToggleRunView, currentRunIndex = null, totalRuns, refreshToken, showTooltips = true
}) => {
  

  // State to control expansion of detail rows
  const [expanded, setExpanded] = useState(false);

  // Helper function to conditionally wrap content with MetricPopover
  const wrapWithTooltip = (children: React.ReactNode, props: any) => {
    if (!showTooltips) {
      return <>{children}</>;
    }
    return <MetricPopover {...props}>{children}</MetricPopover>;
  };

// Helper function to get metrics for a specific model
const getMetricsForModel = (model: string) => {
  const prf = (ms?: any) => ms?.score_precision_recall_f1;
  const hasNumbers = (ms?: any) => {
    const p = prf(ms);
    return p && ['precision','recall','f1'].every(k => typeof p[k] === 'number' && !isNaN(p[k]));
  };
  const sumPRF = (ms?: any) => {
    const p = prf(ms);
    return p ? (p.precision || 0) + (p.recall || 0) + (p.f1 || 0) : 0;
  };

  const runMs = runIndex !== undefined
    ? record.run_results?.[runIndex]?.metrics?.[model]
    : undefined;

  const avgMs = record.metric_averages?.[model];
  const repMs = record.metrics?.[model];



  // For single run, prioritize finding PRF metrics in any available source
  if ((totalRuns ?? 0) <= 1) {
    // First, try to find any run that has PRF numbers (this is most likely to have the data)
    const anyRunWithPRF = Object.values(record.run_results ?? {}).find(r => hasNumbers((r as any)?.metrics?.[model])) as any;
    if (anyRunWithPRF) {
      return anyRunWithPRF.metrics[model];
    }
    
    // Fall back to averaged metrics if available
    if (hasNumbers(avgMs)) {
      return avgMs;
    }
    
    // Fall back to representative metrics if available
    if (hasNumbers(repMs)) {
      return repMs;
    }
    
    // Fall back to run-specific metrics if available
    if (hasNumbers(runMs)) {
      return runMs;
    }
    
    // If we still can't find PRF metrics, but we have any metrics at all, try to construct them
    // This is a fallback for cases where the data structure is incomplete
    const anyMetrics = repMs || avgMs || runMs || anyRunWithPRF?.metrics?.[model];
    if (anyMetrics && anyMetrics.score_precision_recall_f1) {
      return anyMetrics;
    }
    
    // Last resort: check if we have any run results at all and try to extract PRF from them
    const allRunResults = Object.values(record.run_results ?? {});
    for (const runResult of allRunResults) {
      const runMetrics = (runResult as any)?.metrics?.[model];
      if (runMetrics && runMetrics.score_precision_recall_f1) {
        return runMetrics;
      }
    }
    
    // If we still can't find anything, but we have run results, try to construct PRF from any available data
    if (allRunResults.length > 0) {
      const firstRun = allRunResults[0] as any;
      const firstRunMetrics = firstRun?.metrics?.[model];
      if (firstRunMetrics) {
        return firstRunMetrics;
      }
    }
    
    // If we still can't find anything, but we have any metrics at all, return them even if PRF is missing
    // This is a last resort to prevent showing 0% when we have some data
    if (repMs || avgMs || runMs) {
      const fallbackMetrics = repMs || avgMs || runMs;
      return fallbackMetrics;
    }
    
    // If we still can't find anything, but we have any run results, return the first run's metrics
    if (allRunResults.length > 0) {
      const firstRun = allRunResults[0] as any;
      const firstRunMetrics = firstRun?.metrics?.[model];
      if (firstRunMetrics) {
        return firstRunMetrics;
      }
    }
    
    return undefined;
  }

  // Multi-run: prefer explicit run when it looks complete and not an all-zero blob
  if (hasNumbers(runMs) && (sumPRF(runMs) > 0 || (sumPRF(repMs) === 0 && sumPRF(avgMs) === 0))) return runMs;

  // Fall back to representative / averages if they look better
  if (hasNumbers(repMs) && sumPRF(repMs) > 0) return repMs;
  if (hasNumbers(avgMs) && sumPRF(avgMs) > 0) return avgMs;

  // Last resort: any run that has PRF numbers
  const anyRun = Object.values(record.run_results ?? {}).find(r => hasNumbers((r as any)?.metrics?.[model])) as any;
  if (anyRun) return anyRun.metrics[model];

  return undefined;
};



  // Memoized score arrays
  const f1Scores = useMemo(() =>
    models.map(m => Math.round((getMetricsForModel(m)?.score_precision_recall_f1.f1 ?? 0) * 100)),
    [models, record.metrics, record.metric_averages, record.run_results, runIndex, totalRuns, refreshToken]
  );
  const precisionScores = useMemo(() =>
    models.map(m => Math.round((getMetricsForModel(m)?.score_precision_recall_f1.precision ?? 0) * 100)),
   [models, record.metrics, record.metric_averages, record.run_results, runIndex, totalRuns, refreshToken]
  );
  const recallScores = useMemo(() =>
    models.map(m => Math.round((getMetricsForModel(m)?.score_precision_recall_f1.recall ?? 0) * 100)),
  [models, record.metrics, record.metric_averages, record.run_results, runIndex, totalRuns, refreshToken]
  );

  //if the user disabled every metric in this bucket, render nothing
  if (!enabled.precision && !enabled.recall && !enabled.f1) {
    return null;
  }

  // If no metrics are available for the first model, show a loading skeleton
  if (!getMetricsForModel(models[0])) {
  return <Skeleton active paragraph={false} title={{width: 80}}/>;
}

  // Render the accuracy metrics grid
  return (
    // Render the grid layout for accuracy metrics
    <div
      className="accuracy-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `24px 1fr repeat(${models.length}, auto)`,
        rowGap: 4,
        columnGap: 12,
        alignItems: 'center',
      }}
    >
      {/* headers */}
      <div/><div/>
      {models.map(m => (
        <div key={m} className="metricModelHeader" style={{ fontSize:12, color:'#555', textAlign:'center' }}>
          {prettyModelPromptName(m)}
        </div>
      ))}

    {/* F1 headline row (only if enabled) */}
    {enabled.f1 && (
        <>
          {/* chevron only in the narrow first column */}
          <div onClick={() => setExpanded(e => !e)} style={{ cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            {expanded ? <DownOutlined style={{ fontSize:12 }}/> : <CaretRightOutlined style={{ fontSize:12 }}/>}
          </div>
          {/* label + (i) on the same line */}
          <div style={{ display:'inline-flex', alignItems:'center', gap:6, fontWeight:'bold', whiteSpace:'nowrap' }}>
            <span>F1</span>
            <InfoIcon title={
              (() => {
                const f1 = metricsToDisplay.find(m => m.key === 'f1');
                const range =
                  f1?.range === 'binary'
                    ? (f1?.unit === '%' ? '0 or 100%' : '0 or 100')
                    : f1 ? `${(f1.range as [number,number])[0]}–${(f1.range as [number,number])[1]}${f1.unit === '%' ? '%' : ' rating'}` : '—';
                return (
                  <div>
                    <div style={{ fontWeight:600 }}>F1</div>
                    <div style={{ marginTop:6 }}>{f1?.definition ?? 'Harmonic mean of Precision and Recall.'}</div>
                    <div style={{ marginTop:8, fontSize:12, opacity:.75 }}>Range: {range}</div>
                  </div>
                );
              })()
            }/>
          </div>
         
          {f1Scores.map((pct, i) => (
            <ScoreCell key={models[i]} value={pct} />
          ))}
        </>
      )}



      {expanded && (
        <>
          {enabled.precision && (
            <>
              <div/>
              <span className="subcat-label">{labelWithInfo('Precision', 'precision')}</span>
              {precisionScores.map((pct, i) => (
                <ScoreCell key={`p-${models[i]}`} value={pct} />
              ))}
            </>
          )}
          {enabled.recall && (
            <>
              <div/>
              <span className="subcat-label">{labelWithInfo('Recall', 'recall')}</span>
              {recallScores.map((pct, i) => (
                <ScoreCell key={`r-${models[i]}`} value={pct} />
              ))}
            </>
          )}
        </>
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
