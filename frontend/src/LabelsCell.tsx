import React from 'react';
import { Tag } from 'antd';
import { getColorForLabel } from './utils';

interface LabelsCellProps {
  labels: string[];
  rowCount?: number;
}

const LabelsCell: React.FC<LabelsCellProps> = React.memo(({ labels, rowCount }) => {
  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Show each label in a colored tag with word wrapping */}
      <div style={{ 
        marginBottom: '4px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '2px',
        maxWidth: '100%'
      }}>
        {labels.map(label => (
          <Tag 
            key={label} 
            color={getColorForLabel(label)}
            style={{
              margin: 0,
              fontSize: '11px',
              lineHeight: '1.2',
              padding: '1px 4px',
              maxWidth: '100%',
              wordBreak: 'break-word',
              whiteSpace: 'normal'
            }}
          >
            {label}
          </Tag>
        ))}
      </div>

      {/* Optionally show how many rows if there are children */}
      {typeof rowCount === 'number' && rowCount > 1 && (
        <div style={{ color: 'gray', fontSize: '10px', lineHeight: '1.2' }}>
          {rowCount} turns
        </div>
      )}
    </div>
  );
});

export default LabelsCell;
