import React, { useState } from 'react';
import { DiffOutlined } from '@ant-design/icons';
import { Modal, Tooltip, Button } from 'antd';
import { JsonDiffViewer } from './JsonDiffViewer';
import { EvaluationDataRecord } from './types';
import './ModelRawOutputCell.css';

interface ModelRawOutputCellProps {
  record: EvaluationDataRecord;
  model: string;
  modelOutputs: Record<string, string>;
  differences: Record<
    string,
    Record<
      string,
      { missingProperties: string[]; unequalProperties: string[]; total: number }
    >
  >;
  highlightDiffs: (
    expected: any,
    actual: string,
    showMissing: boolean,
    showUnequal: boolean
  ) => JSX.Element;
  modelDiffToggles: Record<string, { showMissing: boolean; showUnequal: boolean }>;
}

const ModelRawOutputCell: React.FC<ModelRawOutputCellProps> = ({
  record,
  model,
  modelOutputs,
  differences,
  highlightDiffs,
  modelDiffToggles,
}) => {
  const [diffModalVisible, setDiffModalVisible] = useState(false);

  // Grab the raw JSON string returned by the model; fallback to '{}'
  const rawOutput = modelOutputs[model] || '{}';

  // Since all models now return two fields ("content" + "user_friendly_reply"),
  // we'll parse the JSON and extract just the notional spec from parsed.content
  let strippedNotionalSpec = '{}';
  try {
    const parsed = JSON.parse(rawOutput);
    strippedNotionalSpec = JSON.stringify(parsed.content ?? {}, null, 2);
  } catch (err) {
    console.error(`Failed to parse JSON for model '${model}'`, err);
    // We keep strippedNotionalSpec as '{}'
  }

  const differenceCount = differences[record.key]?.[model]?.total || 0;
  const showMissing = modelDiffToggles[model]?.showMissing || false;
  const showUnequal = modelDiffToggles[model]?.showUnequal || false;

  return (
    <div style={{ maxHeight: 200, overflow: 'auto', position: 'relative' }}>
      <Button
        className="diff-btn"
        onClick={() => setDiffModalVisible(true)}
        style={{
          bottom: 0,
          padding: '8px',
          fontWeight: 'bold',
          backgroundColor: 'inherit', 
          borderTop: '1px solid #ddd'
        }}
      >
        <DiffOutlined />
        Found {differenceCount} difference{differenceCount !== 1 ? 's' : ''}
      </Button>

      {/* Modal dialog for a more detailed diff view */}
      <Modal
        open={diffModalVisible}
        onCancel={() => setDiffModalVisible(false)}
        footer={null}
        width={1000}
        title="Detailed Differences"
      >
        <JsonDiffViewer
          userUtterance={record.input}
          canonical={record.canonical}
          paraphrases={record.paraphrases}
          labels={record.labels}
          expectedTitle="Expected Raw Output"
          modelTitle={`${model} Raw Output`}
          differenceTitle="Differences"
          expectedJson={record.expected_output}
          modelJson={strippedNotionalSpec} // pass the extracted notional spec
          differenceList={differences[record.key]?.[model]}
          onClose={() => setDiffModalVisible(false)}
          isSynchronized={false}
          onRunNavigation={undefined}
          currentRunIndex={null}
          totalRuns={undefined}
          showDiffButton={true}
        />
      </Modal>
    </div>
  );
};

export default ModelRawOutputCell;
