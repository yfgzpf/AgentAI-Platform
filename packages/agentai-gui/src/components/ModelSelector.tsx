/**
 * ModelSelector - LLM 模型选择器 (5 维评分路由版)
 * ----------------------------------------------------
 * 6 个可用模型:
 *   Cline: DS Flash (免费) / MiniMax M3 (免费) / 小米 MiMo (免费)
 *   AgentAI: Agnes AI (免费)
 *   DeepSeek: Pro (付费)
 *   OpenAI: GPT-4o mini (付费)
 *
 * 路由规则 (纯后端 5 维评分, 前端只做 UI 手动覆盖):
 *   1. 如果用户手动选定, 锁定该 provider
 *   2. 如果未选, 后端 routeByScore() 自动
 *   3. 付费模型受每日 $5 上限约束
 */
import React from 'react';
import { Select, Space, Tag, Tooltip, Divider, Badge } from 'antd';
import { ApiOutlined, CheckCircleFilled, ThunderboltOutlined, CrownOutlined, RobotOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../store';

interface ModelOption {
  id: string;
  label: string;
  provider: string;
  color: string;
  isFree: boolean;
  supportsTools: boolean;
  supportsImages: boolean;
  maxContext: string;
  desc: string;
}

const MODELS: ModelOption[] = [
  // --- 免费 ---
  { id: 'cline:deepseek-v4-flash', label: 'DS Flash', provider: 'cline', color: '#F59E0B', isFree: true, supportsTools: true, supportsImages: false, maxContext: '64k', desc: '免费, 速度快, 通用对话' },
  { id: 'cline:minimax-m3', label: 'MiniMax M3', provider: 'cline', color: '#F59E0B', isFree: true, supportsTools: false, supportsImages: false, maxContext: '128k', desc: '免费, 社交闲聊' },
  { id: 'cline:xiaomi-mimo-v2.5', label: '小米 MiMo', provider: 'cline', color: '#F59E0B', isFree: true, supportsTools: true, supportsImages: true, maxContext: '1M', desc: '免费, 1M 上下文, 多模态' },
  { id: 'agentai:agnes-v4', label: 'Agnes AI', provider: 'agentai', color: '#4F46E5', isFree: true, supportsTools: true, supportsImages: true, maxContext: '1M', desc: '主模型, 工具+多模态' },
  // --- 付费 ---
  { id: 'deepseek:v4-pro', label: 'DS Pro', provider: 'deepseek', color: '#10B981', isFree: false, supportsTools: true, supportsImages: true, maxContext: '1M', desc: '强力推理, 架构/安全场景' },
  { id: 'openai:gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai', color: '#9333EA', isFree: false, supportsTools: true, supportsImages: true, maxContext: '128k', desc: '付费兜底' },
];

export const ModelSelector: React.FC = () => {
  const { provider, setProvider, hasKey } = useSettingsStore();

  // provider 兼容: 旧版 store 存的是 'cline' (旧格式), 新版用 'cline:xxx'
  // 兼容转换: 如果 provider 是 provider 名 (如 'cline'), 选中该 provider 的第一个免费模型
  const currentModelId = MODELS.some(m => m.id === provider) ? provider : MODELS.find(m => m.provider === provider)?.id || 'agentai:agnes-v4';
  const selectedModel = MODELS.find(m => m.id === currentModelId) || MODELS[0];

  const handleChange = (modelId: string) => {
    setProvider(modelId as any);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <div style={{ color: '#888', fontSize: 12 }}>
        <ApiOutlined /> 模型选择
        <span style={{ marginLeft: 8, fontSize: 11, color: '#666' }}>
          (未选时后端 5 维评分自动路由)
        </span>
      </div>

      <Select
        value={currentModelId}
        onChange={handleChange}
        style={{ width: '100%' }}
        size="middle"
        optionLabelProp="label"
        popupMatchSelectWidth={false}
        options={[
          { label: '━━ 免费 ━━', value: '__divider_free__', disabled: true },
          ...MODELS.filter(m => m.isFree).map(m => ({
            value: m.id,
            label: (
              <Space>
                <span style={{ color: m.color, fontWeight: 600 }}>{m.label}</span>
                <span style={{ fontSize: 11, color: '#888' }}>{m.desc}</span>
                <Badge count="免费" size="small" style={{ backgroundColor: '#52c41a' }} />
              </Space>
            ),
          })),
          { label: '━━ 付费 (受每日 $5 上限) ━━', value: '__divider_paid__', disabled: true },
          ...MODELS.filter(m => !m.isFree).map(m => ({
            value: m.id,
            label: (
              <Space>
                <span style={{ color: m.color, fontWeight: 600 }}>{m.label}</span>
                <span style={{ fontSize: 11, color: '#888' }}>{m.desc}</span>
                <Badge count="付费" size="small" style={{ backgroundColor: '#fa8c16' }} />
              </Space>
            ),
          })),
        ]}
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {MODELS.map(m => {
          const isCurrent = currentModelId === m.id;
          const groupColor = m.isFree ? '#52c41a' : '#fa8c16';
          return (
            <Tooltip key={m.id} title={`${m.label}: ${m.desc} | ${m.maxContext}`}>
              <Tag
                color={isCurrent ? m.color : undefined}
                style={{
                  cursor: 'pointer',
                  border: isCurrent ? `2px solid ${m.color}` : '1px solid #333',
                  opacity: isCurrent ? 1 : 0.7,
                }}
                onClick={() => handleChange(m.id)}
                icon={isCurrent ? <CheckCircleFilled /> : (m.isFree ? <ThunderboltOutlined /> : <CrownOutlined />)}
              >
                {m.label}
                <span style={{ fontSize: 10, marginLeft: 4, color: groupColor }}>
                  {m.isFree ? '免费' : '付费'}
                </span>
              </Tag>
            </Tooltip>
          );
        })}
      </div>

      {selectedModel && (
        <div style={{ fontSize: 11, color: '#666' }}>
          <RobotOutlined /> 当前: <b style={{ color: selectedModel.color }}>{selectedModel.label}</b>
          {' · '}{selectedModel.supportsTools ? '支持工具' : '不支持工具'}
          {' · '}{selectedModel.supportsImages ? '支持图片' : '不支持图片'}
          {' · '}{selectedModel.maxContext} 上下文
        </div>
      )}

      {!hasKey && (
        <div style={{ fontSize: 11, color: '#fa8c16' }}>
          ⚠️ 未检测到 API Key, 将使用 stub 模式 (在 .env 填对应 API Key)
        </div>
      )}
    </Space>
  );
};
