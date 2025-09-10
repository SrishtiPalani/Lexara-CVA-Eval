import React, { useState, useEffect } from 'react';
import { Button, Modal, Tooltip, Skeleton, Collapse } from 'antd';
import { DiffOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';  // For the icon
import { VegaLite } from 'react-vega';
import { VisualizationSpec } from 'vega-embed';
import SpeechBubble from './SpeechBubble';
import { EvaluationDataRecord } from './types';
import { MetricExplanations } from './MetricExplanations';
import type { MetricScores } from './metrics';
import type { ModelJudgeEval } from './NaturalLanguageOverallMetrics';

interface ModelDiffData {
  missingProperties: string[];
  unequalProperties: string[];
  total: number;
}

interface ModelResponseCellProps {
  record: EvaluationDataRecord;
  modelKey: string; // raw “o3-mini|prompt1”
  modelLabel: string; // pretty header text "o3-mini * Prompt 1"

  vegaSpec: VisualizationSpec | null;
  errors: string[];
  dataValues: any[];
  rawModelOutput?: string;
  /** total runs for this test‑case */
  totalRuns?: number;
  /** index (0‑based) this blob belongs to – provided by parent */
  runIndex?: number;
  /** run_results is a map of run index to model outputs, vega specs, and errors */
  runResults?: EvaluationDataRecord['run_results'];
  /** whether this cell is synchronized with global run selection */
  isSynchronized?: boolean;
  /** callback for run navigation */
  onRunNavigation?: (direction: 'prev' | 'next') => void;
  /** callback for toggling between averaged and specific run view */
  onToggleRunView?: () => void;
  /** current run index from global state */
  currentRunIndex: number | null;
}



const ModelResponseCell: React.FC<ModelResponseCellProps> = React.memo(
  ({
    record,
    modelKey,
    modelLabel,
    vegaSpec,
    errors,
    dataValues,
    rawModelOutput,
    totalRuns, 
    runResults,
    runIndex  = 0, // default to first run
    isSynchronized = false,
    onRunNavigation,
    onToggleRunView,
    currentRunIndex = null,
  }) => {
    // Local state so the user can page through the runs inside the cell.
    // We initialise from `runIndex` (chosen by the parent) and keep it in sync
    // whenever that prop changes, but let the navigation buttons override it afterwards
    const [activeRun, setActiveRun] = useState(runIndex ?? 0);

    useEffect(() => {
      setActiveRun(runIndex ?? 0);
    }, [runIndex]);

    /* derive the blob that corresponds to `activeRun` */
    const activeOutput = runResults?.[activeRun]?.model_outputs?.[modelKey]
                      ?? rawModelOutput;
    const activeVega   = runResults?.[activeRun]?.modelVegaSpecs?.[modelKey]
                      ?? vegaSpec;
    const activeErrors = runResults?.[activeRun]?.modelConversionErrors?.[modelKey]
                      ?? errors;
    

    /* ---------- metrics / judge-eval blobs for this run ---------- */
    const activeMetrics: MetricScores | undefined =
      runResults?.[activeRun]?.metrics?.[modelKey] ??
      record.metrics?.[modelKey];

    /**
     * Judge models might differ per-run.  
     * Collect keys from the *current run* first, then fall back to the
     * record-level map, and finally pick the first (if any).
     */
    const judgeModels = Object.keys(
      runResults?.[activeRun]?.judge_evaluations ||
      record.judge_evaluations ||
      {},
    );
    const judgeModel = judgeModels[0]; // undefined when no judge present

    const activeJudge: ModelJudgeEval | undefined =
      (judgeModel &&
       (runResults?.[activeRun]?.judge_evaluations?.[judgeModel]?.[modelKey] ??
         record.judge_evaluations?.[judgeModel]?.[modelKey])) ||
      undefined;


    
    
    
   // If activeOutput is '__pending__', we show a loading skeleton
   if (activeOutput === '__pending__') {
      return (
        <div style={{ width: 200 }}>
          <Skeleton active title={false} paragraph={{ rows: 3 }} />
        </div>
      );
    }



    // Attempt to parse user-friendly text from rawModelOutput
    let userReply = '';
    try {
      const parsed = JSON.parse(activeOutput || '{}');
      userReply = parsed.user_friendly_reply || '';
    } catch {
      // If parse fails, userReply remains empty
    }

    // Extract "content" from rawModelOutput for the JSON diff viewer
    let strippedNotionalSpec = '{}';
    try {
      const parsed = JSON.parse(activeOutput || '{}');
      const notional = parsed.content ?? {};
      strippedNotionalSpec = JSON.stringify(notional, null, 2);
    } catch {
      // If parse fails, keep strippedNotionalSpec as '{}'
    }

    // Simple function to render the top portion (chart, symbol map, errors, etc.)
    function renderTopContent() {
      if (activeVega) {
        const specAny = activeVega as any;
        const isSymbolMap =
          (specAny.mark === 'circle' || specAny.mark === 'point') &&
          specAny.projection?.type === 'identity' &&
          specAny.encoding?.longitude &&
          specAny.encoding?.latitude;
          
          return (
            <div style={{ width: 'fit-content', minWidth: '200px' }}>
              <VegaLite spec={activeVega as VisualizationSpec} data={{ data: { data: dataValues } }} />
            </div>
          );
        
      }

      // If errors are present
      if (activeErrors && activeErrors.length > 0) {
        return (activeErrors as string[]).map((error: string, index: number) => (
          <div key={index} style={{ color: 'red', marginBottom: '4px' }}>
            {error}
          </div>
        ));
      }

      // Fallback: no visualization
      return (
        <div style={{ color: '#888' }}>
          No visualization available
        </div>
      );
    }

    const topContent = renderTopContent();

    return (
      <div className="response-cell-flex" style={{ 
        width: 'fit-content', 
        minWidth: '200px',
        maxWidth: '100%'
      }}>
         
        {/* Top portion: chart or errors */}
        {topContent}

        {/* Speech bubble if we have a valid spec or errors */}
        {(activeVega || (activeErrors && activeErrors.length>0)) && (
          <SpeechBubble variant="model">
            {userReply.trim()}
          </SpeechBubble>
        )}
        
        {/* navigator positioned directly under the speech bubble */}
        {totalRuns !== undefined && totalRuns > 1 && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'flex-start',
            marginTop: '8px',
            gap: '4px'
          }}>
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
                  disabled={currentRunIndex === (totalRuns! - 1)}
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
        )}
          
      </div>        
    );
  }
);

export default ModelResponseCell;
