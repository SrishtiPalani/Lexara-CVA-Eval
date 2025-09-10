import React from 'react';
import { Popover } from 'antd';
import type { MetricScores } from './metrics';
import type { ModelJudgeEval } from './NaturalLanguageOverallMetrics';
import { MetricExplanations } from './MetricExplanations';

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

/**
 * Wraps a metric cell (children) and shows the contextual bullet list on
 * hover / click.  Supports both individual-run rows and aggregate rows.
 */
interface Props {
  /** full MetricScores blob for the *relevant* model / run */
  metrics?: MetricScores;
  judge?:   ModelJudgeEval;
  /** Expected Vega-Lite specification with properties needed for metric explanations */
  expected?: VegaSpecForMetrics | null;
  /** Actual Vega-Lite specification with properties needed for metric explanations */
  actual?:   VegaSpecForMetrics | null;
  /** the visual pill / star element */
  children: React.ReactNode;
  /** When set, show **only** the explanation for this metric key */
  metricKey?: string;
}

export const MetricPopover: React.FC<Props> = ({
  metrics,
  judge,
  expected,
  actual,
  children,
  metricKey,
}) => {
  // Only interactive when we actually have something to say
  const disabled = !(metrics || judge);
  return (
    <>
      {/* When nothing to show just render children (no pop-over wrapper) */}
      {disabled ? (
        <>{children}</>
      ) : (
        <Popover
          trigger={['hover', 'click']}
          placement="top"
          overlayClassName="metric-expl-popover"
          overlayStyle={{ 
            maxWidth: '400px',  // Constrain width to reasonable size
            whiteSpace: 'normal',
            wordWrap: 'break-word',
            overflowWrap: 'break-word'
          }}
          destroyTooltipOnHide
          content={
            <MetricExplanations
              bare
              metrics={metrics}
              judge={judge}
              expectedVega={expected}
              actualVega={actual}
              metricKey={metricKey}
            />
          }
        >
          <span style={{ cursor: 'pointer' }}>{children}</span>
        </Popover>
      )}
    </>
  );
};
