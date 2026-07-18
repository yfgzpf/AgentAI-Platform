/**
 * GovernorPanel — 系统管控员 AI 治理面板
 * ===========================================================================
 * 展示动态能力矩阵、系统健康报告、模型推荐建议
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Progress, Tooltip, Button, Space, Alert,
  Statistic, Row, Col, Empty, Spin, Typography, Switch, Divider, Modal,
  message,
} from 'antd';
import {
  ReloadOutlined, ThunderboltFilled, ArrowUpOutlined, ArrowDownOutlined,
  CheckCircleOutlined, WarningOutlined, DashboardOutlined, BulbOutlined,
  HistoryOutlined, ApiOutlined, PauseCircleOutlined,
} from '@ant-design/icons';
import { apiGet } from '../services/api';

const { Text, Title } = Typography;

// ===== 类型 =====
interface ModelHealth {
  modelId: string;
  label: string;
  healthScore: number;
  staticOverall: number;
  dynamicOverall: number;
  tierChanged: boolean;
  staticTier: string;
  dynamicTier: string;
  sampleCount: number;
  successRate: number;
  toolCallSuccessRate: number;
  qualityScore: number;
  avgLatencyMs: number;
  topErrors: Array<{ pattern: string; count: number }>;
}

interface HealthReport {
  timestamp: number;
  trackedModels: number;
  totalSamples: number;
  models: ModelHealth[];
  recommendations: string[];
}

const TIER_COLORS: Record<string, string> = {
  autonomous: '#52c41a',
  guided: '#faad14',
  supervised: '#ff4d4f',
};

const TIER_LABELS: Record<string, string> = {
  autonomous: '自主',
  guided: '引导',
  supervised: '监督',
};

export function GovernorPanel() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  // 趋势快照历史 (最多 30 个采样点)
  const [history, setHistory] = useState<Array<{ time: number; modelId: string; healthScore: number; successRate: number }>>([]);
  // 电路熔断事件
  const [circuitEvents, setCircuitEvents] = useState<Array<{ time: number; model: string; action: string }>>([]);

  const snapshotHistory = useCallback((r: HealthReport) => {
    setHistory(prev => {
      const now = Date.now();
      const newSnapshots = r.models.map(m => ({
        time: now,
        modelId: m.modelId,
        healthScore: m.healthScore,
        successRate: m.successRate,
      }));
      return [...prev, ...newSnapshots].slice(-60); // 保留最近 60 条
    });
  }, []);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<HealthReport>('/governor/health');
      setReport(data);
      snapshotHistory(data);
      // 模拟一些熔断事件 (实际应用中从 SSE/API 获取)
      if (data.models.some(m => m.successRate < 0.4)) {
        setCircuitEvents(prev => {
          const failing = data.models.filter(m => m.successRate < 0.4).map(m => ({
            time: Date.now(),
            model: m.modelId,
            action: `熔断: ${m.label} 成功率 ${(m.successRate * 100).toFixed(0)}%`,
          }));
          return [...failing, ...prev].slice(-20);
        });
      }
    } catch (e) {
      console.error('[governor] fetch health failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
    const timer = setInterval(fetchReport, 30_000); // 每 30s 刷新
    return () => clearInterval(timer);
  }, [fetchReport]);

  const handleFlush = async () => {
    try {
      await apiGet('/governor/flush');
      fetchReport();
    } catch (e) {
      console.error('[governor] flush failed:', e);
    }
  };

  if (loading && !report) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!report || report.models.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Empty
          description="尚无运行时数据 — 开始对话后, 系统管控员将自动收集模型能力数据"
        />
      </div>
    );
  }

  const columns = [
    {
      title: '模型',
      dataIndex: 'label',
      key: 'label',
      render: (label: string, record: ModelHealth) => (
        <Space>
          <Text strong>{label}</Text>
          {record.tierChanged && (
            <Tooltip title={`${TIER_LABELS[record.staticTier]} → ${TIER_LABELS[record.dynamicTier]}`}>
              {record.dynamicTier === 'autonomous' ? (
                <ArrowUpOutlined style={{ color: '#52c41a' }} />
              ) : record.dynamicTier === 'supervised' ? (
                <ArrowDownOutlined style={{ color: '#ff4d4f' }} />
              ) : null}
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '能力等级',
      key: 'tier',
      render: (_: any, record: ModelHealth) => (
        <Space direction="vertical" size={0}>
          <Tag color={TIER_COLORS[record.dynamicTier]}>
            {TIER_LABELS[record.dynamicTier]}
          </Tag>
          {record.tierChanged && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              原: {TIER_LABELS[record.staticTier]}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '健康分',
      dataIndex: 'healthScore',
      key: 'healthScore',
      render: (score: number) => (
        <Progress
          percent={Math.round(score * 100)}
          size="small"
          strokeColor={score >= 0.65 ? '#52c41a' : score >= 0.4 ? '#faad14' : '#ff4d4f'}
          format={(p) => `${p}`}
        />
      ),
      sorter: (a: ModelHealth, b: ModelHealth) => b.healthScore - a.healthScore,
    },
    {
      title: '静态分',
      dataIndex: 'staticOverall',
      key: 'staticOverall',
      render: (v: number) => <Text type="secondary">{(v * 100).toFixed(0)}</Text>,
    },
    {
      title: '动态分',
      dataIndex: 'dynamicOverall',
      key: 'dynamicOverall',
      render: (v: number) => <Text style={{ color: 'var(--accent, #1677ff)' }}>{(v * 100).toFixed(0)}</Text>,
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      render: (v: number) => (
        <Progress
          percent={Math.round(v * 100)}
          size="small"
          strokeColor={v >= 0.75 ? '#52c41a' : v >= 0.5 ? '#faad14' : '#ff4d4f'}
        />
      ),
    },
    {
      title: '工具调用',
      dataIndex: 'toolCallSuccessRate',
      key: 'toolCallSuccessRate',
      render: (v: number) => (
        <Progress
          percent={Math.round(v * 100)}
          size="small"
          strokeColor={v >= 0.7 ? '#52c41a' : v >= 0.5 ? '#faad14' : '#ff4d4f'}
        />
      ),
    },
    {
      title: '质量分',
      dataIndex: 'qualityScore',
      key: 'qualityScore',
      render: (v: number) => <Text>{(v * 100).toFixed(0)}</Text>,
    },
    {
      title: '延迟',
      dataIndex: 'avgLatencyMs',
      key: 'avgLatencyMs',
      render: (v: number) => (
        <Text type={v > 3000 ? 'danger' : 'secondary'}>
          {v > 0 ? `${v.toFixed(0)}ms` : '-'}
        </Text>
      ),
    },
    {
      title: '样本',
      dataIndex: 'sampleCount',
      key: 'sampleCount',
      render: (v: number) => <Text type="secondary">{v}</Text>,
    },
  ];

  return (
    <div style={{ padding: 16, maxHeight: 'calc(100vh - 48px)', overflow: 'auto' }}>
      <Title level={4} style={{ marginBottom: 16 }}>
        <DashboardOutlined style={{ marginRight: 8 }} />
        系统管控员 AI
      </Title>

      {/* 统计概览 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="追踪模型数"
              value={report.trackedModels}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="总样本数"
              value={report.totalSamples}
              prefix={<ThunderboltFilled style={{ color: 'var(--accent, #1677ff)' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="等级变更"
              value={report.models.filter(m => m.tierChanged).length}
              prefix={<WarningOutlined style={{ color: '#faad14' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="系统建议"
              value={report.recommendations.length}
              prefix={<BulbOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 系统建议 */}
      {report.recommendations.length > 0 && (
        <Alert
          type="info"
          style={{ marginBottom: 16 }}
          message={
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {report.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          }
        />
      )}

      {/* 熔断事件 & 历史趋势 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card size="small" title={<Space><WarningOutlined />熔断/降级事件</Space>}>
            {circuitEvents.length === 0 ? (
              <Empty description="无熔断事件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div style={{ maxHeight: 120, overflow: 'auto', fontSize: 12 }}>
                {circuitEvents.slice(0, 8).map((e, i) => (
                  <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid var(--border)' }}>
                    <Tag color="red">熔断</Tag>
                    <span style={{ color: 'var(--muted)' }}>{new Date(e.time).toLocaleTimeString()}</span>
                    <span style={{ marginLeft: 8 }}>{e.action}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={<Space><HistoryOutlined />健康分趋势 (近 30 分钟)</Space>}
            extra={history.length > 0 ? <Tag color="blue">{history.length} 采样</Tag> : null}
          >
            {history.length < 2 ? (
              <Empty description="等待数据积累" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div style={{ height: 100, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
                {Array.from(new Set(history.map(h => h.modelId))).slice(0, 4).map(modelId => {
                  const points = history.filter(h => h.modelId === modelId).slice(-30);
                  if (points.length < 2) return null;
                  const max = Math.max(...points.map(p => p.healthScore), 1);
                  return (
                    <Tooltip key={modelId} title={`${modelId}: ${(points[points.length - 1].healthScore * 100).toFixed(0)}%`}>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 1, height: 80 }}>
                        {points.map((p, i) => (
                          <div key={i} style={{
                            flex: 1,
                            height: `${(p.healthScore / max) * 100}%`,
                            minHeight: 2,
                            background: p.healthScore > 0.6 ? '#52c41a' : p.healthScore > 0.4 ? '#faad14' : '#ff4d4f',
                            borderRadius: '1px 1px 0 0',
                            opacity: 0.7 + 0.3 * (i / points.length),
                          }} />
                        ))}
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 手动操作区 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>手动控制:</span>
          {report.models.slice(0, 4).map(m => (
            <Tooltip key={m.modelId} title={`${m.label}: 当前 ${TIER_LABELS[m.dynamicTier]}`}>
              <Button size="small" icon={<PauseCircleOutlined />}
                onClick={() => {
                  Modal.confirm({
                    title: `手动调整 ${m.label} 等级`,
                    content: `当前等级: ${TIER_LABELS[m.dynamicTier]}. 降级到监督模式?`,
                    onOk: () => {
                      // TODO: 调用后端 API 手动降级
                      message.success(`已请求降级 ${m.label}`);
                    },
                  });
                }}
              >{m.label}</Button>
            </Tooltip>
          ))}
        </Space>
      </Card>

      {/* 能力矩阵表 */}
      <Card
        size="small"
        title="动态能力矩阵"
        extra={
          <Space>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={fetchReport}
              loading={loading}
            >
              刷新
            </Button>
            <Button
              size="small"
              icon={<ThunderboltFilled />}
              onClick={handleFlush}
            >
              持久化
            </Button>
          </Space>
        }
      >
        <Table
          dataSource={report.models}
          columns={columns}
          rowKey="modelId"
          size="small"
          pagination={false}
          scroll={{ x: 900 }}
        />
      </Card>

      {/* 说明 */}
      <Card size="small" style={{ marginTop: 16 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          ◎ 系统管控员 AI 自动收集每次对话的运行时数据 (成功率/工具调用/质量分/延迟),
          通过 EMA 平滑算法维护「模型 × 任务类型」动态能力矩阵。
          运行时表现可动态升降模型能力等级 (自主/引导/监督), 并影响路由决策。
          数据每 30 秒自动持久化到 .agentai/capability-matrix.json。
        </Text>
      </Card>
    </div>
  );
}
