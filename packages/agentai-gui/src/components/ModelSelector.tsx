/**
 * ModelSelector — 统一的模型选择器 (二级展开)
 * -------------------------------------------------
 * 三种模式:
 *   1. "full"    — RightPanel 完整面板 (分组 + 可折叠子模型列表)
 *   2. "compact" — Composer 工具栏 (Dropdown 子菜单展开)
 *   3. "minimal" — TitleBar 极简 (Dropdown 子菜单展开)
 *
 * 过滤逻辑:
 *   - 免费模型 (agentai/zhipu): 始终显示
 *   - 工厂模型组 (SuperAPI/NVIDIA/SenseNova/LongCat): 密钥已配置则显示组, 展开看子模型
 *   - 独立商用模型: 密钥已配置则显示
 *   - 自定义模型: enabled 则显示
 *
 * 二级展开:
 *   工厂组 (SuperAPI/NVIDIA/SenseNova) 显示为可展开的子菜单, 不铺平
 *   NVIDIA 组首项为 "NVIDIA Auto (智能择优)" — 系统自动选择最佳模型
 */
import React, { useState } from 'react';
import { Select, Space, Tag, Tooltip, Badge, Dropdown, Checkbox } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined, CheckCircleFilled, ThunderboltOutlined, CrownOutlined, RobotOutlined,
  DownOutlined,
} from '@ant-design/icons';
import { useModelStore, type ModelConfig } from '../store/modelStore';
import { useModelMetrics } from '../hooks/useModelMetrics'; // Phase 3: 模型性能指标

/* ===== 密钥检查 ===== */
function hasApiKey(m: ModelConfig, commercialKeys: Record<string, string>): boolean {
  const envVar = m.apiKeyEnv || `${m.id.toUpperCase()}_API_KEY`;
  // 检查商业密钥、localStorage、sessionStorage（安全存储）
  return !!commercialKeys[envVar] ||
    !!localStorage.getItem(envVar) ||
    !!localStorage.getItem(`__agentai_key_${m.provider || m.id}`) ||
    !!sessionStorage.getItem('agentai.' + envVar) ||  // 🔧 修复: 也检查 sessionStorage
    !!sessionStorage.getItem(`agentai.__agentai_key_${m.provider || m.id}`);  // 🔧 兼容旧格式
}

function isFreeModel(m: ModelConfig): boolean {
  return m.id === 'agentai' || m.id === 'zhipu' || m.provider === 'agnes';
}

/** 从 baseURL 提取渠道简称 */
function channelName(baseURL: string): string {
  const host = baseURL.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const map: Record<string, string> = {
    'api.agnes-ai.cn': 'Agnes',
    'api.deepseek.com': 'DeepSeek',
    'api.openai.com': 'OpenAI',
    'open.bigmodel.cn': '智谱',
    'dashscope.aliyuncs.com': '通义',
    'api.moonshot.cn': 'Moonshot',
    'api.lingyiwanwu.com': '零一',
    'api.baichuan-ai.com': '百川',
    'api.minimax.chat': 'MiniMax',
    'api.anthropic.com': 'Claude',
    'superapi.vanguard.dpdns.org': 'SuperAPI',
    'token.sensenova.cn': 'SenseNova',
    'api.longcat.chat': 'LongCat',
    // nvidia 已移除
  };
  return map[host] || host.split('.')[0];
}

/** 判断是否为工厂组 (单一密钥共享多模型) */
function isFactoryGroup(m: ModelConfig): boolean {
  return ['superapi', 'sensenova', 'longcat'].includes(m.provider || '');
}

/* ===== Props ===== */
type DisplayMode = 'full' | 'compact' | 'minimal';

interface Props {
  mode?: DisplayMode;
  onSelect?: () => void;
  compact?: boolean;
}

/* ===== 组件 ===== */
export const ModelSelector: React.FC<Props> = ({ mode = 'full', onSelect }) => {
  const { models, activeModelId, setActive, commercialKeys, chatMode } = useModelStore();
  const activeModel = models.find(m => m.id === activeModelId) || models[0];
  
  // Phase 3: 模型性能指标
  const { getModelMetrics } = useModelMetrics();
  
  // 辅助函数：格式化性能指标显示
  const formatMetrics = (modelId: string) => {
    const m = getModelMetrics(modelId);
    if (!m || m.totalCalls === 0) return null;
    return {
      avgLatency: m.avgLatency > 0 ? `${(m.avgLatency / 1000).toFixed(1)}s` : '-',
      avgCost: m.avgCost > 0 ? `¥${m.avgCost.toFixed(4)}` : '-',
      successRate: m.successRate > 0 ? `${(m.successRate * 100).toFixed(0)}%` : '-',
      totalCalls: m.totalCalls,
    };
  };

  // ===== 过滤: 有密钥或免费或已启用 =====
  const visibleModels = models.filter(m => {
    if (isFreeModel(m)) return true;
    if (hasApiKey(m, commercialKeys)) return true;
    if (m.enabled) return true;
    return false;
  });

  // 对话改图模式: 仅显示 chat(多模态) + image 类型模型
  const imageCapableModels = visibleModels.filter(m =>
    m.modelType === 'image' ||
    (m.modelType === 'chat' && ['zhipu', 'doubao-chat', 'qwen-chat', 'longcat-2.0'].includes(m.id))
  );

  // chatMode 感知: 图片模式用 imageCapableModels, 否则用 visibleModels
  const activeModels = chatMode === 'image_edit' ? imageCapableModels : visibleModels;

  // ===== 分组: 工厂组按 provider 聚合, 独立模型各自一组 =====
  interface Group {
    key: string;
    label: string;
    color: string;
    models: ModelConfig[];
    isFactory: boolean;
  }

  const groupMap = new Map<string, Group>();
  for (const m of activeModels) {
    const isFactory = isFactoryGroup(m);
    const gKey = isFactory ? (m.provider || m.groupLabel || '其他') : m.id;
    const gLabel = isFactory ? (m.groupLabel || channelName(m.baseURL)) : m.label;
    if (!groupMap.has(gKey)) {
      groupMap.set(gKey, { key: gKey, label: gLabel, color: m.color, models: [], isFactory });
    }
    groupMap.get(gKey)!.models.push(m);
  }
  const groups = Array.from(groupMap.values());

  const handleSelect = (id: string) => {
    setActive(id);
    onSelect?.();
  };

  /* ---------- Full: RightPanel 完整面板 ---------- */
  if (mode === 'full') {
    const groupedOptions = groups.map(g => ({
      label: (
        <span style={{ fontSize: 10, color: 'var(--muted-2)', fontWeight: 600 }}>
          {g.label} ({g.models.length})
        </span>
      ),
      title: g.label,
      options: g.models.map(m => {
        const metrics = formatMetrics(m.id);
        return {
          value: m.id,
          label: (
            <Space size={4}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: m.color }} />
              <span style={{ fontWeight: activeModelId === m.id ? 600 : 400 }}>{m.label}</span>
              {isFreeModel(m) && <Tag style={{ fontSize: 9, lineHeight: '14px', padding: '0 3px', marginRight: 0 }} color="green">免费</Tag>}
              {m.freeQuotaNote && !isFreeModel(m) && <Tag style={{ fontSize: 9, lineHeight: '14px', padding: '0 3px', marginRight: 0 }} color="blue">{m.freeQuotaNote}</Tag>}
              {m.isDefault && <Badge count="默认" size="small" style={{ backgroundColor: '#4F46E5', fontSize: 9 }} />}
              {/* Phase 3: 显示平均性能指标 */}
              {metrics && (
                <span style={{ fontSize: 9, color: 'var(--muted-2)', marginLeft: 4 }}>
                  ⏱️ {metrics.avgLatency} · 💰 {metrics.avgCost} · ✅ {metrics.successRate}
                </span>
              )}
            </Space>
          ),
        };
      }),
    }));

    return (
      <Space direction="vertical" style={{ width: '100%' }} size={6}>
        <div style={{ color: 'var(--muted-2)', fontSize: 12 }}>
          <ApiOutlined style={{ marginRight: 4 }} />
          模型选择
        </div>
        <Select
          value={activeModelId}
          onChange={handleSelect}
          style={{ width: '100%' }}
          size="small"
          optionLabelProp="label"
          popupMatchSelectWidth={false}
          getPopupContainer={() => document.body}
          options={groupedOptions}
        />
        {/* 模型标签列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {groups.map(g => (
            <GroupTags key={g.key} group={g} activeModelId={activeModelId} onSelect={handleSelect} />
          ))}
        </div>
        {activeModel && (
          <div style={{ fontSize: 10, color: 'var(--muted-2)', lineHeight: 1.4 }}>
            <RobotOutlined style={{ marginRight: 4 }} />
            当前: <b style={{ color: activeModel.color }}>{activeModel.label}</b>
            <span style={{ margin: '0 4px' }}>·</span>
            {channelName(activeModel.baseURL)}
            <span style={{ margin: '0 4px' }}>·</span>
            {((activeModel.contextWindow || 0) / 1000).toFixed(0)}K 上下文
          </div>
        )}
      </Space>
    );
  }

  /* ---------- Compact & Minimal: 二级展开 Dropdown ---------- */
  const menuItems: MenuProps['items'] = groups.map(g => {
    if (g.isFactory && g.models.length > 1) {
      // 工厂组: 子菜单展开
      const children: NonNullable<MenuProps['items']>[number][] = [];
      // NVIDIA Auto 选项已移除
      g.models.forEach(m => {
        children.push({
          key: m.id,
          label: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 180 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
              <span style={{ fontWeight: activeModelId === m.id ? 600 : 400 }}>{m.label}</span>
              {activeModelId === m.id && <CheckCircleFilled style={{ color: m.color, fontSize: 10, marginLeft: 'auto' }} />}
            </div>
          ),
        });
      });
      return {
        key: `group-${g.key}`,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 160 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 500 }}>{g.label}</span>
            <Tag style={{ fontSize: 9, lineHeight: '14px', padding: '0 3px', marginLeft: 'auto' }} color="blue">{g.models.length}</Tag>
          </div>
        ),
        type: 'submenu' as const,
        children,
      };
    }
    // 独立模型: 直接显示
    return {
      key: `group-${g.key}`,
      label: (
        <span style={{ fontSize: 10, color: 'var(--muted-2)', fontWeight: 600 }}>
          {g.label}
        </span>
      ),
      type: 'group' as const,
      children: g.models.map(m => ({
        key: m.id,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 180 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
            <span style={{ fontWeight: activeModelId === m.id ? 600 : 400 }}>{m.label}</span>
            <Tag style={{ fontSize: 9, lineHeight: '14px', padding: '0 3px', marginLeft: 'auto' }}
              color={isFreeModel(m) ? 'green' : 'gold'}>
              {isFreeModel(m) ? '免费' : '付费'}
            </Tag>
            {activeModelId === m.id && <CheckCircleFilled style={{ color: m.color, fontSize: 10 }} />}
          </div>
        ),
      })),
    };
  });

  const triggerSize = mode === 'minimal' ? { fontSize: 11, padding: '3px 8px', maxWidth: 120 } : { fontSize: 10, padding: '2px 6px', maxWidth: 100 };

  return (
    <Dropdown
      trigger={['click']}
      getPopupContainer={() => document.body}
      menu={{
        items: menuItems,
        onClick: ({ key }) => handleSelect(key),
        style: { minWidth: 220, maxHeight: 450, overflowY: 'auto' },
      }}
    >
      <Tooltip title={activeModel ? `${activeModel.label} · ${channelName(activeModel.baseURL)} · ${((activeModel.contextWindow || 0) / 1000).toFixed(0)}K` : '选择模型'}>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: triggerSize.padding, borderRadius: mode === 'minimal' ? 6 : 4, cursor: 'pointer',
            background: mode === 'minimal' ? 'var(--card)' : 'var(--panel)',
            border: '1px solid var(--border)',
            fontSize: triggerSize.fontSize, color: 'var(--muted-2)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
        >
          <span style={{
            width: mode === 'minimal' ? 8 : 6, height: mode === 'minimal' ? 8 : 6, borderRadius: '50%',
            background: activeModel?.color || '#888', flexShrink: 0,
          }} />
          <span style={{ maxWidth: triggerSize.maxWidth, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeModel ? activeModel.label : '模型'}
          </span>
          <DownOutlined style={{ fontSize: mode === 'minimal' ? 9 : 8 }} />
        </span>
      </Tooltip>
    </Dropdown>
  );
};

/* ===== 分组标签 (full 模式用) ===== */
const GroupTags: React.FC<{
  group: { key: string; label: string; color: string; models: ModelConfig[]; isFactory: boolean };
  activeModelId: string;
  onSelect: (id: string) => void;
}> = ({ group, activeModelId, onSelect }) => {
  const { toggleModel } = useModelStore();
  const [expanded, setExpanded] = useState(group.models.some(m => m.id === activeModelId));

  if (group.isFactory && group.models.length > 1) {
    return (
      <div key={group.key}>
        <div
          style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 2, fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '▼' : '▶'} {group.label} ({group.models.length})
        </div>
        {expanded && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4, paddingLeft: 12 }}>
            {/* NVIDIA Auto 选项已移除 */}
            {group.models.map(m => {
              const isActive = m.id === activeModelId;
              const checked = m.enabled;
              return (
                <Tooltip key={m.id} title={`${m.label}\n${m.baseURL}\n上下文: ${((m.contextWindow || 0) / 1000).toFixed(0)}K${m.freeQuotaNote ? `\n${m.freeQuotaNote}` : ''}`}>
                  <span
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 2,
                      padding: '2px 4px', borderRadius: 4,
                      background: isActive ? 'var(--accent-bg, rgba(79,70,229,0.1))' : 'transparent',
                      cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
                    }}
                    onClick={() => onSelect(m.id)}
                  >
                    {/* 独立勾选框: 工厂组中每个模型可独立启用/禁用 */}
<Checkbox
checked={checked}
style={{ fontSize: 9 }}
onChange={(e) => {
                        e.stopPropagation();
                        toggleModel(m.id, e.target.checked);
                      }}
                    />
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%', background: m.color,
                      flexShrink: 0, margin: '0 2px',
                    }} />
                    <span style={{ fontWeight: isActive ? 600 : 400, opacity: checked ? 1 : 0.5 }}>
                      {m.label}
                    </span>
                    {isActive && <CheckCircleFilled style={{ color: m.color, fontSize: 10, marginLeft: 2 }} />}
                  </span>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // 非工厂组: 直接显示标签
  return (
    <div key={group.key}>
      <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 2, fontWeight: 600 }}>
        {group.label}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
        {group.models.map(m => {
          const isActive = m.id === activeModelId;
          const free = isFreeModel(m);
          const checked = m.enabled;
          return (
            <Tooltip key={m.id} title={`${m.label}\n${m.baseURL}\n上下文: ${((m.contextWindow || 0) / 1000).toFixed(0)}K${m.freeQuotaNote ? `\n${m.freeQuotaNote}` : ''}`}>
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 2,
                  padding: '2px 4px', borderRadius: 4,
                  background: isActive ? 'var(--accent-bg, rgba(79,70,229,0.1))' : 'transparent',
                  cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
                }}
                onClick={() => onSelect(m.id)}
              >
                {/* 独立勾选框 */}
<Checkbox
checked={checked}
style={{ fontSize: 9 }}
onChange={(e) => {
                    e.stopPropagation();
                    toggleModel(m.id, e.target.checked);
                  }}
                />
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: m.color,
                  flexShrink: 0, margin: '0 2px',
                }} />
                <span style={{ fontWeight: isActive ? 600 : 400, opacity: checked ? 1 : 0.5 }}>
                  {m.label}
                </span>
                {isActive && <CheckCircleFilled style={{ color: m.color, fontSize: 10, marginLeft: 2 }} />}
                {free && <Tag style={{ fontSize: 9, lineHeight: '14px', padding: '0 3px', marginLeft: 2 }} color="green">免费</Tag>}
                {!free && m.freeQuotaNote && <Tag style={{ fontSize: 9, lineHeight: '14px', padding: '0 3px', marginLeft: 2 }} color="blue">{m.freeQuotaNote}</Tag>}
              </span>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
};
