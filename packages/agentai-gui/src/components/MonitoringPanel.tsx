/**
 * MonitoringPanel — 系统监控面板
 * -------------------------------
 * 可视化展示进化系统、审批策略、反馈闭环、成本追踪、Agent Bus、
 * 自我诊断、预测性维护的运行状态
 */

import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Timeline, Spin, Alert, Button, Badge, Progress, Divider } from 'antd';
import { 
  ReloadOutlined, 
  CheckCircleOutlined, 
  CloseCircleOutlined,
  ClockCircleOutlined,
  SafetyOutlined,
  ExperimentOutlined,
  CommentOutlined,
  FileProtectOutlined,
  DollarOutlined,
  ApiOutlined,
  MedicineBoxOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  TeamOutlined
} from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

// 仪表盘数据接口
interface DashboardData {
  timestamp: number;
  evolution: {
    totalEntries: number;
    recentSuccess: number;
    recentFailure: number;
  };
  approval: {
    totalProposals: number;
    pending: number;
    autoExecuted: number;
  };
  feedback: {
    total: number;
    satisfaction: string;
    trend7d: {
      positive: number;
      negative: number;
      neutral: number;
    };
  };
  health: {
    status: string;
    components: Record<string, string>;
  };
}

// 进化统计接口
interface EvolutionStats {
  totalEntries: number;
  successRate: string;
  dailyStats: Array<{ date: string; success: number; failure: number }>;
  failureCategories: Record<string, number>;
  errorTypes: Record<string, number>;
  recentEntries: Array<{
    ts: number;
    type: string;
    success?: boolean;
    failureCategory?: string;
    keywords?: string[];
  }>;
}

// 审批统计接口
interface ApprovalStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  autoExecuted: number;
  timeout: number;
  byRiskLevel: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  averageRiskScore: string;
  recent: Array<{
    id: string;
    type: string;
    riskScore: number;
    riskLevel: string;
    status: string;
    timestamp: number;
  }>;
}

// 反馈统计接口
interface FeedbackStats {
  totalCount: number;
  thumbsUp: number;
  thumbsDown: number;
  correctionCount: number;
  detailedCount: number;
  averageRating: number;
  trend7d: {
    positive: number;
    negative: number;
    neutral: number;
  };
  tagDistribution: Record<string, number>;
}

// 成本统计接口
interface CostStats {
  today: {
    date: string;
    totalTokens: number;
    taskCount: number;
    avgCost: number;
  };
  history: Array<{
    date: string;
    totalTokens: number;
    taskCount: number;
  }>;
  trends: {
    direction: 'up' | 'down' | 'stable';
    change: string;
  };
  modelDistribution: Array<{
    name: string;
    tokens: number;
    percentage: string;
  }>;
  budget: {
    dailyLimit: number;
    alertThreshold: number;
  };
}

// Agent Bus统计接口
interface AgentBusStats {
  agentCount: number;
  onlineCount: number;
  subscriptionCount: number;
  messageCount: number;
  pendingResponseCount: number;
  agents: Array<{
    id: string;
    name: string;
    status: 'idle' | 'busy' | 'offline';
    capabilities: string[];
  }>;
}

// 自我诊断接口
interface DiagnosisResult {
  healthy: boolean;
  score: number;
  issues: Array<{
    id: string;
    category: string;
    severity: 'info' | 'warning' | 'critical' | 'fatal';
    title: string;
    description: string;
    autoFixable: boolean;
  }>;
  metrics: {
    memory: { usagePercent: number };
    disk: { usagePercent: number };
    cpu: { usagePercent: number };
  };
}

// 预测性维护接口
interface PredictiveMaintenance {
  predictions: Array<{
    id: string;
    type: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    description: string;
    expectedAt: number;
    confidence: 'low' | 'medium' | 'high';
  }>;
  healthTrend: 'improving' | 'stable' | 'degrading';
}

const MonitoringPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [evolutionStats, setEvolutionStats] = useState<EvolutionStats | null>(null);
  const [approvalStats, setApprovalStats] = useState<ApprovalStats | null>(null);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);
  const [costStats, setCostStats] = useState<CostStats | null>(null);
  const [agentBusStats, setAgentBusStats] = useState<AgentBusStats | null>(null);
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  const [maintenanceData, setMaintenanceData] = useState<PredictiveMaintenance | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'evolution' | 'approval' | 'feedback' | 'cost' | 'system'>('overview');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashRes, evoRes, appRes, feedRes, costRes, busRes, diagRes, maintRes] = await Promise.all([
        fetch(`${GATEWAY_HTTP}/api/monitoring/dashboard`),
        fetch(`${GATEWAY_HTTP}/api/monitoring/evolution/stats`),
        fetch(`${GATEWAY_HTTP}/api/monitoring/approval/stats`),
        fetch(`${GATEWAY_HTTP}/api/monitoring/feedback/stats`),
        fetch(`${GATEWAY_HTTP}/api/cost/dashboard`),
        fetch(`${GATEWAY_HTTP}/api/agent-bus/stats`),
        fetch(`${GATEWAY_HTTP}/api/self-diagnosis/result`),
        fetch(`${GATEWAY_HTTP}/api/predictive-maintenance/report`),
      ]);

      if (!dashRes.ok) throw new Error('Failed to fetch dashboard data');
      
      setDashboard(await dashRes.json());
      if (evoRes.ok) setEvolutionStats(await evoRes.json());
      if (appRes.ok) setApprovalStats(await appRes.json());
      if (feedRes.ok) setFeedbackStats(await feedRes.json());
      if (costRes.ok) {
        const costData = await costRes.json();
        setCostStats(costData.data);
      }
      if (busRes.ok) setAgentBusStats(await busRes.json());
      if (diagRes.ok) setDiagnosisResult(await diagRes.json());
      if (maintRes.ok) setMaintenanceData(await maintRes.json());
    } catch (err: any) {
      setError(err.message || 'Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // 30秒刷新
    return () => clearInterval(interval);
  }, []);

  // 计算今日成本使用率
  const costUsagePercent = costStats?.today && costStats?.budget 
    ? Math.min(100, Math.round((costStats.today.totalTokens / costStats.budget.dailyLimit) * 100))
    : 0;

  // 获取严重问题数量
  const criticalIssues = diagnosisResult?.issues.filter(i => i.severity === 'critical' || i.severity === 'fatal').length || 0;
  const warningIssues = diagnosisResult?.issues.filter(i => i.severity === 'warning').length || 0;

  // 获取预测性维护预警数量
  const criticalPredictions = maintenanceData?.predictions.filter(p => p.severity === 'critical').length || 0;

  if (loading && !dashboard) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin size="large" />
        <p>加载监控数据...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        message="加载失败"
        description={error}
        type="error"
        showIcon
        action={
          <Button onClick={fetchData} icon={<ReloadOutlined />}>
            重试
          </Button>
        }
      />
    );
  }

  const renderOverview = () => (
    <>
      {/* 第一行：核心指标 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="进化记录总数"
              value={dashboard?.evolution.totalEntries || 0}
              prefix={<ExperimentOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="审批提案总数"
              value={dashboard?.approval.totalProposals || 0}
              prefix={<FileProtectOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="今日Token消耗"
              value={costStats?.today.totalTokens?.toLocaleString() || 0}
              prefix={<DollarOutlined />}
              valueStyle={{ color: costUsagePercent > 80 ? '#f5222d' : '#722ed1' }}
              suffix={costUsagePercent > 0 ? `(${costUsagePercent}%)` : ''}
            />
            {costStats?.budget && (
              <Progress 
                percent={costUsagePercent} 
                size="small" 
                status={costUsagePercent > 90 ? 'exception' : costUsagePercent > 70 ? 'active' : 'normal'}
                showInfo={false}
                style={{ marginTop: 8 }}
              />
            )}
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="系统健康度"
              value={diagnosisResult?.score || 100}
              suffix="/100"
              prefix={<MedicineBoxOutlined />}
              valueStyle={{ 
                color: diagnosisResult && diagnosisResult.score >= 80 ? '#52c41a' : 
                       diagnosisResult && diagnosisResult.score >= 60 ? '#faad14' : '#f5222d'
              }}
            />
            {criticalIssues > 0 && (
              <Tag color="error" style={{ marginTop: 8 }}>{criticalIssues} 严重问题</Tag>
            )}
            {warningIssues > 0 && (
              <Tag color="warning" style={{ marginTop: 8 }}>{warningIssues} 警告</Tag>
            )}
          </Card>
        </Col>
      </Row>

      {/* 第二行：状态和趋势 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card 
            title="系统健康状态" 
            extra={
              <Badge 
                status={diagnosisResult?.healthy ? 'success' : 'error'} 
                text={diagnosisResult?.healthy ? '健康' : '异常'} 
              />
            }
          >
            <Timeline>
              <Timeline.Item
                dot={<ApiOutlined style={{ color: '#1890ff' }} />}
              >
                Agent Bus: {agentBusStats?.onlineCount || 0}/{agentBusStats?.agentCount || 0} 在线
              </Timeline.Item>
              <Timeline.Item
                dot={<TeamOutlined style={{ color: '#52c41a' }} />}
              >
                消息总数: {agentBusStats?.messageCount?.toLocaleString() || 0}
              </Timeline.Item>
              <Timeline.Item
                dot={
                  maintenanceData?.healthTrend === 'improving' ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> :
                  maintenanceData?.healthTrend === 'degrading' ? <WarningOutlined style={{ color: '#f5222d' }} /> :
                  <ClockCircleOutlined style={{ color: '#faad14' }} />
                }
              >
                健康趋势: 
                {maintenanceData?.healthTrend === 'improving' ? '改善中' :
                 maintenanceData?.healthTrend === 'degrading' ? '退化中' : '稳定'}
                {criticalPredictions > 0 && <Tag color="error" style={{ marginLeft: 8 }}>{criticalPredictions} 预警</Tag>}
              </Timeline.Item>
              {Object.entries(dashboard?.health.components || {}).map(([name, status]) => (
                <Timeline.Item
                  key={name}
                  dot={status === 'ok' ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <ClockCircleOutlined style={{ color: '#fa8c16' }} />}
                >
                  {name}: {status === 'ok' ? '正常' : status === 'empty' ? '暂无数据' : status}
                </Timeline.Item>
              ))}
            </Timeline>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="7天反馈趋势">
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="正面" value={dashboard?.feedback.trend7d.positive || 0} valueStyle={{ color: '#52c41a' }} />
              </Col>
              <Col span={8}>
                <Statistic title="负面" value={dashboard?.feedback.trend7d.negative || 0} valueStyle={{ color: '#f5222d' }} />
              </Col>
              <Col span={8}>
                <Statistic title="中性" value={dashboard?.feedback.trend7d.neutral || 0} valueStyle={{ color: '#faad14' }} />
              </Col>
            </Row>
            <Divider style={{ margin: '16px 0' }} />
            <Statistic
              title="用户满意度"
              value={dashboard?.feedback.satisfaction || '0'}
              suffix="%"
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="成本趋势">
            <Statistic
              title="7日趋势"
              value={costStats?.trends?.change || '0'}
              suffix="%"
              prefix={costStats?.trends?.direction === 'up' ? '↑' : costStats?.trends?.direction === 'down' ? '↓' : '→'}
              valueStyle={{ 
                color: costStats?.trends?.direction === 'up' ? '#f5222d' : 
                       costStats?.trends?.direction === 'down' ? '#52c41a' : '#faad14'
              }}
            />
            <Divider style={{ margin: '16px 0' }} />
            <div style={{ fontSize: 12, color: '#888' }}>
              模型使用分布:
              {costStats?.modelDistribution?.slice(0, 3).map(m => (
                <div key={m.name} style={{ marginTop: 4 }}>
                  {m.name}: {m.percentage}%
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      {/* 预测性维护预警 */}
      {maintenanceData && maintenanceData.predictions.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col span={24}>
            <Card title={<><WarningOutlined /> 预测性维护预警</>}>
              <Table
                dataSource={maintenanceData.predictions.slice(0, 5)}
                rowKey="id"
                pagination={false}
                size="small"
                columns={[
                  { 
                    title: '级别', 
                    dataIndex: 'severity',
                    width: 80,
                    render: (s: string) => (
                      <Tag color={s === 'critical' ? 'red' : s === 'warning' ? 'orange' : 'blue'}>
                        {s === 'critical' ? '严重' : s === 'warning' ? '警告' : '信息'}
                      </Tag>
                    )
                  },
                  { title: '标题', dataIndex: 'title' },
                  { title: '描述', dataIndex: 'description', ellipsis: true },
                  { 
                    title: '预计时间', 
                    dataIndex: 'expectedAt',
                    render: (ts: number) => new Date(ts).toLocaleDateString()
                  },
                  { 
                    title: '置信度', 
                    dataIndex: 'confidence',
                    render: (c: string) => (
                      <Tag color={c === 'high' ? 'green' : c === 'medium' ? 'orange' : 'default'}>
                        {c === 'high' ? '高' : c === 'medium' ? '中' : '低'}
                      </Tag>
                    )
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 自我诊断问题 */}
      {diagnosisResult && diagnosisResult.issues.length > 0 && (
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <Card title={<><MedicineBoxOutlined /> 诊断问题</>}>
              <Table
                dataSource={diagnosisResult.issues.slice(0, 5)}
                rowKey="id"
                pagination={false}
                size="small"
                columns={[
                  { 
                    title: '级别', 
                    dataIndex: 'severity',
                    width: 80,
                    render: (s: string) => (
                      <Tag color={s === 'fatal' ? 'purple' : s === 'critical' ? 'red' : s === 'warning' ? 'orange' : 'blue'}>
                        {s === 'fatal' ? '致命' : s === 'critical' ? '严重' : s === 'warning' ? '警告' : '信息'}
                      </Tag>
                    )
                  },
                  { title: '类别', dataIndex: 'category', width: 100 },
                  { title: '标题', dataIndex: 'title' },
                  { title: '描述', dataIndex: 'description', ellipsis: true },
                  { 
                    title: '可自动修复', 
                    dataIndex: 'autoFixable',
                    width: 100,
                    render: (fixable: boolean) => fixable ? <Tag color="green">是</Tag> : <Tag>否</Tag>
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}
    </>
  );

  const renderEvolution = () => (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="成功率"
              value={evolutionStats?.successRate || '0'}
              suffix="%"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="失败分类数"
              value={Object.keys(evolutionStats?.failureCategories || {}).length}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="错误类型数"
              value={Object.keys(evolutionStats?.errorTypes || {}).length}
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近进化记录" style={{ marginBottom: 24 }}>
        <Table
          dataSource={evolutionStats?.recentEntries || []}
          rowKey={(record, index) => `${record.ts}-${index}`}
          pagination={false}
          columns={[
            { title: '时间', dataIndex: 'ts', render: (ts: number) => new Date(ts).toLocaleString() },
            { title: '类型', dataIndex: 'type' },
            { 
              title: '状态', 
              dataIndex: 'success',
              render: (success?: boolean) => 
                success === true ? <Tag color="success">成功</Tag> : 
                success === false ? <Tag color="error">失败</Tag> : 
                <Tag>未知</Tag>
            },
            { title: '关键词', dataIndex: 'keywords', render: (keywords: string[]) => 
              keywords?.map(k => <Tag key={k}>{k}</Tag>) 
            },
          ]}
        />
      </Card>
    </>
  );

  const renderApproval = () => (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="待审批" value={approvalStats?.pending || 0} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已通过" value={approvalStats?.approved || 0} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已拒绝" value={approvalStats?.rejected || 0} valueStyle={{ color: '#f5222d' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="自动执行" value={approvalStats?.autoExecuted || 0} valueStyle={{ color: '#1890ff' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="风险等级分布">
            <Row gutter={16}>
              <Col span={6}><Statistic title="低风险" value={approvalStats?.byRiskLevel.low || 0} /></Col>
              <Col span={6}><Statistic title="中风险" value={approvalStats?.byRiskLevel.medium || 0} /></Col>
              <Col span={6}><Statistic title="高风险" value={approvalStats?.byRiskLevel.high || 0} /></Col>
              <Col span={6}><Statistic title="严重" value={approvalStats?.byRiskLevel.critical || 0} /></Col>
            </Row>
          </Card>
        </Col>
        <Col span={12}>
          <Card>
            <Statistic title="平均风险分" value={approvalStats?.averageRiskScore || '0'} suffix="/100" />
          </Card>
        </Col>
      </Row>

      <Card title="最近审批记录">
        <Table
          dataSource={approvalStats?.recent || []}
          rowKey="id"
          pagination={false}
          columns={[
            { title: 'ID', dataIndex: 'id', ellipsis: true },
            { title: '类型', dataIndex: 'type' },
            { title: '风险分', dataIndex: 'riskScore' },
            { 
              title: '风险等级', 
              dataIndex: 'riskLevel',
              render: (level: string) => {
                const colors: Record<string, string> = { low: 'success', medium: 'warning', high: 'error', critical: 'purple' };
                return <Tag color={colors[level] || 'default'}>{level.toUpperCase()}</Tag>;
              }
            },
            { 
              title: '状态', 
              dataIndex: 'status',
              render: (status: string) => {
                const labels: Record<string, string> = { 
                  pending: '待审批', approved: '已通过', rejected: '已拒绝', 
                  auto_executed: '自动执行', timeout: '超时' 
                };
                return <Tag>{labels[status] || status}</Tag>;
              }
            },
            { title: '时间', dataIndex: 'timestamp', render: (ts: number) => new Date(ts).toLocaleString() },
          ]}
        />
      </Card>
    </>
  );

  const renderFeedback = () => (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="👍 点赞" value={feedbackStats?.thumbsUp || 0} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="👎 点踩" value={feedbackStats?.thumbsDown || 0} valueStyle={{ color: '#f5222d' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="修正反馈" value={feedbackStats?.correctionCount || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="平均评分" value={feedbackStats?.averageRating?.toFixed(1) || '0'} suffix="/5" />
          </Card>
        </Col>
      </Row>

      <Card title="问题标签分布">
        <Row gutter={[8, 8]}>
          {Object.entries(feedbackStats?.tagDistribution || {}).map(([tag, count]) => (
            <Col key={tag}>
              <Tag>{tag}: {count}</Tag>
            </Col>
          ))}
        </Row>
      </Card>
    </>
  );

  const renderCost = () => (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic 
              title="今日Token消耗" 
              value={costStats?.today.totalTokens?.toLocaleString() || 0}
              prefix={<DollarOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic 
              title="今日任务数" 
              value={costStats?.today.taskCount || 0}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic 
              title="平均成本" 
              value={costStats?.today.avgCost?.toLocaleString() || 0}
              suffix="tokens/任务"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic 
              title="预算使用率" 
              value={costUsagePercent}
              suffix="%"
              valueStyle={{ color: costUsagePercent > 80 ? '#f5222d' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="7日消耗历史">
            <Table
              dataSource={costStats?.history || []}
              rowKey="date"
              pagination={false}
              size="small"
              columns={[
                { title: '日期', dataIndex: 'date' },
                { title: 'Token数', dataIndex: 'totalTokens', render: (v: number) => v?.toLocaleString() },
                { title: '任务数', dataIndex: 'taskCount' },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="模型使用分布">
            <Table
              dataSource={costStats?.modelDistribution || []}
              rowKey="name"
              pagination={false}
              size="small"
              columns={[
                { title: '模型', dataIndex: 'name' },
                { title: 'Token数', dataIndex: 'tokens', render: (v: number) => v?.toLocaleString() },
                { title: '占比', dataIndex: 'percentage', render: (v: string) => `${v}%` },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );

  const renderSystem = () => (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic 
              title="Agent总数" 
              value={agentBusStats?.agentCount || 0}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic 
              title="在线Agent" 
              value={agentBusStats?.onlineCount || 0}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic 
              title="消息总数" 
              value={agentBusStats?.messageCount?.toLocaleString() || 0}
              prefix={<ApiOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="Agent列表">
            <Table
              dataSource={agentBusStats?.agents || []}
              rowKey="id"
              pagination={false}
              size="small"
              columns={[
                { title: 'ID', dataIndex: 'id', ellipsis: true },
                { title: '名称', dataIndex: 'name' },
                { 
                  title: '状态', 
                  dataIndex: 'status',
                  render: (s: string) => (
                    <Tag color={s === 'idle' ? 'green' : s === 'busy' ? 'orange' : 'default'}>
                      {s === 'idle' ? '空闲' : s === 'busy' ? '忙碌' : '离线'}
                    </Tag>
                  )
                },
                { 
                  title: '能力', 
                  dataIndex: 'capabilities',
                  render: (caps: string[]) => caps?.map((c: string) => <Tag key={c}>{c}</Tag>)
                },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="系统资源">
            <Row gutter={[16, 16]}>
              <Col span={24}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ marginBottom: 8 }}>内存使用率</div>
                  <Progress 
                    percent={Math.round(diagnosisResult?.metrics?.memory?.usagePercent || 0)} 
                    status={diagnosisResult && diagnosisResult.metrics.memory.usagePercent > 90 ? 'exception' : 'normal'}
                  />
                </div>
              </Col>
              <Col span={24}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ marginBottom: 8 }}>磁盘使用率</div>
                  <Progress 
                    percent={Math.round(diagnosisResult?.metrics?.disk?.usagePercent || 0)} 
                    status={diagnosisResult && diagnosisResult.metrics.disk.usagePercent > 90 ? 'exception' : 'normal'}
                  />
                </div>
              </Col>
              <Col span={24}>
                <div>
                  <div style={{ marginBottom: 8 }}>CPU使用率</div>
                  <Progress 
                    percent={Math.round(diagnosisResult?.metrics?.cpu?.usagePercent || 0)} 
                    status={diagnosisResult && diagnosisResult.metrics.cpu.usagePercent > 80 ? 'exception' : 'normal'}
                  />
                </div>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </>
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>系统监控面板</h2>
        <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
          刷新
        </Button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <Button 
          type={activeTab === 'overview' ? 'primary' : 'default'}
          onClick={() => setActiveTab('overview')}
          style={{ marginRight: 8 }}
        >
          总览
        </Button>
        <Button 
          type={activeTab === 'evolution' ? 'primary' : 'default'}
          onClick={() => setActiveTab('evolution')}
          style={{ marginRight: 8 }}
        >
          进化系统
        </Button>
        <Button 
          type={activeTab === 'approval' ? 'primary' : 'default'}
          onClick={() => setActiveTab('approval')}
          style={{ marginRight: 8 }}
        >
          审批策略
        </Button>
        <Button 
          type={activeTab === 'feedback' ? 'primary' : 'default'}
          onClick={() => setActiveTab('feedback')}
          style={{ marginRight: 8 }}
        >
          反馈闭环
        </Button>
        <Button 
          type={activeTab === 'cost' ? 'primary' : 'default'}
          onClick={() => setActiveTab('cost')}
          style={{ marginRight: 8 }}
        >
          成本追踪
        </Button>
        <Button 
          type={activeTab === 'system' ? 'primary' : 'default'}
          onClick={() => setActiveTab('system')}
        >
          系统状态
        </Button>
      </div>

      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'evolution' && renderEvolution()}
      {activeTab === 'approval' && renderApproval()}
      {activeTab === 'feedback' && renderFeedback()}
      {activeTab === 'cost' && renderCost()}
      {activeTab === 'system' && renderSystem()}
    </div>
  );
};

export default MonitoringPanel;
