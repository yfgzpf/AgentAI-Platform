/**
 * KnowledgeGraphPanel — 知识图谱/记忆可视化面板
 * ==============================================
 * 从统一 MemoryManager 读取项目记忆，以卡片+标签形式展示。
 * 支持搜索过滤、按 scope 分类、查看详情。
 */
import React, { useEffect, useState, useMemo } from 'react';
import { Card, Input, Tag, Space, Typography, Empty, Spin } from 'antd';
import { SearchOutlined, TagOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { gatewayFallback } from '../../services/GatewayFallback';

const { Text, Paragraph } = Typography;
const GATEWAY = () => gatewayFallback.url || 'http://127.0.0.1:18789';

interface MemoryFact {
  key: string;
  value: string;
  scope: string;
  createdAt: number;
  updatedAt: number;
}

const scopeColors: Record<string, string> = {
  session: 'blue',
  project: 'green',
  user: 'purple',
  global: 'orange',
};

const KnowledgeGraphPanel: React.FC = () => {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${GATEWAY()}/v1/memory/list`, { signal: AbortSignal.timeout(5000) })
      .then(r => r.json())
      .then(d => { if (d.ok && d.facts) setFacts(d.facts); })
      .catch(() => setFacts([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return facts
      .filter(f => !search || f.key.includes(search) || f.value.includes(search))
      .filter(f => !scopeFilter || f.scope === scopeFilter)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [facts, search, scopeFilter]);

  const scopes = useMemo(() => [...new Set(facts.map(f => f.scope))], [facts]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索记忆..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 200 }}
          size="small"
        />
        <Space>
          <Tag
            color={!scopeFilter ? 'blue' : 'default'}
            style={{ cursor: 'pointer' }}
            onClick={() => setScopeFilter(null)}
          >全部</Tag>
          {scopes.map(s => (
            <Tag
              key={s}
              color={scopeFilter === s ? scopeColors[s] || 'blue' : 'default'}
              style={{ cursor: 'pointer' }}
              onClick={() => setScopeFilter(scopeFilter === s ? null : s)}
            >{s}</Tag>
          ))}
        </Space>
      </div>

      {filtered.length === 0 ? (
        <Empty
          description={facts.length === 0 ? '暂无记忆数据。AI 会在对话中自动记录关键信息。' : '无匹配结果'}
          style={{ marginTop: 40 }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '70vh', overflow: 'auto' }}>
          {filtered.map(f => (
            <Card key={f.key} size="small" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <Space style={{ marginBottom: 4 }}>
                    <TagOutlined style={{ color: 'var(--accent)' }} />
                    <Text strong style={{ fontSize: 13 }}>{f.key}</Text>
                    <Tag color={scopeColors[f.scope] || 'default'}>{f.scope}</Tag>
                  </Space>
                  <Paragraph
                    style={{ color: 'var(--fg)', fontSize: 13, marginBottom: 4 }}
                    ellipsis={{ rows: 2 }}
                  >
                    {f.value}
                  </Paragraph>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', marginLeft: 16 }}>
                  <ClockCircleOutlined /> {new Date(f.updatedAt).toLocaleDateString()}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default KnowledgeGraphPanel;
