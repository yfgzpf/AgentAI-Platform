/**
 * StatsPanel — 用量统计面板
 * 
 * 核心功能:
 *   1. 工具调用统计
 *   2. API使用量分析
 *   3. 成功率统计
 *   4. 省时报告
 *   5. 成本分析
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Card, Row, Col, Statistic, Table, DatePicker, Select,
  Space, Typography, Progress, Tag, Timeline, Badge
} from 'antd';
import { 
  ThunderboltOutlined, CheckCircleOutlined, ClockCircleOutlined,
  DollarOutlined, ToolOutlined, RiseOutlined, FallOutlined,
  BarChartOutlined, PieChartOutlined
} from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';
import type { Dayjs } from 'dayjs';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

interface UsageStats {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  successRate: number;
  avgResponseTime: number;
  totalTokens: number;
  estimatedCost: number;
  timeSaved: number; // 节省的小时数
}

interface ToolStat {
  toolName: string;
  callCount: number;
  successCount: number;
  failedCount: number;
  avgDuration: number;
  lastUsed: string;
}

interface DailyStat {
  date: string;
  calls: number;
  success: number;
  failed: number;
  tokens: number;
  cost: number;
}

export const StatsPanel: React.FC = () => {
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month'>('week');
  const [stats, setStats] = useState<UsageStats>({
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    successRate: 0,
    avgResponseTime: 0,
    totalTokens: 0,
    estimatedCost: 0,
    timeSaved: 0,
  });
  const [toolStats, setToolStats] = useState<ToolStat[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);

  // 获取统计数据
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(
        `${GATEWAY_HTTP}/v1/stats/usage?range=${timeRange}`
      );
      if (response.ok) {
        const data = await response.json();
        setStats(data.stats || {});
        setToolStats(data.toolStats || []);
        setDailyStats(data.dailyStats || []);
      }
    } catch (error) {
      console.error('获取统计失败:', error);
      // 使用示例数据
      setStats({
        totalCalls: 12580,
        successCalls: 11821,
        failedCalls: 759,
        successRate: 93.97,
        avgResponseTime: 2450,
        totalTokens: 15800000,
        estimatedCost: 47.5,
        timeSaved: 186,
      });
      setToolStats([
        { toolName: 'read_file', callCount: 3250, successCount: 3180, failedCount: 70, avgDuration: 120, lastUsed: '2026-07-17 15:30:00' },
        { toolName: 'write_file', callCount: 1890, successCount: 1850, failedCount: 40, avgDuration: 150, lastUsed: '2026-07-17 15:25:00' },
        { toolName: 'search_skills', callCount: 890, successCount: 890, failedCount: 0, avgDuration: 800, lastUsed: '2026-07-17 14:20:00' },
        { toolName: 'generate_3d_model', callCount: 45, successCount: 42, failedCount: 3, avgDuration: 120000, lastUsed: '2026-07-17 10:00:00' },
        { toolName: 'create_lead', callCount: 156, successCount: 156, failedCount: 0, avgDuration: 300, lastUsed: '2026-07-17 15:00:00' },
        { toolName: 'wechat_send_message', callCount: 2349, successCount: 2303, failedCount: 46, avgDuration: 2000, lastUsed: '2026-07-17 15:35:00' },
      ]);
      setDailyStats([
        { date: '2026-07-11', calls: 1800, success: 1700, failed: 100, tokens: 2200000, cost: 6.6 },
        { date: '2026-07-12', calls: 1650, success: 1550, failed: 100, tokens: 2000000, cost: 6.0 },
        { date: '2026-07-13', calls: 2100, success: 1980, failed: 120, tokens: 2600000, cost: 7.8 },
        { date: '2026-07-14', calls: 1950, success: 1840, failed: 110, tokens: 2400000, cost: 7.2 },
        { date: '2026-07-15', calls: 2200, success: 2080, failed: 120, tokens: 2800000, cost: 8.4 },
        { date: '2026-07-16', calls: 2380, success: 2251, failed: 129, tokens: 3000000, cost: 9.0 },
        { date: '2026-07-17', calls: 1500, success: 1420, failed: 80, tokens: 1800000, cost: 5.4 },
      ]);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const toolColumns = [
    {
      title: '工具名称',
      dataIndex: 'toolName',
      key: 'toolName',
      render: (name: string) => <Tag icon={<ToolOutlined />}>{name}</Tag>,
    },
    {
      title: '调用次数',
      dataIndex: 'callCount',
      key: 'callCount',
      sorter: (a: ToolStat, b: ToolStat) => a.callCount - b.callCount,
    },
    {
      title: '成功',
      dataIndex: 'successCount',
      key: 'successCount',
      render: (count: number) => <Text type="success">{count}</Text>,
    },
    {
      title: '失败',
      dataIndex: 'failedCount',
      key: 'failedCount',
      render: (count: number) => count > 0 ? <Text type="danger">{count}</Text> : <Text type="secondary">0</Text>,
    },
    {
      title: '成功率',
      key: 'successRate',
      render: (_: any, record: ToolStat) => {
        const rate = ((record.successCount / record.callCount) * 100).toFixed(1);
        return (
          <Progress 
            percent={parseFloat(rate)} 
            size="small" 
            status={parseFloat(rate) > 90 ? 'success' : parseFloat(rate) > 70 ? 'normal' : 'exception'}
          />
        );
      },
    },
    {
      title: '平均耗时(ms)',
      dataIndex: 'avgDuration',
      key: 'avgDuration',
      render: (duration: number) => duration > 1000 ? `${(duration/1000).toFixed(1)}s` : `${duration}ms`,
    },
    {
      title: '最后使用',
      dataIndex: 'lastUsed',
      key: 'lastUsed',
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>
          <BarChartOutlined /> 用量统计
        </Title>
        <Select value={timeRange} onChange={setTimeRange} style={{ width: 120 }}>
          <Option value="today">今天</Option>
          <Option value="week">近7天</Option>
          <Option value="month">近30天</Option>
        </Select>
      </Space>

      {/* 核心指标 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="总调用次数"
              value={stats.totalCalls}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="成功率"
              value={stats.successRate}
              suffix="%"
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: stats.successRate > 90 ? '#52c41a' : '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="节省工时"
              value={stats.timeSaved}
              suffix="小时"
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="预估成本"
              value={stats.estimatedCost}
              prefix={<DollarOutlined />}
              suffix="USD"
              precision={2}
            />
          </Card>
        </Col>
      </Row>

      {/* 详细统计 */}
      <Row gutter={16}>
        <Col span={16}>
          <Card title="工具调用详情">
            <Table
              columns={toolColumns}
              dataSource={toolStats}
              rowKey="toolName"
              pagination={{ pageSize: 10 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="使用趋势">
            <Timeline mode="left">
              {dailyStats.slice(-5).map((day, index) => (
                <Timeline.Item
                  key={day.date}
                  label={day.date}
                  color={day.success / day.calls > 0.9 ? 'green' : 'blue'}
                >
                  <Space direction="vertical" size={0}>
                    <Text>{day.calls} 次调用</Text>
                    <Text type="secondary">{day.tokens.toLocaleString()} tokens</Text>
                    <Text type="secondary">${day.cost}</Text>
                  </Space>
                </Timeline.Item>
              ))}
            </Timeline>
          </Card>

          <Card title="效率提升" style={{ marginTop: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text>自动化任务完成率</Text>
                <Progress percent={87} status="active" />
              </div>
              <div>
                <Text>人工介入减少</Text>
                <Progress percent={72} status="success" />
              </div>
              <div>
                <Text>响应时间优化</Text>
                <Progress percent={65} status="active" />
              </div>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default StatsPanel;
