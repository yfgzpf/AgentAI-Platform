/**
 * ModelSelector — 统一的模型选择器 (二级展开)
 * -------------------------------------------------
 * 三种模式:
 *   1. "full"    — RightPanel 完整面板 (分组 + 可折叠子模型列表)
 *   2. "compact" — Composer 工具栏 (Dropdown 子菜单展开)
 *   3. "minimal" — TitleBar 极简 (Dropdown 子菜单展开)
 *
 * 过滤逻辑 (统一实现见 utils/modelPicker.ts, 与 Composer 内联选择器共用):
 *   - 免费模型 (Agnes 全系/zhipu): 始终显示
 *   - 中转站模型 (ALRO/SuperAPI/SenseNova/LongCat): 配好密钥才显示, 按分组密钥二级展开
 *   - 官方直连模型: 密钥已配置 或 已启用 则显示
 *   - 隐藏条目 (agnes-2.0 / agnes 兼容 id): 不进入选择器, 但仍保留在 store 里
 *   - 每个模型标注来源: 官方直连 = 灰色「官方」, 中转站 = 站点彩色徽章
 *
 * 二级展开:
 *   中转站分组显示为可展开的子菜单, 不铺平; 单模型不再套同名分组头 (曾造成"名字出现两次")
 */
import React, { useState } from 'react';
import { Select, Space, Tag, Tooltip, Badge, Dropdown, Checkbox, Modal, Button } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined, CheckCircleFilled, ThunderboltOutlined, CrownOutlined, RobotOutlined,
  LockOutlined, DownOutlined,
} from '@ant-design/icons';
import { useModelStore, type ModelConfig } from '../store/modelStore';
import { useSimpleSubscriptionStore, SUBSCRIPTION_PLANS } from '../store/subscriptionStore';
import { useModelMetrics } from '../hooks/useModelMetrics'; // Phase 3: 模型性能指标
import { ModelSourceTag } from './ModelSourceTag';
// 来源判定 / 免费判定 / 可见性 / 分组 —— 与 Composer 内联选择器共用单一实现
import {
  channelName, isFreeModel, isModelVisible, groupModels,
  hasFrontendKey, type ModelGroup,
} from '../utils/modelPicker';

/* ===== Props ===== */
type DisplayMode = 'full' | 'compact' | 'minimal';

interface Props {
  mode?: DisplayMode;
  onSelect?: () => void;
  compact?: boolean;
}

/* ===== 组件 ===== */
export const ModelSelector: React.FC<Props> = ({ mode = 'full', onSelect }) => {
  const { models, activeModelId, setActive, commercialKeys, chatMode, backendProviders } = useModelStore();
  const { planId, expiresAt, isPaid } = useSimpleSubscriptionStore();
  const activeModel = models.find(m => m.id === activeModelId) || models[0];

  // 订阅/解锁弹窗
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  
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

  // ===== 过滤: 免费 / 有密钥 / 已启用; 中转模型必须先配密钥 =====
  const hasBackendKey = (provider?: string) =>
    !!provider && backendProviders.some(p => p.name === provider && p.hasKey);
  const visibleModels = models.filter(m => isModelVisible(m, { commercialKeys, hasBackendKey }));

  // 对话改图模式: 仅显示 chat(多模态) + image 类型模型
  const imageCapableModels = visibleModels.filter(m =>
    m.modelType === 'image' ||
    (m.modelType === 'chat' && ['zhipu', 'doubao-chat', 'qwen-chat', 'longcat-2.0'].includes(m.id))
  );

  // chatMode 感知: 图片模式用 imageCapableModels, 否则用 visibleModels
  const activeModels = chatMode === 'image_edit' ? imageCapableModels : visibleModels;

  // ===== 分组: 中转站按分组密钥聚合, 独立模型各自一组 =====
  const groups: ModelGroup[] = groupModels(activeModels);

  const handleSelect = (id: string) => {
    // 检查模型是否锁定（需要密钥解锁）
    const model = models.find(m => m.id === id);
    if (model?.locked || (!isFreeModel(model!) && !hasFrontendKey(model!, commercialKeys))) {
      setPendingModelId(id);
      setShowUnlockModal(true);
      return;
    }
    setActive(id);
    onSelect?.();
  };

  /* ---------- Full: RightPanel 完整面板 ---------- */
  if (mode === 'full') {
    const renderFullLabel = (m: ModelConfig) => {
      const metrics = formatMetrics(m.id);
      return (
        <Space size={4}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: m.color }} />
          <span style={{ fontWeight: activeModelId === m.id ? 600 : 400 }}>{m.label}</span>
          <ModelSourceTag model={m} />
          {isFreeModel(m) && <Tag style={{ fontSize: 'var(--fs-micro)', lineHeight: '14px', padding: '0 3px', marginRight: 0 }} color="green">免费</Tag>}
          {m.freeQuotaNote && !isFreeModel(m) && <Tag style={{ fontSize: 'var(--fs-micro)', lineHeight: '14px', padding: '0 3px', marginRight: 0 }} color="blue">{m.freeQuotaNote}</Tag>}
          {m.isDefault && <Badge count="默认" size="small" style={{ backgroundColor: '#4F46E5', fontSize: 'var(--fs-micro)' }} />}
          {/* Phase 3: 显示平均性能指标 */}
          {metrics && (
            <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginLeft: 4 }}>
              ⏱️ {metrics.avgLatency} · 💰 {metrics.avgCost} · ✅ {metrics.successRate}
            </span>
          )}
        </Space>
      );
    };
    // 单模型不套分组头 —— 否则组名与唯一一项的标签完全重复 (历史上 deepseek/agnes 看起来"出现两次")
    // 混用分组项与独立项, antd Select 支持 options 里两者并存
    const groupedOptions: any[] = groups.flatMap((g): any[] =>
      g.models.length > 1
        ? [{
            label: (
              <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', fontWeight: 600 }}>
                {g.label} ({g.models.length})
              </span>
            ),
            title: g.label,
            options: g.models.map(m => ({ value: m.id, label: renderFullLabel(m) })),
          }]
        : g.models.map(m => ({ value: m.id, label: renderFullLabel(m) }))
    );

    return (
      <Space direction="vertical" style={{ width: '100%' }} size={6}>
        <div style={{ color: 'var(--muted-2)', fontSize: 'var(--fs-sm)' }}>
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
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', lineHeight: 1.4 }}>
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
  const renderMenuModel = (m: ModelConfig) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 180 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
      <span style={{ fontWeight: activeModelId === m.id ? 600 : 400 }}>{m.label}</span>
      <ModelSourceTag model={m} dense />
      <Tag style={{ fontSize: 'var(--fs-micro)', lineHeight: '14px', padding: '0 3px', marginLeft: 'auto' }}
        color={isFreeModel(m) ? 'green' : 'gold'}>
        {isFreeModel(m) ? '免费' : '付费'}
      </Tag>
      {activeModelId === m.id && <CheckCircleFilled style={{ color: m.color, fontSize: 'var(--fs-micro)' }} />}
    </div>
  );

  const menuItems: MenuProps['items'] = [];
  for (const g of groups) {
    if (g.models.length === 1) {
      // 单模型: 直接成项 —— 不再套一层同名分组头
      menuItems.push({ key: g.models[0]!.id, label: renderMenuModel(g.models[0]!) });
      continue;
    }
    if (g.isRelayGroup) {
      // 中转站分组: 按密钥分组二级展开
      menuItems.push({
        key: `group-${g.key}`,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 160 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 500 }}>{g.label}</span>
            <Tag style={{ fontSize: 'var(--fs-micro)', lineHeight: '14px', padding: '0 3px', marginLeft: 'auto' }} color="blue">{g.models.length}</Tag>
          </div>
        ),
        type: 'submenu' as const,
        children: g.models.map(m => ({ key: m.id, label: renderMenuModel(m) })),
      });
      continue;
    }
    menuItems.push({
      key: `group-${g.key}`,
      label: (
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', fontWeight: 600 }}>
          {g.label}
        </span>
      ),
      type: 'group' as const,
      children: g.models.map(m => ({ key: m.id, label: renderMenuModel(m) })),
    });
  }

  const triggerSize = mode === 'minimal' ? { fontSize: 'var(--fs-micro)', padding: '3px 8px', maxWidth: 120 } : { fontSize: 'var(--fs-micro)', padding: '2px 6px', maxWidth: 100 };

  // 模型解锁弹窗 - 提示联系微信获取密钥
  const renderUnlockModal = () => {
    if (!showUnlockModal || !pendingModelId) return null;
    const model = models.find(m => m.id === pendingModelId);
    return (
      <Modal
        open={showUnlockModal}
        title={
          <Space>
            <LockOutlined style={{ color: 'var(--warning)' }} />
            模型已锁定
          </Space>
        }
        onCancel={() => { setShowUnlockModal(false); setPendingModelId(null); }}
        footer={[
          <Button key="close" onClick={() => { setShowUnlockModal(false); setPendingModelId(null); }}>稍后再说</Button>,
          <Button
            key="unlock"
            type="primary"
            icon={<CrownOutlined />}
            onClick={() => {
              setShowUnlockModal(false);
              setPendingModelId(null);
              window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'settings' as any } }));
            }}
          >
            前往解锁
          </Button>,
        ]}
        width={400}
      >
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--fg)', lineHeight: 1.8 }}>
          <div>
            模型 <b>{model?.label}</b> 需要密钥才能使用。
          </div>
          <div style={{ marginTop: 12, padding: '12px', background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--accent)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>🔑 如何获取密钥？</div>
            <div>添加作者微信 <b style={{ color: 'var(--accent)' }}>agentai-platform</b></div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted-2)', marginTop: 4 }}>获取密钥后在设置页填入即可解锁全部模型</div>
          </div>
        </div>
      </Modal>
    );
  };

  return (
    <>
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
            padding: triggerSize.padding, borderRadius: mode === 'minimal' ? 'var(--radius-md)' : 'var(--radius-sm)', cursor: 'pointer',
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
    {renderUnlockModal()}
    </>
  );
}

/* ===== 分组标签 (full 模式用) ===== */
const GroupTags: React.FC<{
  group: ModelGroup;
  activeModelId: string;
  onSelect: (id: string) => void;
}> = ({ group, activeModelId, onSelect }) => {
  const { toggleModel } = useModelStore();
  const [expanded, setExpanded] = useState(group.models.some(m => m.id === activeModelId));

  if (group.isRelayGroup && group.models.length > 1) {
    return (
      <div key={group.key}>
        <div
          style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginBottom: 2, fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
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
                      padding: '2px 4px', borderRadius: 'var(--radius-sm)',
                      background: isActive ? 'var(--accent-bg)' : 'transparent',
                      cursor: 'pointer', fontSize: 'var(--fs-micro)', whiteSpace: 'nowrap',
                    }}
                    onClick={() => onSelect(m.id)}
                  >
                    {/* 独立勾选框: 中转组中每个模型可独立启用/禁用 */}
<Checkbox
checked={checked}
style={{ fontSize: 'var(--fs-micro)' }}
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
                    {isActive && <CheckCircleFilled style={{ color: m.color, fontSize: 'var(--fs-micro)', marginLeft: 2 }} />}
                  </span>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // 独立模型: 单模型时不渲染组名 —— 组名会与标签逐字重复
  const showHeader = group.models.length > 1;
  return (
    <div key={group.key}>
      {showHeader && (
        <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginBottom: 2, fontWeight: 600 }}>
          {group.label}
        </div>
      )}
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
                  padding: '2px 4px', borderRadius: 'var(--radius-sm)',
                  background: isActive ? 'var(--accent-bg)' : 'transparent',
                  cursor: 'pointer', fontSize: 'var(--fs-micro)', whiteSpace: 'nowrap',
                }}
                onClick={() => onSelect(m.id)}
              >
                {/* 独立勾选框 */}
<Checkbox
checked={checked}
style={{ fontSize: 'var(--fs-micro)' }}
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
                <ModelSourceTag model={m} />
                {isActive && <CheckCircleFilled style={{ color: m.color, fontSize: 'var(--fs-micro)', marginLeft: 2 }} />}
                {free && <Tag style={{ fontSize: 'var(--fs-micro)', lineHeight: '14px', padding: '0 3px', marginLeft: 2 }} color="green">免费</Tag>}
                {!free && m.freeQuotaNote && <Tag style={{ fontSize: 'var(--fs-micro)', lineHeight: '14px', padding: '0 3px', marginLeft: 2 }} color="blue">{m.freeQuotaNote}</Tag>}
              </span>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
