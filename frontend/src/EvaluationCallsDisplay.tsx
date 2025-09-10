import React from 'react';
import { Card, Typography, Space, Tag } from 'antd';
import { ApiOutlined, LoadingOutlined, CheckCircleOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface EvaluationCall {
  type: 'model' | 'judge';
  model: string;
  prompt?: string;
  status: 'pending' | 'in-progress' | 'completed';
  timestamp?: number;
}

interface EvaluationCallsDisplayProps {
  fragments: Array<{
    type: "row-fragment" | "judge-fragment";
    row_id: string;
    synthetic_key: string;
    timestamp: number;
    data: any;
  }>;
  models: string[];
  systemPrompts: string[];
  judgeModel?: string;
  runsPerInstance: number;
}

export const EvaluationCallsDisplay: React.FC<EvaluationCallsDisplayProps> = ({
  fragments,
  models,
  systemPrompts,
  judgeModel,
  runsPerInstance
}) => {
  // Generate expected calls based on configuration
  const generateExpectedCalls = (): EvaluationCall[] => {
    const calls: EvaluationCall[] = [];
    
    // Note: This is a simplified calculation. In reality, the number of calls depends on:
    // - Number of test cases
    // - Number of utterances per test case
    // - Number of runs per instance
    // - Number of models
    // - Number of prompts
    // - Whether judge model is enabled
    
    // For now, we'll show a conservative estimate based on what we know
    const estimatedUtterancesPerTestCase = 2; // This varies by test case
    
    // Add model response calls
    models.forEach(model => {
      systemPrompts.forEach((prompt, promptIndex) => {
        for (let run = 0; run < runsPerInstance; run++) {
          calls.push({
            type: 'model',
            model,
            prompt: `prompt${promptIndex + 1}`,
            status: 'pending'
          });
        }
      });
    });
    
    // Add judge evaluation calls if judge model is specified
    if (judgeModel) {
      models.forEach(model => {
        systemPrompts.forEach((prompt, promptIndex) => {
          for (let run = 0; run < runsPerInstance; run++) {
            calls.push({
              type: 'judge',
              model: judgeModel,
              prompt: `evaluating ${model}|prompt${promptIndex + 1}`,
              status: 'pending'
            });
          }
        });
      });
    }
    
    return calls;
  };

  const expectedCalls = generateExpectedCalls();
  
  // Update call statuses based on fragments
  const updatedCalls = expectedCalls.map(call => {
    const syntheticKey = call.type === 'model' 
      ? call.prompt 
      : call.prompt?.replace('evaluating ', '');
    
    const matchingFragment = fragments.find(frag => {
      if (call.type === 'model' && frag.type === 'row-fragment') {
        return frag.synthetic_key === syntheticKey;
      }
      if (call.type === 'judge' && frag.type === 'judge-fragment') {
        return frag.synthetic_key === syntheticKey;
      }
      return false;
    });
    
    if (matchingFragment) {
      return {
        ...call,
        status: 'completed' as const,
        timestamp: matchingFragment.timestamp
      };
    }
    
    return call;
  });

  const completedCalls = updatedCalls.filter(call => call.status === 'completed');
  const pendingCalls = updatedCalls.filter(call => call.status === 'pending');

  return (
    <Card 
      size="small" 
      title={
        <Space>
          <ApiOutlined />
          <Text strong>API Calls Progress</Text>
          <Tag color="blue">{completedCalls.length}/{updatedCalls.length}</Tag>
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <div style={{ fontSize: '12px', color: '#666' }}>
          <Text>Model Responses: {models.length} models × {systemPrompts.length} prompts × {runsPerInstance} runs = {models.length * systemPrompts.length * runsPerInstance}</Text>
        </div>
        {judgeModel && (
          <div style={{ fontSize: '12px', color: '#666' }}>
            <Text>Judge Evaluations: {judgeModel} × {models.length} models × {systemPrompts.length} prompts × {runsPerInstance} runs = {models.length * systemPrompts.length * runsPerInstance}</Text>
          </div>
        )}
        <div style={{ fontSize: '12px', color: '#666' }}>
          <Text type="secondary">Note: Actual count depends on test case utterances</Text>
        </div>
        <div style={{ fontSize: '12px', color: '#666' }}>
          <Text strong>Total Expected: {updatedCalls.length} calls</Text>
        </div>
        
        {pendingCalls.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: '11px' }}>
              Pending: {pendingCalls.slice(0, 3).map(call => 
                `${call.model}${call.prompt ? ` (${call.prompt})` : ''}`
              ).join(', ')}
              {pendingCalls.length > 3 && ` +${pendingCalls.length - 3} more`}
            </Text>
          </div>
        )}
        
        {completedCalls.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="success" style={{ fontSize: '11px' }}>
              Completed: {completedCalls.slice(-3).map(call => 
                `${call.model}${call.prompt ? ` (${call.prompt})` : ''}`
              ).join(', ')}
              {completedCalls.length > 3 && ` +${completedCalls.length - 3} earlier`}
            </Text>
          </div>
        )}
      </Space>
    </Card>
  );
};
