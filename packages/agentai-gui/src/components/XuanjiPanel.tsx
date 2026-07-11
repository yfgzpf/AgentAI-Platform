/**
 * XuanjiPanel - PulseFlow 核心认知框架面板
 * 
 * 展示四诊结果、辨证分析、医案记录
 */
import React, { useState, useEffect } from 'react';
import { Card, Tabs, Tag, Timeline, Statistic, Row, Col, Badge, Empty, Spin, Alert, Button, List, Typography, Divider } from 'antd';
import { 
  MedicineBoxOutlined, 
  FileTextOutlined, 
  BarChartOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  EyeOutlined,
  DatabaseOutlined
} from '@ant-design/icons';

const { Text, Title } = Typography;

interface MedicalCase {
  id: string;
  timestamp: string;
  patient: string;
  symptoms: string;
  diagnosis: {
    inspection: {
      taskType: string;
      complexity: string;
      entities: string[];
    };
    auscultation: {
      ambiguities: string[];
      gaps: string[];
    };
    inquiry?: {
      questions: string[];
      answers: string[];
    };
    palpation: {
      confidence: number;
      riskLevel: string;
      approach: string;
    };
  };
  treatment: {
    approach: string;
    prescription: any[];
    steps: any[];
  };
  outcome: {
    status: 'success' | 'failure' | 'partial' | 'aborted';
    successRate: number;
    duration: number;
    result: string;
  };
  lessons: {
    strengths: string[];
    weaknesses: string[];
    reusable: boolean;
    tags: string[];
  };
}

interface XuanjiStats {
  totalCases: number;
  successRate: number;
  averageDuration: number;
  topTreatments: { approach: string; count: number; successRate: number }[];
  commonSymptoms: { symptom: string; count: number }[];
}

export const XuanjiPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState('cases');
  const [cases, setCases] = useState<MedicalCase[]>([]);
  const [stats, setStats] = useState<XuanjiStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState<MedicalCase | null>(null);

  // 加载医案数据
  const loadCases = async () => {
    setLoading(true);
    try {
      const response = await fetch('/v1/xuanji/cases?limit=50');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setCases(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to load cases:', error);
    } finally {
      setLoading(false);
    }
  };

  // 加载统计数据
  const loadStats = async () => {
    try {
      const response = await fetch('/v1/xuanji/stats');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setStats(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  useEffect(() => {
    loadCases();
    loadStats();
    
    // 定时刷新
    const interval = setInterval(() => {
      loadStats();
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  // 获取状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'success';
      case 'failure': return 'error';
      case 'partial': return 'warning';
      default: return 'default';
    }
  };

  // 获取状态图标
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'failure': return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'partial': return <ExclamationCircleOutlined style={{ color: '#faad14' }} />;
      default: return <ClockCircleOutlined style={{ color: '#8c8c8c' }} />;
    }
  };

  // 渲染统计面板
  const renderStatsPanel = () => {
    if (!stats) return <Spin size="large" />;

    return (
      <div style={{ padding: '16px 0' }}>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card>
              <Statistic
                title="总医案数"
                value={stats.totalCases}
                prefix={<DatabaseOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="成功率"
                value={(stats.successRate * 100).toFixed(1)}
                suffix="%"
                precision={1}
                valueStyle={{ color: stats.successRate > 0.7 ? '#3f8600' : '#cf1322' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="平均耗时"
                value={(stats.averageDuration / 1000).toFixed(0)}
                suffix="秒"
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="可复用医案"
                value={cases.filter(c => c.lessons.reusable).length}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Card title="常用治法" size="small">
              {stats.topTreatments.map((t, idx) => (
                <div key={idx} style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <Text>{t.approach}</Text>
                  <div>
                    <Tag color="blue">{t.count}次</Tag>
                    <Tag color={t.successRate > 0.7 ? 'success' : 'warning'}>
                      {(t.successRate * 100).toFixed(0)}%
                    </Tag>
                  </div>
                </div>
              ))}
            </Card>
          </Col>
          <Col span={12}>
            <Card title="常见症状" size="small">
              {stats.commonSymptoms.slice(0, 10).map((s, idx) => (
                <Tag key={idx} style={{ marginBottom: 4 }}>
                  {s.symptom} ({s.count})
                </Tag>
              ))}
            </Card>
          </Col>
        </Row>
      </div>
    );
  };

  // 渲染医案列表
  const renderCasesList = () => {
    if (loading) return <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />;
    
    if (cases.length === 0) {
      return <Empty description="暂无医案记录" />;
    }

    return (
      <List
        dataSource={cases}
        renderItem={item => (
          <List.Item
            actions={[
              <Button 
                type="link" 
                icon={<EyeOutlined />}
                onClick={() => setSelectedCase(item)}
              >
                查看
              </Button>
            ]}
          >
            <List.Item.Meta
              avatar={getStatusIcon(item.outcome.status)}
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong>{item.symptoms.slice(0, 50)}...</Text>
                  <Tag color={getStatusColor(item.outcome.status)}>
                    {item.outcome.status === 'success' ? '成功' : 
                     item.outcome.status === 'failure' ? '失败' : 
                     item.outcome.status === 'partial' ? '部分成功' : '进行中'}
                  </Tag>
                  {item.lessons.reusable && <Tag color="green">可复用</Tag>}
                </div>
              }
              description={
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(item.timestamp).toLocaleString()} · 
                    治法: {item.treatment.approach} · 
                    置信度: {(item.diagnosis.palpation.confidence * 100).toFixed(0)}%
                  </Text>
                  <div style={{ marginTop: 4 }}>
                    {item.lessons.tags.map(tag => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                </div>
              }
            />
          </List.Item>
        )}
      />
    );
  };

  // 渲染医案详情
  const renderCaseDetail = () => {
    if (!selectedCase) return null;

    const c = selectedCase;

    return (
      <div style={{ padding: 16 }}>
        <Button onClick={() => setSelectedCase(null)} style={{ marginBottom: 16 }}>
          ← 返回列表
        </Button>

        <Title level={4}>医案详情</Title>
        
        <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
          <p><Text strong>ID:</Text> {c.id}</p>
          <p><Text strong>时间:</Text> {new Date(c.timestamp).toLocaleString()}</p>
          <p><Text strong>症状:</Text> {c.symptoms}</p>
          <p>
            <Text strong>疗效:</Text>{' '}
            <Tag color={getStatusColor(c.outcome.status)}>
              {c.outcome.status}
            </Tag>
            <span style={{ marginLeft: 8 }}>
              成功率: {(c.outcome.successRate * 100).toFixed(0)}%
            </span>
          </p>
        </Card>

        <Card title="四诊信息" size="small" style={{ marginBottom: 16 }}>
          <Timeline>
            <Timeline.Item dot={<EyeOutlined />} color="blue">
              <Text strong>望诊</Text>
              <div style={{ marginTop: 4 }}>
                <Tag>类型: {c.diagnosis.inspection.taskType}</Tag>
                <Tag>复杂度: {c.diagnosis.inspection.complexity}</Tag>
              </div>
            </Timeline.Item>
            <Timeline.Item dot={<MedicineBoxOutlined />} color="green">
              <Text strong>闻诊</Text>
              <div style={{ marginTop: 4 }}>
                {c.diagnosis.auscultation.ambiguities.map((a, i) => (
                  <Tag key={i} color="orange">{a}</Tag>
                ))}
              </div>
            </Timeline.Item>
            <Timeline.Item dot={<FileTextOutlined />} color="purple">
              <Text strong>切诊</Text>
              <div style={{ marginTop: 4 }}>
                <p>置信度: {(c.diagnosis.palpation.confidence * 100).toFixed(0)}%</p>
                <p>风险等级: {c.diagnosis.palpation.riskLevel}</p>
                <p>治法: {c.diagnosis.palpation.approach}</p>
              </div>
            </Timeline.Item>
          </Timeline>
        </Card>

        <Card title="治疗方案" size="small" style={{ marginBottom: 16 }}>
          <p><Text strong>治法:</Text> {c.treatment.approach}</p>
          <p><Text strong>步骤:</Text></p>
          <ol>
            {c.treatment.steps.map((step, idx) => (
              <li key={idx}>{step.action} ({step.tool})</li>
            ))}
          </ol>
        </Card>

        {c.outcome.result && (
          <Card title="治疗结果" size="small" style={{ marginBottom: 16 }}>
            <p>{c.outcome.result}</p>
            <p>耗时: {(c.outcome.duration / 1000).toFixed(1)}秒</p>
          </Card>
        )}

        <Card title="经验教训" size="small">
          {c.lessons.strengths.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <Text strong type="success">优点:</Text>
              <ul>
                {c.lessons.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {c.lessons.weaknesses.length > 0 && (
            <div>
              <Text strong type="danger">改进点:</Text>
              <ul>
                {c.lessons.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </Card>
      </div>
    );
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '0 12px' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 16,
        padding: '12px 0',
        borderBottom: '1px solid var(--border)'
      }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <MedicineBoxOutlined style={{ marginRight: 8 }} />
            PulseFlow 医案中心
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            四诊合参 · 辨证论治 · 经验积累
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { loadCases(); loadStats(); }}>
          刷新
        </Button>
      </div>

      {selectedCase ? renderCaseDetail() : (
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <Tabs.TabPane 
            tab={<span><FileTextOutlined /> 医案记录 ({cases.length})</span>} 
            key="cases"
          >
            {renderCasesList()}
          </Tabs.TabPane>
          <Tabs.TabPane 
            tab={<span><BarChartOutlined /> 统计分析</span>} 
            key="stats"
          >
            {renderStatsPanel()}
          </Tabs.TabPane>
        </Tabs>
      )}
    </div>
  );
};
