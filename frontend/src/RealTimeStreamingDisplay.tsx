import React from 'react';
import { Card, Tag, Typography, Space, Tooltip } from 'antd';
import { CheckCircleOutlined, LoadingOutlined, ClockCircleOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface StreamingFragment {
  type: "row-fragment" | "judge-fragment";
  row_id: string;
  synthetic_key: string;
  timestamp: number;
  data: any;
}

interface RealTimeStreamingDisplayProps {
  fragments: StreamingFragment[];
  maxDisplayed?: number;
}

export const RealTimeStreamingDisplay: React.FC<RealTimeStreamingDisplayProps> = ({
  fragments,
  maxDisplayed = 10
}) => {
  const recentFragments = fragments.slice(-maxDisplayed);

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 1000) return 'Just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    return `${Math.floor(diff / 60000)}m ago`;
  };

  const getFragmentIcon = (type: string) => {
    switch (type) {
      case 'row-fragment':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'judge-fragment':
        return <ClockCircleOutlined style={{ color: '#1890ff' }} />;
      default:
        return <LoadingOutlined />;
    }
  };

  const getFragmentTitle = (fragment: StreamingFragment) => {
    const [model, prompt] = fragment.synthetic_key.split('|');
    const [file, testNum, turnIdx] = fragment.row_id.split('|');
    
    switch (fragment.type) {
      case 'row-fragment':
        return `Model Response: ${model} (${prompt})`;
      case 'judge-fragment':
        return `Judge Evaluation: ${fragment.data.judge_model} for ${model}`;
      default:
        return 'Unknown Fragment';
    }
  };

  const getFragmentDescription = (fragment: StreamingFragment) => {
    const [file, testNum, turnIdx] = fragment.row_id.split('|');
    return `Test ${testNum}, Turn ${turnIdx} • ${file}`;
  };

  if (fragments.length === 0) {
    return null;
  }

  return (
    <Card 
      title="Real-Time Streaming" 
      size="small"
      style={{ marginBottom: 16 }}
      extra={
        <Tag color="blue">
          {fragments.length} fragments received
        </Tag>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {recentFragments.map((fragment, index) => (
          <div 
            key={`${fragment.row_id}-${fragment.synthetic_key}-${fragment.timestamp}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 12px',
              border: '1px solid #f0f0f0',
              borderRadius: '6px',
              backgroundColor: index === recentFragments.length - 1 ? '#f6ffed' : '#fff',
              transition: 'background-color 0.3s ease'
            }}
          >
            <Space>
              {getFragmentIcon(fragment.type)}
              <div>
                <Text strong>{getFragmentTitle(fragment)}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  {getFragmentDescription(fragment)}
                </Text>
              </div>
            </Space>
            <div style={{ marginLeft: 'auto' }}>
              <Tooltip title={new Date(fragment.timestamp).toLocaleTimeString()}>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  {formatTime(fragment.timestamp)}
                </Text>
              </Tooltip>
            </div>
          </div>
        ))}
        
        {fragments.length > maxDisplayed && (
          <Text type="secondary" style={{ fontSize: '12px', textAlign: 'center', display: 'block' }}>
            Showing {maxDisplayed} most recent of {fragments.length} fragments
          </Text>
        )}
      </Space>
    </Card>
  );
};
