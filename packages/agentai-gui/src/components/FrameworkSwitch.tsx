import React from 'react';
import { Button, Tag, Space, Tooltip, Slider } from 'antd';
import { ThunderboltOutlined, SwapOutlined, RobotOutlined } from '@ant-design/icons';
import { useFrameworkStore } from '../store';

export const FrameworkSwitch: React.FC<{ onSwitch?: (to: 'openclaw' | 'hermes') => void }> = ({ onSwitch }) => {
  const { active, abRatio, setActive, setAbRatio } = useFrameworkStore();

  const switchTo = (to: 'openclaw' | 'hermes') => {
    setActive(to);
    onSwitch?.(to);
  };

  return (
    <div style={{ padding: 16, borderBottom: '1px solid #303030' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>
            <RobotOutlined /> 智能体框架 (热切换, 不重启)
          </div>
          <Space style={{ width: '100%' }} size="small">
            <Button
              type={active === 'openclaw' ? 'primary' : 'default'}
              icon={<ThunderboltOutlined />}
              onClick={() => switchTo('openclaw')}
              block
            >
              OpenClaw
            </Button>
            <Button
              type={active === 'hermes' ? 'primary' : 'default'}
              icon={<SwapOutlined />}
              onClick={() => switchTo('hermes')}
              block
              style={{ background: active === 'hermes' ? '#9333EA' : undefined, borderColor: active === 'hermes' ? '#9333EA' : undefined }}
            >
              Hermes
            </Button>
          </Space>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: 12, marginBottom: 4 }}>
            <span>A/B 灰度</span>
            <span>{(abRatio * 100).toFixed(0)}% → {active}</span>
          </div>
          <Tooltip title="让 X% 流量进新框架, 剩下走旧框架 (用于 shadow test)">
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={abRatio}
              onChange={setAbRatio}
            />
          </Tooltip>
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Tag color="blue">parallelTools</Tag>
          <Tag color="purple">chineseInjectionScan</Tag>
          <Tag color="cyan">FTS5</Tag>
          <Tag color="green">hotReload</Tag>
        </div>
      </Space>
    </div>
  );
};
