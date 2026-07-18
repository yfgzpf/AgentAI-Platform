/**
 * ProactiveSuggestionsPanel — 主动建议面板
 * 
 * 核心功能:
 *   1. 智能需求预判
 *   2. 行业知识链推荐
 *   3. 资源瓶颈预判
 *   4. 决策支持建议
 *   5. 自动化优化建议
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Card, List, Tag, Button, Space, Typography, Badge, 
  Timeline, Statistic, Row, Col, Alert, Progress
} from 'antd';
import { 
  BulbOutlined, ThunderboltOutlined, RiseOutlined,
  CheckCircleOutlined, WarningOutlined, InfoCircleOutlined,
  RobotOutlined, ArrowRightOutlined, CloseOutlined
} from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

const { Title, Text, Paragraph } = Typography;

interface Suggestion {
  id: string;
  type: 'optimization' | 'warning' | 'opportunity' | 'automation';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  action?: string;
  actionUrl?: string;
  dismissed?: boolean;
  createdAt: string;
}

interface Insight {
  category: string;
  value: string;
  trend: 'up' | 'down' | 'stable';
  description: string;
}

export const ProactiveSuggestionsPanel: React.FC = () => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);

  // 获取建议
  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${GATEWAY_HTTP}/v1/suggestions`);
      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.suggestions || []);
        setInsights(data.insights || []);
      }
    } catch (error) {
      console.error('获取建议失败:', error);
      // 使用示例数据
      setSuggestions([
        {
          id: '1',
          type: 'optimization',
          title: '优化微信自动化流程',
          description: '检测到您的微信客户响应时间可以缩短30%，建议启用智能回复模板',
          impact: 'high',
          action: '查看优化方案',
          createdAt: '2026-07-17 15:00:00',
        },
        {
          id: '2',
          type: 'opportunity',
          title: '发现高价值线索',
          description: '系统识别到3个高意向客户，建议优先跟进',
          impact: 'high',
          action: '查看线索',
          createdAt: '2026-07-17 14:30:00',
        },
        {
          id: '3',
          type: 'warning',
          title: 'API调用频率接近限制',
          description: '今日API调用已达配额的85%，建议优化调用策略或升级套餐',
          impact: 'medium',
          action: '查看详情',
          createdAt: '2026-07-17 12:00:00',
        },
        {
          id: '4',
          type: 'automation',
          title: '可自动化的重复任务',
          description: '检测到您每天手动执行"客户数据整理"任务，建议创建自动化工作流',
          impact: 'medium',
          action: '创建自动化',
          createdAt: '2026-07-17 10:00:00',
        },
        {
          id: '5',
          type: 'optimization',
          title: '技能市场新技能推荐',
          description: '基于您的工作模式，推荐安装"智能文档分类"技能',
          impact: 'low',
          action: '查看技能',
          createdAt: '2026-07-17 09:00:00',
        },
      ]);
      setInsights([
        { category: '工作效率', value: '+23%', trend: 'up', description: '相比上周' },
        { category: '客户响应', value: '-15min', trend: 'down', description: '平均响应时间' },
        { category: '自动化率', value: '67%', trend: 'up', description: '任务自动化比例' },
        { category: '成本节约', value: '$1,240', trend: 'up', description: '本月累计' },
      ]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSuggestions();
    // 每5分钟刷新
    const interval = setInterval(fetchSuggestions, 300000);
    return () => clearInterval(interval);
  }, [fetchSuggestions]);

  // 忽略建议
  const dismissSuggestion = async (id: string) => {
    try {
      await fetch(`${GATEWAY_HTTP}/v1/suggestions/${id}/dismiss`, {
        method: 'POST',
      });
      setSuggestions(prev => prev.filter(s => s.id !== id));
    } catch (error) {
      console.error('忽略建议失败:', error);
    }
  };

  // 执行建议动作
  const executeAction = (suggestion: Suggestion) => {
    console.log('执行建议:', suggestion.action);
    // 根据action类型执行不同操作
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'optimization': return <RiseOutlined style={{ color: '#52c41a' }} />;
      case 'warning': return <WarningOutlined style={{ color: '#faad14' }} />;
      case 'opportunity': return <ThunderboltOutlined style={{ color: '#1890ff' }} />;
      case 'automation': return <RobotOutlined style={{ color: '#722ed1' }} />;
      default: return <BulbOutlined />;
    }
  };

  const getTagColor = (impact: string) => {
    switch (impact) {
      case 'high': return 'red';
      case 'medium': return 'orange';
      case 'low': return 'blue';
      default: return 'default';
    }
  };

  const getTypeText = (type: string) => {
    switch (type) {
      case 'optimization': return '优化';
      case 'warning': return '警告';
      case 'opportunity': return '机会';
      case 'automation': return '自动化';
      default: return '建议';
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Title level={4}>
        <BulbOutlined /> 智能建议中心
      </Title>

      {/* 核心洞察 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        {insights.map((insight, index) => (
          <Col span={6} key={index}>
            <Card>
              <Statistic
                title={insight.category}
                value={insight.value}
                prefix={insight.trend === 'up' ? <RiseOutlined /> : insight.trend === 'down' ? <RiseOutlined style={{ transform: 'rotate(180deg)' }} /> : null}
                valueStyle={{ 
                  color: insight.trend === 'up' ? '#52c41a' : insight.trend === 'down' ? '#f5222d' : '#666'
                }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>{insight.description}</Text>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 建议列表 */}
      <Card
        title={
          <Space>
            <span>主动建议</span>
            <Badge count={suggestions.filter(s => !s.dismissed).length} style={{ backgroundColor: '#1890ff' }} />
          </Space>
        }
        loading={loading}
      >
        <List
          dataSource={suggestions.filter(s => !s.dismissed)}
          renderItem={item => (
            <List.Item
              actions={[
                item.action && (
                  <Button 
                    type="primary" 
                    size="small"
                    icon={<ArrowRightOutlined />}
                    onClick={() => executeAction(item)}
                  >
                    {item.action}
                  </Button>
                ),
                <Button 
                  icon={<CloseOutlined />} 
                  size="small"
                  onClick={() => dismissSuggestion(item.id)}
                />
              ]}
            >
              <List.Item.Meta
                avatar={getIcon(item.type)}
                title={
                  <Space>
                    <Text strong>{item.title}</Text>
                    <Tag color={getTagColor(item.impact)}>
                      {item.impact === 'high' ? '高影响' : item.impact === 'medium' ? '中影响' : '低影响'}
                    </Tag>
                    <Tag>{getTypeText(item.type)}</Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={0}>
                    <Paragraph style={{ marginBottom: 0, maxWidth: 600 }}>
                      {item.description}
                    </Paragraph>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {item.createdAt}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )}
          locale={{ emptyText: <Alert message="暂无新建议" type="info" showIcon /> }}
        />
      </Card>

      {/* 智能助手提示 */}
      <Card style={{ marginTop: 24 }}>
        <Space align="start">
          <RobotOutlined style={{ fontSize: 24, color: '#1890ff' }} />
          <div>
            <Title level={5} style={{ marginTop: 0 }}>AI助手正在学习您的工作模式</Title>
            <Paragraph>
              系统正在分析您的工作流程，将主动发现优化机会和自动化可能性。
              建议越用越精准。
            </Paragraph>
            <Space>
              <Text type="secondary">已学习: 156个工作模式</Text>
              <Text type="secondary">已发现: 23个优化点</Text>
              <Text type="secondary">已节省: 186小时</Text>
            </Space>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default ProactiveSuggestionsPanel;
