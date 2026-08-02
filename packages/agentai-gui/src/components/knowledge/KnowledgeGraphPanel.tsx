/**
 * KnowledgeGraphPanel — 知识图谱/记忆可视化面板
 * ==============================================
 * Tab 1 (记忆卡片): 从 MemoryManager 读取项目记忆
 * Tab 2 (图谱数据): 从 WorldModel 读取实体/关系/因果规则
 *   - 2026-08-03: 修复知识图谱名实不符, 接入真实图谱数据
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Card, Input, Tag, Space, Typography, Empty, Spin, Tabs, Statistic, Row, Col, Table, Badge } from 'antd';
import { SearchOutlined, TagOutlined, ClockCircleOutlined, NodeIndexOutlined, ThunderboltOutlined, ExperimentOutlined, DatabaseOutlined } from '@ant-design/icons';
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

interface GraphNode {
  id: string;
  label: string;
  type: string;
  category: string;
  size: number;
  confidence: number;
  properties?: Record<string, any>;
  createdAt: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  strength: number;
  confidence: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rules: any[];
  stats: {
    entityCount: number;
    relationCount: number;
    ruleCount: number;
    entityTypes: Record<string, number>;
    relationTypes: Record<string, number>;
  };
}

const scopeColors: Record<string, string> = {
  session: 'blue',
  project: 'green',
  user: 'purple',
  global: 'orange',
};

const entityColors: Record<string, string> = {
  module: 'blue',
  file: 'cyan',
  function: 'geekblue',
  concept: 'purple',
  bug: 'red',
  fix: 'green',
  pattern: 'gold',
  decision: 'magenta',
  tool: 'orange',
  model: 'lime',
};

const KnowledgeGraphPanel: React.FC = () => {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string | null>(null);

  // 图谱数据
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [], rules: [], stats: {} as any });
  const [graphLoading, setGraphLoading] = useState(false);
  const [entityFilter, setEntityFilter] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${GATEWAY()}/v1/memory/list`, { signal: AbortSignal.timeout(5000) })
      .then(r => r.json())
      .then(d => { if (d.ok && d.facts) setFacts(d.facts); })
      .catch(() => setFacts([]))
      .finally(() => setLoading(false));
  }, []);

  // 加载图谱数据
  const loadGraph = useCallback(() => {
    setGraphLoading(true);
    fetch(`${GATEWAY()}/v1/knowledge/graph?limit=200`, { signal: AbortSignal.timeout(5000) })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setGraphData(d.data);
        }
      })
      .catch(() => setGraphData({ nodes: [], edges: [], rules: [], stats: {} as any }))
      .finally(() => setGraphLoading(false));
  }, []);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const filtered = useMemo(() => {
    return facts
      .filter(f => !search || f.key.includes(search) || f.value.includes(search))
      .filter(f => !scopeFilter || f.scope === scopeFilter)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [facts, search, scopeFilter]);

  const scopes = useMemo(() => [...new Set(facts.map(f => f.scope))], [facts]);

  const entityTypes = useMemo(() => Object.keys(graphData.stats?.entityTypes || {}), [graphData.stats]);

  const filteredNodes = useMemo(() => {
    return graphData.nodes
      .filter(n => !search || n.label.includes(search) || n.id.includes(search))
      .filter(n => !entityFilter || n.type === entityFilter)
      .sort((a, b) => b.confidence - a.confidence);
  }, [graphData.nodes, search, entityFilter]);

  const filteredRules = useMemo(() => {
    return (graphData.rules || [])
      .filter(r => !search || (r.cause || '').includes(search) || (r.effect || '').includes(search))
      .slice(0, 50);
  }, [graphData.rules, search]);

  const stats = graphData.stats || {};

  if (loading && graphLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  const memoryTab = (
    <div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '60vh', overflow: 'auto' }}>
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

  const graphTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 统计卡片 */}
      <Row gutter={[12, 12]}>
        <Col span={6}>
          <Card size="small" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <Statistic title={<><NodeIndexOutlined /> 实体数</>} value={stats.entityCount || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <Statistic title={<><DatabaseOutlined /> 关系数</>} value={stats.relationCount || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <Statistic title={<><ThunderboltOutlined /> 因果规则</>} value={stats.ruleCount || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <Statistic title={<><ExperimentOutlined /> 实体类型</>} value={entityTypes.length} />
          </Card>
        </Col>
      </Row>

      {/* 过滤器 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索实体/因果规则..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 240 }}
          size="small"
        />
        <Space>
          <Tag
            color={!entityFilter ? 'blue' : 'default'}
            style={{ cursor: 'pointer' }}
            onClick={() => setEntityFilter(null)}
          >全部类型</Tag>
          {entityTypes.map(t => (
            <Tag
              key={t}
              color={entityFilter === t ? entityColors[t] || 'blue' : 'default'}
              style={{ cursor: 'pointer' }}
              onClick={() => setEntityFilter(entityFilter === t ? null : t)}
            >
              {t} {stats.entityTypes?.[t] ? `(${stats.entityTypes[t]})` : ''}
            </Tag>
          ))}
        </Space>
      </div>

      {/* 实体表 */}
      <Card
        size="small"
        title={<><NodeIndexOutlined /> 实体列表 ({filteredNodes.length})</>}
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <Table
          size="small"
          dataSource={filteredNodes}
          rowKey="id"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          loading={graphLoading}
          scroll={{ y: 240 }}
          columns={[
            { title: '名称', dataIndex: 'label', key: 'label', width: 180, render: (v: string, r: any) => (
              <Space><Badge color={entityColors[r.type] || 'default'} /><Text strong>{v}</Text></Space>
            )},
            { title: '类型', dataIndex: 'type', key: 'type', width: 100, render: (v: string) => (
              <Tag color={entityColors[v] || 'default'}>{v}</Tag>
            )},
            { title: '置信度', dataIndex: 'confidence', key: 'confidence', width: 100, render: (v: number) => (
              <Text style={{ color: 'var(--muted)' }}>{Math.round((v || 0) * 100)}%</Text>
            )},
            { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 140, render: (v: number) => (
              <Text style={{ color: 'var(--muted)', fontSize: 12 }}>
                {v ? new Date(v).toLocaleString() : '-'}
              </Text>
            )},
          ]}
        />
      </Card>

      {/* 因果规则表 */}
      <Card
        size="small"
        title={<><ThunderboltOutlined /> 因果规则 ({filteredRules.length})</>}
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {filteredRules.length === 0 ? (
          <Empty description="暂无因果规则。AI 完成任务后会自动沉淀经验。" />
        ) : (
          <Table
            size="small"
            dataSource={filteredRules}
            rowKey="id"
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ y: 200 }}
            columns={[
              { title: '触发原因', dataIndex: 'cause', key: 'cause', render: (v: string) => (
                <Tag color="blue">{v || '-'}</Tag>
              )},
              { title: '→', key: 'arrow', width: 40, align: 'center', render: () => '→' },
              { title: '影响结果', dataIndex: 'effect', key: 'effect', render: (v: string) => (
                <Tag color="green">{v || '-'}</Tag>
              )},
              { title: '概率', dataIndex: 'probability', key: 'probability', width: 80, render: (v: number) => (
                <Text style={{ color: 'var(--muted)' }}>{Math.round((v || 0) * 100)}%</Text>
              )},
              { title: '已验证', dataIndex: 'verified', key: 'verified', width: 80, render: (v: boolean) => (
                v ? <Badge status="success" text="是" /> : <Badge status="default" text="否" />
              )},
            ]}
          />
        )}
      </Card>
    </div>
  );

  return (
    <div style={{ padding: 16 }}>
      <Tabs
        defaultActiveKey="memory"
        size="small"
        items={[
          { key: 'memory', label: '记忆卡片', children: memoryTab },
          { key: 'graph', label: '因果知识图谱', children: graphTab },
        ]}
      />
    </div>
  );
};

export default KnowledgeGraphPanel;
