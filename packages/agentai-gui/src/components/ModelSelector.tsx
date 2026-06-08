/**
 * ModelSelector - LLM 模型选择器
 * 包含 agentai (主) / deepseek / openai
 */
import React from 'react';
import { Select, Space, Tag, Tooltip } from 'antd';
import { ApiOutlined, CheckCircleFilled } from '@ant-design/icons';
import { useSettingsStore } from '../store';

const MODELS = [
  { id: 'agentai', label: 'Agnes AI', color: '#4F46E5', desc: '主模型, 默认' },
  { id: 'deepseek', label: 'DeepSeek', color: '#10B981', desc: '备选 1, 性价比高' },
  { id: 'openai', label: 'OpenAI', color: '#9333EA', desc: '备选 2, 最贵' },
] as const;

export const ModelSelector: React.FC = () => {
  const { provider, setProvider, hasKey } = useSettingsStore();
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <div style={{ color: '#888', fontSize: 12 }}>
        <ApiOutlined /> LLM 底层模型 (主=Agnes, 备=DeepSeek/OpenAI)
      </div>
      <Select
        value={provider}
        onChange={setProvider}
        style={{ width: '100%' }}
        size="middle"
        options={MODELS.map(m => ({
          value: m.id,
          label: (
            <Space>
              <span style={{ color: m.color, fontWeight: 600 }}>{m.label}</span>
              <span style={{ fontSize: 11, color: '#888' }}>{m.desc}</span>
            </Space>
          ),
        }))}
      />
      <Space size={4} wrap>
        {MODELS.map(m => (
          <Tooltip key={m.id} title={m.id === provider ? '当前' : `切换到 ${m.label}`}>
            <Tag
              color={m.id === provider ? m.color : 'default'}
              style={{ cursor: 'pointer' }}
              onClick={() => setProvider(m.id as any)}
              icon={m.id === provider ? <CheckCircleFilled /> : undefined}
            >
              {m.label}
            </Tag>
          </Tooltip>
        ))}
      </Space>
      {!hasKey && (
        <div style={{ fontSize: 11, color: '#fa8c16' }}>
          ⚠️ 未检测到 API Key, 将使用 stub 模式 (在 .env 填 AGENTAI_API_KEY)
        </div>
      )}
    </Space>
  );
};
