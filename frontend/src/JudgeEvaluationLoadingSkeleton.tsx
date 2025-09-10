import React from 'react';
import { Skeleton, Space } from 'antd';

interface JudgeEvaluationLoadingSkeletonProps {
  models: string[];
  judgeModel?: string;
}

export const JudgeEvaluationLoadingSkeleton: React.FC<JudgeEvaluationLoadingSkeletonProps> = ({
  models,
  judgeModel
}) => {
  if (!judgeModel) {
    return null;
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ marginBottom: '8px', fontSize: '12px', color: '#666' }}>
        ⚖️ {judgeModel} evaluating...
      </div>
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {models.map((model) => (
          <div key={model} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: '#666', minWidth: '80px' }}>
              {model.split('|')[0]}
            </div>
            <Skeleton.Input 
              active 
              size="small" 
              style={{ width: '120px', height: '16px' }}
            />
          </div>
        ))}
      </Space>
    </div>
  );
};
