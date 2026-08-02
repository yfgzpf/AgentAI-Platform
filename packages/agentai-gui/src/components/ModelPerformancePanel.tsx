/**
 * ModelPerformancePanel - 模型性能对比面板
 * ==========================================
 * Phase 4: 完整的性能分析面板
 * 展示各模型的响应时间、成本、成功率等指标的对比
 */

import React, { useState } from 'react';
import { Card, Table, Statistic, Row, Col, Radio, Space, Tag, Tooltip, Button, message } from 'antd';
import { useModelMetrics } from '../hooks/useModelMetrics';
import { useModelStore } from '../store/modelStore';
import { 
  ClockCircleOutlined, 
  DollarOutlined, 
  CheckCircleOutlined,
  BarChartOutlined,
  ReloadOutlined,
  DownloadOutlined,
} from '@ant-design/icons';

// 导出CSV函数
const exportToCSV = async () => {
  try {
    const response = await fetch('/v1/metrics/export');
    if (!response.ok) {
      throw new Error('导出失败');
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `model-metrics-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    message.success('导出成功');
  } catch (error) {
    message.error('导出失败: ' + (error as Error).message);
  }
};

export const ModelPerformancePanel: React.FC = () => {
  const { metrics, loading, error, refresh } = useModelMetrics();
  const { models } = useModelStore();
  const [sortBy, setSortBy] = useState<'latency' | 'cost' | 'success'>('latency');

  // 合并模型配置和性能指标
  const data = models
    .filter(m => m.modelType === 'chat') // 只显示文本模型
    .map(m => {
      const metric = metrics.find(x => x.modelId === m.id);
      return {
        id: m.id,
        label: m.label,
        provider: m.provider,
        color: m.color,
        hasMetrics: !!metric && metric.totalCalls > 0,
        ...metric,
      };
    })
    .filter(d => d.hasMetrics) // 只显示有数据的模型
    .sort((a, b) => {
      if (sortBy === 'latency') return (a.avgLatency || 0) - (b.avgLatency || 0);
      if (sortBy === 'cost') return (a.avgCost || 0) - (b.avgCost || 0);
      if (sortBy === 'success') return (b.successRate || 0) - (a.successRate || 0);
      return 0;
    });

  const columns = [
    {
      title: '模型',
      key: 'model',
      render: (record: any) => (
        <Space>
          <span style={{ 
            display: 'inline-block', 
            width: 10, 
            height: 10, 
            borderRadius: '50%', 
            background: record.color 
          }} />
          <span>{record.label}</span>
          <Tag>{record.provider}</Tag>
        </Space>
      ),
    },
    {
      title: '调用次数',
      dataIndex: 'totalCalls',
      key: 'calls',
      sorter: (a: any, b: any) => a.totalCalls - b.totalCalls,
    },
    {
      title: '平均响应时间',
      key: 'latency',
      render: (record: any) => (
        <Space>
          <ClockCircleOutlined />
          {record.avgLatency > 0 
            ? `${(record.avgLatency / 1000).toFixed(2)}s` 
            : '-'}
        </Space>
      ),
      sorter: (a: any, b: any) => a.avgLatency - b.avgLatency,
    },
    {
      title: '平均成本',
      key: 'cost',
      render: (record: any) => (
        <Space>
          <DollarOutlined />
          {record.avgCost > 0 
            ? `¥${record.avgCost.toFixed(4)}` 
            : '-'}
        </Space>
      ),
      sorter: (a: any, b: any) => a.avgCost - b.avgCost,
    },
    {
      title: '成功率',
      key: 'success',
      render: (record: any) => (
        <Space>
          <CheckCircleOutlined />
          {record.successRate > 0 
            ? `${(record.successRate * 100).toFixed(1)}%` 
            : '-'}
        </Space>
      ),
      sorter: (a: any, b: any) => a.successRate - b.successRate,
    },
  ];

  // 计算汇总统计
  const totalCalls = data.reduce((sum, d) => sum + (d.totalCalls || 0), 0);
  const totalCost = data.reduce((sum, d) => sum + (d.totalCost || 0), 0);
  const avgSuccessRate = data.length > 0 
    ? data.reduce((sum, d) => sum + (d.successRate || 0), 0) / data.length 
    : 0;

  return (
    <div style={{ padding: 16 }}>
      <Card 
        title={
          <Space>
            <BarChartOutlined />
            模型性能对比
          </Space>
        }
        extra={
          <Space>
            <Radio.Group 
              value={sortBy} 
              onChange={e => setSortBy(e.target.value)}
              size="small"
            >
              <Radio.Button value="latency">按响应时间</Radio.Button>
              <Radio.Button value="cost">按成本</Radio.Button>
              <Radio.Button value="success">按成功率</Radio.Button>
            </Radio.Group>
            <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
            <Button size="small" icon={<DownloadOutlined />} onClick={exportToCSV}>导出CSV</Button>
          </Space>
        }
      >
        {/* 汇总统计 */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={8}>
            <Statistic 
              title="总调用次数" 
              value={totalCalls} 
              suffix="次"
            />
          </Col>
          <Col span={8}>
            <Statistic 
              title="累计成本" 
              value={totalCost.toFixed(4)} 
              prefix="¥"
            />
          </Col>
          <Col span={8}>
            <Statistic 
              title="平均成功率" 
              value={(avgSuccessRate * 100).toFixed(1)} 
              suffix="%"
            />
          </Col>
        </Row>

        {/* 详细表格 */}
        <Table 
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
        />

        {error && (
          <div style={{ marginTop: 16, color: 'red' }}>
            加载失败: {error}
          </div>
        )}

        {data.length === 0 && !loading && (
          <div style={{ marginTop: 16, textAlign: 'center', color: 'var(--muted-2)' }}>
            暂无性能数据，请先使用模型进行对话
          </div>
        )}
      </Card>
    </div>
  );
};
