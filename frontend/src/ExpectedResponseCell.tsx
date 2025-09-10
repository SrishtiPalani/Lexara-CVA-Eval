import React, { useMemo } from 'react';
import { VegaLite } from 'react-vega';
import SpeechBubble from './SpeechBubble';
import { VisualizationSpec } from 'vega-embed';
import { describeVegaSpec } from './vizspecUtils';
import ReactMarkdown from 'react-markdown';

interface ExpectedResponseCellProps {
  vegaSpec: VisualizationSpec | null;
  errors: string[];
  dataValues: any[];
  prevContext?: string;
}

const ExpectedResponseCell: React.FC<ExpectedResponseCellProps> = React.memo(
  ({ vegaSpec, errors, dataValues, prevContext }) => {
    // If there is a valid Vega spec, we show both the chart and the textual explanation
    if (vegaSpec) {
      return (
        <div>

            <VegaLite spec={vegaSpec} data={{ data: { data: dataValues } }} />

          {/* render the Markdown‑formatted description */}
        <SpeechBubble variant="expected">
          <ReactMarkdown>
            {describeVegaSpec(vegaSpec, dataValues, prevContext)}
          </ReactMarkdown>
        </SpeechBubble>
        </div>
      );
    }

    // Otherwise show the error messages or “No visualization”
    if (errors && errors.length > 0) {
      return (
        <div>
          {errors.map((error, index) => (
            <div key={index} style={{ color: 'blue', marginBottom: '4px' }}>
              {error}
            </div>
          ))}
        </div>
      );
    }

    return <div>No visualization available</div>;
  }
);

export default ExpectedResponseCell;
