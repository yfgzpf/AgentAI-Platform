import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Progress, List, Tag, Button, Badge, Timeline, Statistic, Empty, Spin } from 'antd';
import { 
  BookOutlined, 
  GithubOutlined, 
  BulbOutlined, 
  SyncOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExperimentOutlined,
  StarOutlined,
  ForkOutlined,
  FileTextOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { apiGet, apiPost } from '../services/api';

interface KnowledgeGap {
  concept: string;
  domain: string;
  confidence: number;
  priority: number;
}

interface Repository {
  name: string;
  owner: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  quality: {
    overall: number;
    knowledgeDensity: number;
    documentation: number;
  };
}

interface KnowledgeNode {
  id: string;
  concept: string;
  domain: string;
  description: string;
  confidence: number;
  sources: Array<{
    type: string;
    url: string;
    title: string;
  }>;
  createdAt: number;
}

interface ExplorationStats {
  totalExplorations: number;
  totalReposExplored: number;
  totalKnowledgeNodes: number;
  averageConfidence: number;
  recentActivity: Array<{
    type: 'gap_detected' | 'exploration' | 'distillation';
    concept: string;
    timestamp: number;
  }>;
}

export const KnowledgeDashboard: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'gaps' | 'repos' | 'knowledge'>('overview');
  const [stats, setStats] = useState<ExplorationStats | null>(null);
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);

  // 加载数据
  useEffect(() => {
    loadStats();
    loadKnowledgeNodes();
  }, []);

  const loadStats = async () => {
    try {
      const data = await apiGet('/v1/knowledge/explore-stats');
      setStats(data?.data || null);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadKnowledgeNodes = async () => {
    try {
      const data = await apiGet('/v1/knowledge/nodes');
      setKnowledgeNodes(data?.data || []);
    } catch (error) {
      console.error('Failed to load knowledge nodes:', error);
    }
  };

  // 手动触发探索
  const handleExplore = async (concept: string) => {
    setLoading(true);
    try {
      const data = await apiPost('/v1/knowledge/explore', { concept });
      setRepos(data?.data?.repositories || []);
      setActiveTab('repos');
    } catch (error) {
      console.error('Exploration failed:', error);
    } finally {
      setLoading(false);
    }
  };

  // 渲染概览页
  const renderOverview = () => (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="探索次数"
              value={stats?.totalExplorations || 0}
              prefix={<ExperimentOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="探索仓库"
              value={stats?.totalReposExplored || 0}
              prefix={<GithubOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="知识节点"
              value={stats?.totalKnowledgeNodes || 0}
              prefix={<BookOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均置信度"
              value={Math.round((stats?.averageConfidence || 0) * 100)}
              suffix="%"
              prefix={<BulbOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card 
            title="最近活动" 
            extra={<Button type="link" icon={<SyncOutlined />}>刷新</Button>}
          >
            {stats?.recentActivity?.length ? (
              <Timeline
                items={stats.recentActivity.slice(0, 10).map(activity => ({
                  color: activity.type === 'distillation' ? 'green' : 
                         activity.type === 'exploration' ? 'blue' : 'orange',
                  dot: activity.type === 'distillation' ? <CheckCircleOutlined /> : 
                       activity.type === 'exploration' ? <GithubOutlined /> : <BulbOutlined />,
                  children: (
                    <>
                      <p style={{ marginBottom: 4 }}>
                        <Tag color={activity.type === 'distillation' ? 'success' : 
                                   activity.type === 'exploration' ? 'processing' : 'warning'}>
                          {activity.type === 'distillation' ? '知识蒸馏' : 
                           activity.type === 'exploration' ? '仓库探索' : '缺口检测'}
                        </Tag>
                        <strong>{activity.concept}</strong>
                      </p>
                      <p style={{ color: '#999', fontSize: 12 }}>
                        <ClockCircleOutlined /> {new Date(activity.timestamp).toLocaleString()}
                      </p>
                    </>
                  ),
                }))}
              />
            ) : (
              <Empty description="暂无活动记录" />
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="知识分布">
            {knowledgeNodes.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Array.from(new Set(knowledgeNodes.map(n => n.domain))).map(domain => {
                  const count = knowledgeNodes.filter(n => n.domain === domain).length;
                  return (
                    <Badge key={domain} count={count}>
                      <Tag color="blue" style={{ padding: '4px 12px' }}>
                        {domain}
                      </Tag>
                    </Badge>
                  );
                })}
              </div>
            ) : (
              <Empty description="暂无知识节点" />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );

  // 渲染知识缺口页
  const renderGaps = () => (
    <Card title="知识缺口检测" loading={loading}>
      {gaps.length > 0 ? (
        <List
          dataSource={gaps}
          renderItem={gap => (
            <List.Item
              actions={[
                <Button 
                  type="primary" 
                  size="small"
                  icon={<GithubOutlined />}
                  onClick={() => handleExplore(gap.concept)}
                >
                  探索
                </Button>
              ]}
            >
              <List.Item.Meta
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{gap.concept}</span>
                    <Tag color={gap.priority > 0.7 ? 'red' : gap.priority > 0.4 ? 'orange' : 'default'}>
                      {gap.domain}
                    </Tag>
                  </div>
                }
                description={
                  <div style={{ marginTop: 8 }}>
                    <div style={{ marginBottom: 4 }}>
                      当前掌握度: <Progress percent={Math.round(gap.confidence * 100)} size="small" />
                    </div>
                    <div>
                      优先级: <Progress percent={Math.round(gap.priority * 100)} size="small" status="exception" />
                    </div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      ) : (
        <Empty description="暂无检测到的知识缺口" />
      )}
    </Card>
  );

  // 渲染仓库页
  const renderRepos = () => (
    <Card title="探索到的仓库" loading={loading}>
      {repos.length > 0 ? (
        <List
          grid={{ gutter: 16, column: 2 }}
          dataSource={repos}
          renderItem={repo => (
            <List.Item>
              <Card
                size="small"
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <GithubOutlined />
                    <a href={repo.url} target="_blank" rel="noopener noreferrer">
                      {repo.owner}/{repo.name}
                    </a>
                  </div>
                }
                extra={
                  <Tag color={repo.quality.overall > 0.7 ? 'success' : 'processing'}>
                    {Math.round(repo.quality.overall * 100)}分
                  </Tag>
                }
              >
                <p style={{ color: '#666', marginBottom: 8 }}>{repo.description}</p>
                <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                  <span><StarOutlined /> {repo.stars}</span>
                  <span><ForkOutlined /> {repo.forks}</span>
                  <span><FileTextOutlined /> {repo.language}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Progress 
                    percent={Math.round(repo.quality.knowledgeDensity * 100)} 
                    size="small" 
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 12, color: '#999' }}>知识密度</span>
                </div>
              </Card>
            </List.Item>
          )}
        />
      ) : (
        <Empty description="暂无探索结果" />
      )}
    </Card>
  );

  // 渲染知识节点页
  const renderKnowledge = () => (
    <Card title="已学习的知识">
      {knowledgeNodes.length > 0 ? (
        <List
          dataSource={knowledgeNodes}
          renderItem={node => (
            <List.Item
              actions={[
                <Button type="link" icon={<LinkOutlined />} href={node.sources[0]?.url} target="_blank">
                  来源
                </Button>
              ]}
            >
              <List.Item.Meta
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{node.concept}</span>
                    <Tag>{node.domain}</Tag>
                    <Progress 
                      percent={Math.round(node.confidence * 100)} 
                      size="small" 
                      style={{ width: 100 }}
                    />
                  </div>
                }
                description={node.description}
              />
            </List.Item>
          )}
        />
      ) : (
        <Empty description="暂无知识节点" />
      )}
    </Card>
  );

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <Button 
          type={activeTab === 'overview' ? 'primary' : 'default'}
          icon={<BulbOutlined />}
          onClick={() => setActiveTab('overview')}
        >
          概览
        </Button>
        <Button 
          type={activeTab === 'gaps' ? 'primary' : 'default'}
          icon={<ExperimentOutlined />}
          onClick={() => setActiveTab('gaps')}
        >
          知识缺口
        </Button>
        <Button 
          type={activeTab === 'repos' ? 'primary' : 'default'}
          icon={<GithubOutlined />}
          onClick={() => setActiveTab('repos')}
        >
          仓库探索
        </Button>
        <Button 
          type={activeTab === 'knowledge' ? 'primary' : 'default'}
          icon={<BookOutlined />}
          onClick={() => setActiveTab('knowledge')}
        >
          知识库
        </Button>
      </div>

      <Spin spinning={loading}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'gaps' && renderGaps()}
        {activeTab === 'repos' && renderRepos()}
        {activeTab === 'knowledge' && renderKnowledge()}
      </Spin>
    </div>
  );
};

export default KnowledgeDashboard;
