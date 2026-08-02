/**
 * AutoMemoryPanel — AI 主动记忆可视化面板
 * ============================================
 * 显示 AI 自动捕获的记忆条目 (5 类分类 + 重要性 + 来源)
 *
 * 数据源: GET /api/memory/auto-captured
 * 触发场景: 右侧面板 / 设置页 / 单独弹窗
 *
 * 2026-08-03 新增
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Tag, Tooltip, Empty, Spin, Segmented, Badge } from 'antd';
import {
  BugOutlined,
  BulbOutlined,
  AppstoreOutlined,
  UserOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

type MemoryCategory = 'bug_fix' | 'decision' | 'pattern' | 'user_preference' | 'project_fact';

interface AutoMemoryItem {
  ts: number;
  category: MemoryCategory;
  title: string;
  content: string;
  importance: number; // 0-1
  entityId?: string;
  tags: string[];
  sourceTool?: string;
  industry?: string;
}

interface AutoMemoryResponse {
  items: AutoMemoryItem[];
  total: number;
  stats: Record<string, number>;
  error?: string;
}

// ═══════════════════════════════════════════════════════════
// 分类配置
// ═══════════════════════════════════════════════════════════

const CATEGORY_CONFIG: Record<MemoryCategory, {
  label: string;
  icon: React.ReactNode;
  color: string;
}> = {
  bug_fix: {
    label: 'Bug 修复',
    icon: <BugOutlined />,
    color: 'var(--danger)',
  },
  decision: {
    label: '关键决策',
    icon: <BulbOutlined />,
    color: 'var(--warning)',
  },
  pattern: {
    label: '代码模式',
    icon: <AppstoreOutlined />,
    color: 'var(--accent)',
  },
  user_preference: {
    label: '用户偏好',
    icon: <UserOutlined />,
    color: 'var(--violet)',
  },
  project_fact: {
    label: '项目事实',
    icon: <DatabaseOutlined />,
    color: 'var(--success)',
  },
};

const FILTER_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: 'Bug', value: 'bug_fix' },
  { label: '决策', value: 'decision' },
  { label: '模式', value: 'pattern' },
  { label: '偏好', value: 'user_preference' },
  { label: '事实', value: 'project_fact' },
];

// ═══════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════

export const AutoMemoryPanel: React.FC<{ workspace?: string }> = ({ workspace }) => {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AutoMemoryItem[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>('all');

  // 自动从 localStorage 获取 workspace (与 gitService.ts 一致)
  const resolvedWorkspace = workspace ||
    localStorage.getItem('agentai.workspace') ||
    localStorage.getItem('currentWorkspace') ||
    (window as any).__AGENTAI_WORKSPACE__ ||
    '';

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (resolvedWorkspace) params.set('workspace', resolvedWorkspace);
      params.set('limit', '50');
      if (filter !== 'all') params.set('category', filter);

      const resp = await fetch(`/api/memory/auto-captured?${params}`);
      const data: AutoMemoryResponse = await resp.json();
      if (data.error) {
        setItems([]);
        setStats({});
      } else {
        setItems(data.items || []);
        setStats(data.stats || {});
      }
    } catch {
      setItems([]);
      setStats({});
    } finally {
      setLoading(false);
    }
  }, [resolvedWorkspace, filter]);

  useEffect(() => {
    fetchMemories();
    // 每 30 秒刷新一次
    const timer = setInterval(fetchMemories, 30_000);
    return () => clearInterval(timer);
  }, [fetchMemories]);

  // 格式化时间
  const fmtTime = (ts: number): string => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return new Date(ts).toLocaleDateString('zh-CN');
  };

  // 重要性星级 (0-1 → 1-5)
  const importanceStars = (imp: number): string => {
    const stars = Math.round(imp * 5);
    return '★'.repeat(stars) + '☆'.repeat(5 - stars);
  };

  const totalCount = Object.values(stats).reduce((a, b) => a + b, 0);

  return (
    <div style={{ padding: 12 }}>
      {/* 头部: 标题 + 刷新 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>
            AI 主动记忆
          </span>
          <Badge
            count={totalCount}
            style={{ backgroundColor: 'var(--accent)' }}
            overflowCount={999}
          />
        </div>
        <Tooltip title="刷新">
          <ReloadOutlined
            onClick={fetchMemories}
            style={{ cursor: 'pointer', color: 'var(--muted-2)' }}
            spin={loading}
          />
        </Tooltip>
      </div>

      {/* 分类过滤 */}
      <Segmented
        size="small"
        value={filter}
        onChange={setFilter}
        options={FILTER_OPTIONS}
        style={{ marginBottom: 12, width: '100%' }}
      />

      {/* 分类统计 */}
      {totalCount > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 12,
          fontSize: 10,
          color: 'var(--muted-2)',
        }}>
          {(Object.keys(CATEGORY_CONFIG) as MemoryCategory[]).map(cat => {
            const count = stats[cat] || 0;
            if (count === 0) return null;
            const cfg = CATEGORY_CONFIG[cat];
            return (
              <Tag
                key={cat}
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  border: `1px solid ${cfg.color}`,
                  color: cfg.color,
                  background: 'transparent',
                }}
              >
                {cfg.icon} {cfg.label}: {count}
              </Tag>
            );
          })}
        </div>
      )}

      {/* 记忆列表 */}
      <Spin spinning={loading}>
        {items.length === 0 && !loading ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ color: 'var(--muted-2)', fontSize: 11 }}>
                暂无 AI 主动记忆
                <br />
                <span style={{ fontSize: 10 }}>
                  AI 在长任务中会自动捕获关键发现/决策/教训
                </span>
              </span>
            }
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item, idx) => {
              const cfg = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.project_fact;
              return (
                <div
                  key={`${item.entityId}-${idx}`}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: 8,
                    background: 'var(--card)',
                    borderLeft: `3px solid ${cfg.color}`,
                  }}
                >
                  {/* 标题行 */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 4,
                  }}>
                    <span style={{ color: cfg.color, fontSize: 12 }}>{cfg.icon}</span>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--fg)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.title}
                    </span>
                    <Tooltip title={`重要性: ${Math.round(item.importance * 5)}/5`}>
                      <span style={{ fontSize: 10, color: 'var(--warning)' }}>
                        {importanceStars(item.importance)}
                      </span>
                    </Tooltip>
                  </div>

                  {/* 内容 */}
                  <div style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    marginBottom: 4,
                    lineHeight: 1.5,
                    maxHeight: 60,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                  }}>
                    {item.content}
                  </div>

                  {/* 元数据 */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 10,
                    color: 'var(--muted-2)',
                  }}>
                    <Tooltip title={new Date(item.ts).toLocaleString('zh-CN')}>
                      <span>
                        <ClockCircleOutlined /> {fmtTime(item.ts)}
                      </span>
                    </Tooltip>
                    {item.sourceTool && (
                      <span>来源: {item.sourceTool}</span>
                    )}
                    {item.tags.length > 0 && (
                      <span>#{item.tags.slice(0, 2).join(' #')}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Spin>
    </div>
  );
};
