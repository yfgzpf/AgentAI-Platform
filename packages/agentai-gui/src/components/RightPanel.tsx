/**
 * RightPanel - 右侧信息面板 (Tab 切换)
 *   默认展开「上下文」, 点击切换记忆/规范/页面元素
 */
import React, { useState } from 'react';
import { Card } from 'antd';
import { AimOutlined, HistoryOutlined, FileTextOutlined, ScanOutlined } from '@ant-design/icons';
import { AIContextPanel } from './AIContextPanel';
import { AIInjectContextPanel } from './AIInjectContextPanel';
import { AIToolCallPanel } from './AIToolCallPanel';
import { MemoryFilesPanel } from './MemoryFilesPanel';
import { AutoIdentifyPanel } from './AutoIdentifyPanel';
import { ProjectRulesPanel } from './ProjectRulesPanel';
import { GeneratedFilesPanel } from './GeneratedFilesPanel';
import { TaskPlanPanel } from './TaskPlanPanel';

const TABS = [
  { key: 'context', label: '上下文', icon: <AimOutlined /> },
  { key: 'memory',  label: '记忆',   icon: <HistoryOutlined /> },
  { key: 'rules',   label: '规范',   icon: <FileTextOutlined /> },
  { key: 'element', label: '元素',   icon: <ScanOutlined /> },
] as const;

type TabKey = typeof TABS[number]['key'];

export const RightPanel: React.FC = () => {
  const [active, setActive] = useState<TabKey>('context');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f0f0f' }}>
      {/* Tab 切换栏 */}
      <div style={{
        display: 'flex', padding: '8px 8px 0 0',
        borderBottom: '1px solid #1f1f1f',
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              padding: '6px 8px', fontSize: 11, fontWeight: 600,
              border: 'none', borderBottom: active === t.key ? '2px solid #6366f1' : '2px solid transparent',
              background: 'transparent',
              color: active === t.key ? '#6366f1' : '#666',
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 12px 0' }}>
        {active === 'context' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <AIInjectContextPanel />
            <TaskPlanPanel />
            <AIContextPanel />
            <GeneratedFilesPanel />
            <AIToolCallPanel />
          </div>
        )}
        {active === 'memory'  && <MemoryFilesPanel />}
        {active === 'rules'   && <ProjectRulesPanel />}
        {active === 'element' && <AutoIdentifyPanel />}
      </div>
    </div>
  );
};
