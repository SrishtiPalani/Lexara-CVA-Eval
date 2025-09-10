/**
 *
 * This component computes and renders overall natural language metrics
 * (Analytical Thinking, Conversational Quality, Factual Grounding) for each model,
 * using judge evaluations produced by the backend. It displays both summary
 * percentages and expandable breakdowns, with star ratings that never wrap.
 */

import { useState } from "react";
import { EvaluationDataRecord } from "./types";
import { Tooltip, Rate, Skeleton, Button } from 'antd';
import { CaretRightOutlined, DownOutlined, LeftOutlined, RightOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import React from "react";
import { MetricPopover } from './MetricPopover';
import { JudgeEvaluationLoadingSkeleton } from './JudgeEvaluationLoadingSkeleton';

import { modelNameMap, labelWithInfo } from "./TestCaseEvaluation";
import { metricGridStyles, prettyModelPromptName } from "./utils";

// Keys that contain a numeric score 
export type JudgeScoreKey = JudgeMetricKey;
// Keys that contain the explanatory text
export type JudgeExplanationKey = `${JudgeMetricKey}_explanation`;
// Union of every key that can appear in `je`
export type JudgeEvalKey = JudgeScoreKey | JudgeExplanationKey;
//The run-time shape of one model-evaluation blob
export type ModelJudgeEval =
  // A record of scores for each judge metric
  Partial<Record<JudgeScoreKey, number>> &
  // A record of explanations for each judge metric
  Partial<Record<JudgeExplanationKey, string>>;

// Define the buckets for Natural Language metrics
const nlBuckets = [
  {
    key: 'analyticalThinking',
    title: 'Analytical Thinking',
    metrics: ['assumptions','insightfulness'] as const,
    definition: 'Average of Assumptions & Insightfulness (1-5 stars).'
  },
  {
    key: 'conversationalQuality',
    title: 'Conversational Quality',
    metrics: ['follow_up_relevance','coherence'] as const,
    definition: 'Average of Follow-Up Relevance & Coherence (1-5 stars).'
  },
  {
    key: 'factualGrounding',
    title: 'Information Similarity',
    metrics: ['information_similarity'] as const,
    definition: 'Semantic cosine similarity: 0-100% score.'
  },
] as const;

/** Full shape returned by averageNaturalLanguageMetrics */
export interface NLAverage {
  overall: number;
  buckets: Partial<NLBuckets>;
  /** per-metric raw star values (0-5) */
  subs: Partial<Record<JudgeScoreKey, number>>;
}

// 1) First define exactly which keys are allowed
export type JudgeMetricKey =
  | 'assumptions'
  | 'insightfulness'
  | 'follow_up_relevance'
  | 'coherence';


export interface JudgeMetricInfo {
  key: JudgeMetricKey;
  label: string;
  definition: string;
}

// 2) Create an array of objects with those keys and their corresponding labels and definitions
//    This will be used to display metric information in the UI.
export const judgeMetricsInfo: JudgeMetricInfo[] = [
  {
    key: 'assumptions',
    label: 'Assumptions Disclosure',
    definition:
      'Measures whether the answer explicitly surfaces filters, time frames, derivations or other assumptions that affect interpretation.',
  },
  {
    key: 'insightfulness',
    label: 'Insightfulness',
    definition:
      'Captures depth of analysis—trends, drivers, exceptions and actionable take-aways beyond mere restatement of the user’s prompt.',
  },
  {
    key: 'follow_up_relevance',
    label: 'Follow-Up Relevance',
    definition:
      'Checks whether a follow-up answer is grounded in the conversation history and respects earlier filters or context.',
  },
  {
    key: 'coherence',
    label: 'Coherence',
    definition:
      'Evaluates internal logic and narrative structure of the reply (clarity, ordering, lack of contradictions).',
  },
];


// Create a type for the keys of the buckets
const nlBucketDefinitions: Record<NLBucketKey, string> = nlBuckets.reduce((acc, b) => {
  acc[b.key] = b.definition;
  return acc;
}, {} as Record<NLBucketKey, string>);

type NLBuckets = { analytical: number; conversational: number; factual: number };
type NLBucketKey = typeof nlBuckets[number]['key'];
const StarCell: React.FC<{ value: number; showInfoIcon?: boolean }> = ({ value, showInfoIcon = false }) => (
  <div style={{                 
    display:        'flex',
    justifyContent: 'center',
    alignItems:     'center',
    whiteSpace:     'nowrap',
    padding:        showInfoIcon ? '0 12px' : '0 16px',  // Reduce padding when info icon is present to maintain gutter
    minWidth:       '120px',   // Ensure minimum width for star rating cells
    gap:            showInfoIcon ? 4 : 0,
  }}>
    <Rate
      disabled
      allowHalf
      value={value}
      style={{ fontSize: 18 }}   
    />
    {showInfoIcon && <QuestionCircleOutlined style={{ fontSize: 11, color: '#999', cursor: 'help' }} />}
  </div>
);

function isNLAverage(o: any): o is NLAverage {
  return (
    o &&
    typeof o.overall === 'number' &&
    o.buckets && typeof o.buckets === 'object' &&
    o.subs    && typeof o.subs    === 'object'
  );
}

/** Star-rating constants */
const MAX_BUCKET_SCORE = 100;   // our % scale
const MAX_STARS        = 5;



// Define the interface for the props 
export interface NaturalLanguageOverallProps {
  record: EvaluationDataRecord;
  models: string[];
  judgeModel?: string;
  enabled: string[];
  runIndex?: number; // when defined show that run; otherwise use averages
  isSynchronized?: boolean; // whether this cell is synchronized with global run selection
  onRunNavigation?: (direction: 'prev' | 'next') => void; // callback for run navigation
  onToggleRunView?: () => void; // callback for toggling between averaged and specific run view
  currentRunIndex: number | null; // current run index from global state
  totalRuns?: number; // total number of runs
  showTooltips?: boolean; // New prop to control tooltip visibility
  isLoadingJudgeEvaluations?: boolean; // New prop to show loading state for judge evaluations
}

// The main component for displaying Natural Language overall metrics
// It computes and displays the overall scores and detailed metrics for each model
// based on the judge evaluations and metrics defined in the record.
// It also allows toggling the visibility of detailed scores for analytical thinking and conversational quality.
// The component uses React hooks to manage state for expanded sections and bucket visibility.
// It displays the overall percentage scores, star ratings for analytical and conversational quality,
// and factual grounding percentages for each model.
export const NaturalLanguageOverallMetrics: React.FC<NaturalLanguageOverallProps> = ({
  record,
  models,
  judgeModel,
  enabled,
  runIndex,
  isSynchronized = false,
  onRunNavigation,
  onToggleRunView,
      currentRunIndex = null,
  totalRuns,
  showTooltips = true,
  isLoadingJudgeEvaluations = false,
}) => {
  const on = (k:string) => enabled.includes(k);
  // State to manage the visibility of overall metrics and individual buckets
  // overallOpen controls the visibility of the overall metrics section
  // openBuckets controls the visibility of the analytical and conversational quality buckets
  const [overallOpen, setOverallOpen] = useState(false);
  const [openBuckets, setOpenBuckets] = useState<{ analytical: boolean; convo: boolean }>({
    analytical: false,
    convo: false,
  });

  // Helper function to conditionally wrap content with MetricPopover
  const wrapWithTooltip = (children: React.ReactNode, props: any) => {
    if (!showTooltips) {
      return <>{children}</>;
    }
    return <MetricPopover {...props}>{children}</MetricPopover>;
  };
  
  /* ----- utility to grab the right object for one model -------- */
  const getMS = (model: string) => {
    if (runIndex !== undefined) {
      return record.run_results?.[runIndex]?.metrics?.[model] ?? record.metrics?.[model];
    }
    return record.metric_averages?.[model] ?? record.metrics?.[model];
  };
  
  // Function to get the judge evaluation for a specific model
  const getJudge = (model: string) => {
    if (!judgeModel) return {};
    if (runIndex !== undefined) {
      return record.run_results?.[runIndex]?.judge_evaluations?.[judgeModel]?.[model] ?? 
             record.judge_evaluations?.[judgeModel]?.[model] ?? {};
    }
    return record.judge_evaluations?.[judgeModel]?.[model] ?? {};
  };


  const scoreFor = (model: string, key: JudgeScoreKey): number => {
    if (!on(key)) return 0;
    const j = getJudge(model);
    if (j[key] !== undefined) return j[key] as number;   

    const ms = getMS(model) as { subs?: Record<JudgeScoreKey, number> } | undefined;            
    if (ms?.subs?.[key] !== undefined) return ms.subs[key];

    return 0;                                           
  };

  // 1) Analytical Thinking stars 
  //    This is the average of assumptions and insightfulness scores for each model
  const analyticalStars = models.map(m => {
  const j  = getJudge(m);
  const ms = getMS(m);
  
  // When showing run-specific data, use raw judge evaluations
  if (runIndex !== undefined) {
    const vals: number[] = [];
    if (on('assumptions'))    vals.push(j.assumptions    ?? 0);
    if (on('insightfulness')) vals.push(j.insightfulness ?? 0);
    return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
  }
  
  // If you cached an NLAverage, keep it — but respect enabled flags
  if (isNLAverage(ms)) {
    const vals: number[] = [];
    if (on('assumptions'))    vals.push(ms.subs?.assumptions  ?? 0);
    if (on('insightfulness')) vals.push(ms.subs?.insightfulness ?? 0);
    return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
  }

  const vals: number[] = [];
  if (on('assumptions'))    vals.push(j.assumptions    ?? 0);
  if (on('insightfulness')) vals.push(j.insightfulness ?? 0);
  return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
});

  // Coherence stars 
  const coherenceStars = models.map(m => {
  if (!on('coherence')) return 0;
  const j = getJudge(m);
  return j.coherence ?? 0;
});

// Follow‑up relevance stars
 // Fall back to cached averages (`subs`) when we’re on the
  // overview/aggregate row where `judge_evaluations` are absent.
  const followUpStars = models.map(m => {
    if (!on('follow_up_relevance')) return 0;

    const j = getJudge(m);
    if (j.follow_up_relevance !== undefined) return j.follow_up_relevance as number;

    const ms = getMS(m) as { subs?: Record<JudgeScoreKey, number> } | undefined;
    return ms?.subs?.follow_up_relevance ?? 0;
  });

  // only show follow-up bucket if any model got >0
  const showFollowUp = on('follow_up_relevance') && followUpStars.some(v => v > 0);

  // Overall Conversational Quality stars
  const convoStars = models.map((m, i) => {        // ❶ keep m
  const ms = getMS(m);

  // When showing run-specific data, derive from individual sub-metrics
  if (runIndex !== undefined) {
    const vals: number[] = [];
    if (on('coherence')) vals.push(coherenceStars[i]);
    /* Only average follow‑up relevance once we actually have a score */
    if (showFollowUp)     vals.push(followUpStars[i]);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  /* If the back-end already cached a bucket score, use it */
  if (isNLAverage(ms)) {
    const pct = ms.buckets.conversational ?? 0;  // default → 0
    return pct / 100 * 5;                        // 0-100 → 0-5 stars
  }

  /* Otherwise derive it from the individual sub-metrics */
  const vals: number[] = [];
  if (on('coherence')) vals.push(coherenceStars[i]);
  /* Only average follow‑up relevance once we actually have a score */
  if (showFollowUp)     vals.push(followUpStars[i]);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
});

  // Factual grounding
  const factualPct = models.map(m => {
  if (!on('information_similarity')) return 0;  
  const ms = getMS(m);
  
  // When showing run-specific data, use run-specific metrics
  if (runIndex !== undefined) {
    return Math.round(
      (ms?.information_similarity ?? 0) * 100
    );
  }
  
  // When showing averaged data, use the averaged structure
  if (isNLAverage(ms)) {
    return Math.round(ms.buckets.factual ?? 0);   // default to 0
  }
  return Math.round(
    (record.metrics?.[m]?.information_similarity ?? 0) * 100
  );
});

  // Overall NL
  const overallPct = models.map((_, i) => {
    /* If we already have an NLAverage that *knows* about enabled buckets,
       just trust that: */
    const ms = getMS(models[i]);
    
    // When showing run-specific data, build on-the-fly from individual metrics
    if (runIndex !== undefined) {
      const parts: number[] = [];
      if (on('assumptions') || on('insightfulness'))
        parts.push((analyticalStars[i] / 5) * 100);
      if (on('coherence') || (on('follow_up_relevance') && showFollowUp))
        parts.push((convoStars[i] / 5) * 100);
      if (on('information_similarity'))
        parts.push(factualPct[i]);

      return parts.length
        ? Math.round(parts.reduce((a,b)=>a+b,0) / parts.length)
        : 0;
    }
    
    // When showing averaged data, use the averaged structure
    if (isNLAverage(ms)) return Math.round(ms.overall);

    /* Otherwise build on-the-fly, respecting enabled flags */
    const parts: number[] = [];
    if (on('assumptions') || on('insightfulness'))
      parts.push((analyticalStars[i] / 5) * 100);
    if (on('coherence') || (on('follow_up_relevance') && showFollowUp))
      parts.push((convoStars[i] / 5) * 100);
    if (on('information_similarity'))
      parts.push(factualPct[i]);

    return parts.length
      ? Math.round(parts.reduce((a,b)=>a+b,0) / parts.length)
      : 0;
  });

  const badgeStyle = (pct: number) => {
    if (pct < 33) return { color: '#E54D37', background: 'rgba(229,77,55,0.1)' };
    if (pct < 66) return { color: '#F2B134', background: 'rgba(242,177,52,0.1)' };
    return { color: '#1170AA', background: 'rgba(17,112,170,0.1)' };
  };

  const judgeMetricsMap: Record<JudgeMetricKey, JudgeMetricInfo> = 
  Object.fromEntries(
    judgeMetricsInfo.map(j => [j.key, j])
  ) as any;

  if (!getMS(models[0])) {
  return <Skeleton active paragraph={false} title={{width: 80}}/>;
}

const showAnalytical = on('assumptions') || on('insightfulness');


   // Show loading skeleton if judge evaluations are still loading
   if (isLoadingJudgeEvaluations && judgeModel) {
     return <JudgeEvaluationLoadingSkeleton models={models} judgeModel={judgeModel} />;
   }

   return (
  
    <div style={metricGridStyles(models.length)}>
      {/* — column headers — */}
      <div /><div />
      {models.map((m) => (
        <div key={m} 
        className="metricModelHeader"
        style={{ fontSize: 12, color: '#555', textAlign: 'center' }}>
        {prettyModelPromptName(m)}
        </div>
      ))}
      

      {/* — overall row — */}
      <div
        onClick={() => setOverallOpen(o => !o)}
        style={{ cursor:'pointer', display:'flex', justifyContent:'center' }}
      >
        {overallOpen ? <DownOutlined style={{fontSize:12}}/>
                    : <CaretRightOutlined style={{fontSize:12}}/>}
      </div>
      <div style={{ fontWeight:'bold', whiteSpace:'nowrap' }}>
        Overall NL Response Quality
      </div>
      {overallPct.map((p, i) => (
        <div
          key={i}
          style={{
            ...badgeStyle(p),
           padding:     '2px 4px',    
            whiteSpace: 'nowrap',      
            borderRadius: 4,
            textAlign:   'center',
            fontWeight:  'bold',            
          }}
        >
          {p}%
        </div>
      ))}



      {overallOpen && (
        <>
{/* ────────────────────────────────────────────
    FACTUAL GROUNDING  (shows only if enabled)
──────────────────────────────────────────── */}

{on('information_similarity') && (
  <>
    <div />{/* spacer */}
      {showTooltips ? labelWithInfo('Information Similarity', 'information_similarity') : 'Information Similarity'}

    {factualPct.map((p, i) => 
      wrapWithTooltip(
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
          <div
            style={{
              ...badgeStyle(p),
              padding:      '2px 4px',
              borderRadius: 4,
              textAlign:    'center',
              fontWeight:   'bold',
            }}
          >
            {p}%
          </div>
          {showTooltips && <QuestionCircleOutlined style={{ fontSize: 11, color: '#999', cursor: 'help' }} />}
        </div>,
        {
          key: `fact-${i}`,
          metrics: record.metrics?.[models[i]],
          judge: judgeModel ? record.judge_evaluations?.[judgeModel]?.[models[i]] : undefined,
          metricKey: "information_similarity"
        }
      )
    )}
  </>
)}

{/* ────────────────────────────────────────────
    ANALYTICAL THINKING  (shows only if at least
    one of its two metrics is enabled)
──────────────────────────────────────────── */}

{judgeModel && (on('assumptions') || on('insightfulness')) && (
  <>
    {/* header row */}
    <div />{/* spacer, keeps grid alignment */}
    <div
      onClick={() =>
        setOpenBuckets(ob => ({ ...ob, analytical: !ob.analytical }))
      }
      style={{
        cursor:        'pointer',
        display:       'flex',
        alignItems:    'center',
        whiteSpace:    'nowrap',
        textWrap:      'nowrap'
      }}
    >
      {openBuckets.analytical ? (
        <DownOutlined style={{ marginRight: 4, fontSize: 12 }} />
      ) : (
        <CaretRightOutlined style={{ marginRight: 4, fontSize: 12 }} />
      )}
      <Tooltip title={nlBucketDefinitions.analyticalThinking}>
        <strong>Analytical Thinking</strong>
      </Tooltip>
    </div>

    {/* bucket-level star scores */}
    {analyticalStars.map((v, i) => (
      <StarCell key={i} value={v} />
    ))}

    {/* sub-rows (only visible when expanded) */}
    {openBuckets.analytical &&
      ['assumptions', 'insightfulness']
        .filter(on)                       // respect check-boxes
        .map(k => {
          const info = judgeMetricsMap[k as JudgeMetricKey];
          return (
            <React.Fragment key={k}>
              <div />                     {/* spacer */}
              <span
                style={{
                  display:      'block',
                  whiteSpace:   'nowrap',
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {showTooltips ? labelWithInfo(info.label, k as string) : info.label}
              </span>
              {models.map((m, j) => 
                wrapWithTooltip(
                  <StarCell value={scoreFor(m, k as JudgeScoreKey)} showInfoIcon={showTooltips} />,
                  {
                    key: `${k}-star-${j}`,
                    metrics: record.metrics?.[m],
                    judge: judgeModel ? record.judge_evaluations?.[judgeModel]?.[m] : undefined,
                    metricKey: k
                  }
                )
              )}
            </React.Fragment>
          );
        })}
  </>
)}
{/* ───────── CONVERSATIONAL QUALITY ───────── */}
{judgeModel && (on('coherence') || on('follow_up_relevance')) && (
  <>
    {/* bucket header */}
    <div />{/* spacer */}
    <div
      onClick={() => setOpenBuckets(ob => ({ ...ob, convo: !ob.convo }))}
      style={{
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        textWrap: 'nowrap',
      }}
    >
      {openBuckets.convo ? (
        <DownOutlined style={{ marginRight: 4, fontSize: 12 }} />
      ) : (
        <CaretRightOutlined style={{ marginRight: 4, fontSize: 12 }} />
      )}
      <Tooltip title={nlBucketDefinitions.conversationalQuality}>
        <strong>Conversational Quality</strong>
      </Tooltip>
    </div>

    {/* bucket stars */}
    {convoStars.map((v, i) => (
      <StarCell key={`anal-star-${i}`} value={v} />
    ))}

    {/* sub-rows */}
    {openBuckets.convo &&
      (showFollowUp
        ? ['follow_up_relevance', 'coherence']
        : ['coherence']
      )
        .filter(on)
        .map(k => {
          const info = judgeMetricsMap[k as JudgeMetricKey];
          return (
            <React.Fragment key={k}>
              <div />{/* spacer */}
              <span
                style={{
                  display: 'block',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {showTooltips ? labelWithInfo(info.label, k as string) : info.label}
              </span>
              {models.map((m, j) => 
                wrapWithTooltip(
                  <StarCell value={scoreFor(m, k as JudgeScoreKey)} showInfoIcon={showTooltips} />,
                  {
                    key: `${k}-star-${j}`,
                    metrics: record.metrics?.[m],
                    judge: judgeModel ? record.judge_evaluations?.[judgeModel]?.[m] : undefined,
                    metricKey: k
                  }
                )
              )}
            </React.Fragment>
          );
        })}
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
} 
