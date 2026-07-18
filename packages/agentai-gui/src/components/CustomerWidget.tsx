/**
 * CustomerWidget — 右侧面板客户跟进折叠小块
 * ==================================================================
 * 折叠时: 只显示标题 + 待跟进数量徽章
 * 展开时: 显示今日待跟进列表 (含AI建议话术) + 客户搜索
 *
 * 设计理念: AI 驱动, 用户只看提醒, 不占导航位
 * 录入方式: 客户通过 QQ/微信发消息时自动录入, 无需手动添加
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Badge, Input, Empty, Tag, Tooltip, Collapse, Spin, message } from 'antd';
import {
  TeamOutlined, ClockCircleOutlined, SearchOutlined,
  QqOutlined, WechatOutlined, PhoneOutlined,
  CheckOutlined, CloseOutlined, MessageOutlined,
} from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

interface ChannelIdentity {
  type: 'qq' | 'wechat' | 'web' | 'phone';
  id: string;
  label?: string;
}

interface Customer {
  customerId: string;
  name: string;
  phone?: string;
  channels: ChannelIdentity[];
  tags: string[];
  industry?: string;
  notes?: string;
  intent?: 'high' | 'medium' | 'low' | 'none';
  nextFollowUpAt?: number;
  lastContactAt?: number;
  contactCount: number;
  createdAt: number;
  updatedAt: number;
  /** AI 生成的跟进建议话术 (来自 scheduler) */
  suggestedMessage?: string;
  /** 跟进理由 */
  reason?: string;
}

const INTENT_COLOR: Record<string, string> = {
  high: 'red', medium: 'orange', low: 'blue', none: 'default',
};

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  qq: <QqOutlined />, wechat: <WechatOutlined />, phone: <PhoneOutlined />,
};

function timeAgo(ts: number): string {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

export const CustomerWidget: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [searched, setSearched] = useState<Customer[]>([]);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  // 使用 GATEWAY_HTTP 走 Vite proxy (dev) 或直连 (Tauri), 避免 CORS
  const apiBase = GATEWAY_HTTP;

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${apiBase}/v1/customers/pending`);
      if (resp.ok) {
        const data = await resp.json();
        setCustomers(data.customers || []);
      }
    } catch { /* best effort */ }
    finally { setLoading(false); }
  }, [apiBase]);

  useEffect(() => {
    loadPending();
    const id = setInterval(loadPending, 60000); // 每分钟刷新
    return () => clearInterval(id);
  }, [loadPending]);

  const handleSearch = async (value: string) => {
    if (!value.trim()) { setSearched([]); return; }
    try {
      const resp = await fetch(`${apiBase}/v1/customers?search=${encodeURIComponent(value)}&limit=5`);
      if (resp.ok) {
        const data = await resp.json();
        setSearched(data.customers || []);
      }
    } catch { /* best effort */ }
  };

  const handleAction = async (customerId: string, action: 'done' | 'skip') => {
    try {
      await fetch(`${apiBase}/v1/customers/follow-up/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      });
      message.success(action === 'done' ? '已标记完成' : '已跳过');
      loadPending();
    } catch {
      message.error('操作失败');
    }
  };

  const pending = customers.filter(c => c.nextFollowUpAt && c.nextFollowUpAt <= Date.now());

  return (
    <Card
      size="small"
      style={{ borderRadius: 'var(--radius-md)', background: 'var(--card)', border: '1px solid var(--border)' }}
      styles={{ body: { padding: '8px 12px' } }}
    >
      <Collapse
        ghost
        size="small"
        items={[{
          key: 'customer',
          label: (
            <span style={{ fontSize: 12, color: 'var(--fg-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <TeamOutlined style={{ color: 'var(--accent)' }} />
              客户跟进
              {pending.length > 0 && (
                <Badge
                  count={pending.length}
                  size="small"
                  style={{ backgroundColor: 'var(--danger)' }}
                />
              )}
            </span>
          ),
          children: (
            <Spin spinning={loading}>
              {/* 待跟进提醒 */}
              {pending.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 4 }}>
                    <ClockCircleOutlined style={{ marginRight: 4 }} />
                    待跟进 ({pending.length}) · 点击展开话术
                  </div>
                  {pending.slice(0, 8).map(c => (
                    <div key={c.customerId} style={{ marginBottom: 4 }}>
                      <Tooltip
                        title={
                          <div style={{ fontSize: 11 }}>
                            <div>意向: {c.intent || '未知'}</div>
                            <div>上次联系: {timeAgo(c.lastContactAt || 0)}</div>
                            <div>沟通次数: {c.contactCount}</div>
                            {c.notes && <div>备注: {c.notes}</div>}
                            {c.reason && <div style={{ marginTop: 4, color: 'var(--accent)' }}>{c.reason}</div>}
                          </div>
                        }
                        placement="left"
                      >
                        <div
                          onClick={() => setExpandedCustomer(expandedCustomer === c.customerId ? null : c.customerId)}
                          style={{
                            padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                            background: expandedCustomer === c.customerId ? 'var(--accent-bg)' : 'var(--bg-2)',
                            fontSize: 11, color: 'var(--fg)',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                            transition: 'background 0.15s',
                          }}
                        >
                          <span style={{ flex: 1, fontWeight: 500 }}>{c.name}</span>
                          {c.channels.map((ch, i) => (
                            <span key={i} style={{ color: 'var(--muted-2)' }}>{CHANNEL_ICON[ch.type]}</span>
                          ))}
                          {c.intent && c.intent !== 'none' && (
                            <Tag color={INTENT_COLOR[c.intent]} style={{ fontSize: 9, margin: 0, lineHeight: '16px', padding: '0 4px' }}>
                              {c.intent === 'high' ? '高' : c.intent === 'medium' ? '中' : '低'}
                            </Tag>
                          )}
                        </div>
                      </Tooltip>

                      {/* 展开的 AI 建议话术 + 操作按钮 */}
                      {expandedCustomer === c.customerId && (
                        <div style={{
                          padding: '6px 8px', marginTop: 2, marginBottom: 4,
                          background: 'var(--panel)', borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border)',
                        }}>
                          {c.suggestedMessage ? (
                            <div style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 6, lineHeight: 1.5 }}>
                              <MessageOutlined style={{ marginRight: 4, color: 'var(--accent)' }} />
                              {c.suggestedMessage}
                            </div>
                          ) : (
                            <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 6, fontStyle: 'italic' }}>
                              AI 建议话术生成中... 客户主动联系时将自动跟进
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => handleAction(c.customerId, 'done')}
                              style={{
                                flex: 1, fontSize: 10, padding: '2px 6px',
                                border: '1px solid var(--success)', borderRadius: 'var(--radius-sm)',
                                background: 'transparent', color: 'var(--success)', cursor: 'pointer',
                              }}
                            >
                              <CheckOutlined /> 已跟进
                            </button>
                            <button
                              onClick={() => handleAction(c.customerId, 'skip')}
                              style={{
                                flex: 1, fontSize: 10, padding: '2px 6px',
                                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                                background: 'transparent', color: 'var(--muted-2)', cursor: 'pointer',
                              }}
                            >
                              <CloseOutlined /> 跳过
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 搜索框 */}
              <Input
                size="small"
                placeholder="搜索客户..."
                prefix={<SearchOutlined style={{ color: 'var(--muted-2)', fontSize: 11 }} />}
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  handleSearch(e.target.value);
                }}
                style={{ marginBottom: 6, fontSize: 11 }}
                allowClear
              />

              {/* 搜索结果 */}
              {searched.length > 0 && (
                <div>
                  {searched.map(c => (
                    <Tooltip
                      key={c.customerId}
                      title={
                        <div style={{ fontSize: 11 }}>
                          <div>ID: {c.customerId}</div>
                          <div>意向: {c.intent || '未知'}</div>
                          <div>上次联系: {timeAgo(c.lastContactAt || 0)}</div>
                          {c.phone && <div>电话: {c.phone}</div>}
                          {c.tags.length > 0 && <div>标签: {c.tags.join(', ')}</div>}
                        </div>
                      }
                      placement="left"
                    >
                      <div style={{
                        padding: '4px 8px', marginBottom: 3, borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-2)', fontSize: 11, color: 'var(--fg-2)',
                        cursor: 'default', display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        <span style={{ flex: 1 }}>{c.name}</span>
                        {c.channels.map((ch, i) => (
                          <span key={i} style={{ color: 'var(--muted-2)' }}>{CHANNEL_ICON[ch.type]}</span>
                        ))}
                      </div>
                    </Tooltip>
                  ))}
                </div>
              )}

              {/* 空状态 */}
              {pending.length === 0 && !search && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>
                      暂无待跟进 · 客户发消息时自动录入
                    </span>
                  }
                  style={{ margin: '4px 0' }}
                />
              )}
            </Spin>
          ),
        }]}
      />
    </Card>
  );
};
