/**
 * EvolutionPanel — AI 进化历史面板
 * --------------------------------------------------
 * 展示 AI 跨会话学到了什么:
 *   1. 摘要统计 (成功率、偏好、主题)
 *   2. 进化记忆列表 (成功/失败/偏好/元指令)
 *   3. 自进化规则 (可删除)
 * 让用户看到"AI 越用越懂你"的证据
 */
import React, { useEffect, useState } from 'react';
import { Tag, Tooltip, Empty, Spin, message } from 'antd';
import { ExperimentOutlined, BulbOutlined, WarningOutlined, CheckCircleOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';

interface EvolutionEntry {
  ts: number;
  type: 'success' | 'failure' | 'preference' | 'tool_stats' | 'meta_instruction';
  content: string;
  taskType?: string;
  industry?: string;
  keywords?: string[];
}

interface EvolutionSummary {
  successRate: number;
  topPreferences: string[];
  recentTopics: string[];
  failureCount: number;
  totalEntries: number;
}

export const EvolutionPanel: React.FC = () => {
  const [summary, setSummary] = useState<EvolutionSummary | null>(null);
  const [entries, setEntries] = useState<EvolutionEntry[]>([]);
  const [rules, setRules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sumRes, listRes, rulesRes] = await Promise.all([
        fetch('/v1/evolution/summary').then(r => r.json()),
        fetch('/v1/evolution/list?limit=30').then(r => r.json()),
        fetch('/v1/evolution/rules').then(r => r.json()),
      ]);
      setSummary(sumRes);
      setEntries(listRes.entries || []);
      setRules(rulesRes.rules || []);
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const deleteRule = async (id: number) => {
    try {
      const res = await fetch(`/v1/evolution/rules/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        message.success('规则已删除');
        fetchData();
      }
    } catch {
      message.error('删除失败');
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 24 }}><Spin size="small" /></div>;
  }

  const typeMeta: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    success: { icon: <CheckCircleOutlined />, color: '#10B981', label: '成功经验' },
    failure: { icon: <WarningOutlined />, color: '#EF4444', label: '失败教训' },
    preference: { icon: <BulbOutlined />, color: '#F59E0B', label: '用户偏好' },
    meta_instruction: { icon: <ExperimentOutlined />, color: '#8B5CF6', label: '教练建议' },
    tool_stats: { icon: <ExperimentOutlined />, color: '#3B82F6', label: '工具统计' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 摘要卡片 */}
      {summary && summary.totalEntries > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
        }}>
          <div style={{ padding: 8, borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{summary.totalEntries}</div>
            <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>总记忆条数</div>
          </div>
          <div style={{ padding: 8, borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#10B981' }}>{(summary.successRate * 100).toFixed(0)}%</div>
            <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>成功率</div>
          </div>
          <div style={{ padding: 8, borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#F59E0B' }}>{summary.failureCount}</div>
            <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>失败次数</div>
          </div>
        </div>
      )}

      {/* 用户偏好 */}
      {summary && summary.topPreferences.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 4, fontWeight: 600 }}>AI 记住了你的偏好</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {summary.topPreferences.map((p, i) => (
              <Tag key={i} color="gold" style={{ fontSize: 10 }}>{p}</Tag>
            ))}
          </div>
        </div>
      )}

      {/* 自进化规则 */}
      {rules.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 4, fontWeight: 600 }}>
            AI 自我修改的行为规则 ({rules.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {rules.map((rule, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                padding: '4px 8px', borderRadius: 4,
                background: 'var(--panel)', border: '1px solid var(--border)',
                fontSize: 11, color: 'var(--fg-2)',
              }}>
                <ExperimentOutlined style={{ color: '#8B5CF6', marginTop: 2, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{rule}</span>
                <Tooltip title="删除此规则">
                  <DeleteOutlined
                    style={{ color: 'var(--muted-2)', cursor: 'pointer', flexShrink: 0, marginTop: 2 }}
                    onClick={() => deleteRule(i)}
                  />
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 进化记忆时间线 */}
      {entries.length > 0 ? (
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 4, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            进化记忆时间线
            <ReloadOutlined style={{ cursor: 'pointer' }} onClick={fetchData} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 300, overflowY: 'auto' }}>
            {entries.slice().reverse().map((e, i) => {
              const meta = typeMeta[e.type] || typeMeta.tool_stats;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                  padding: '4px 8px', borderRadius: 4,
                  background: 'var(--panel)', border: '1px solid var(--border)',
                  fontSize: 11,
                }}>
                  <span style={{ color: meta.color, marginTop: 1, flexShrink: 0 }}>{meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--fg-2)' }}>{e.content.slice(0, 100)}</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                      <Tag style={{ fontSize: 9, lineHeight: '14px', padding: '0 3px', marginRight: 0 }} color={meta.color}>{meta.label}</Tag>
                      {e.taskType && <Tag style={{ fontSize: 9, lineHeight: '14px', padding: '0 3px', marginRight: 0 }}>{e.taskType}</Tag>}
                      <span style={{ fontSize: 9, color: 'var(--muted-2)' }}>
                        {new Date(e.ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Empty description="AI 还没有进化记忆 — 多对话几次, AI 会自动学习你的偏好" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
};
