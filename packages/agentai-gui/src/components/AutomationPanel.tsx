/**
 * AutomationPanel - 自动化任务管理面板
 * 
 * 功能：
 * 1. 查看所有定时任务列表
 * 2. 查看任务执行统计（成功率、执行次数等）
 * 3. 手动触发任务执行
 * 4. 暂停/恢复/删除任务
 * 5. 查看任务执行历史
 * 6. 创建新任务（基础）
 */
import React, { useState, useEffect } from 'react';
import {
  Card, Table, Button, Tag, Space, Modal, message, Spin,
  Statistic, Row, Col, Progress, Tooltip, Popconfirm,
  Form, Input, Select, InputNumber, Switch, Divider, Badge
} from 'antd';
import {
  PlayCircleOutlined, PauseCircleOutlined, DeleteOutlined,
  ReloadOutlined, PlusOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ClockCircleOutlined, BarChartOutlined,
  SettingOutlined, HistoryOutlined, ThunderboltOutlined
} from '@ant-design/icons';
import { gatewayFallback } from '../services/GatewayFallback';

const baseUrl = () => gatewayFallback.url || 'http://127.0.0.1:18789';

interface Schedule {
  id: string;
  name: string;
  description: string;
  type: 'rpa' | 'ai_task' | 'notification' | 'custom' | 'workflow';
  cron: string;
  status: 'active' | 'paused' | 'disabled';
  runCount: number;
  successCount: number;
  failCount: number;
  successRate: string;
  lastRunAt?: string;
  lastResult?: {
    success: boolean;
    error?: string;
    durationMs: number;
    attempts?: number;
  };
  maxRetries: number;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  createdAt: number;
}

interface ScheduleStats {
  total: number;
  active: number;
  paused: number;
  totalRuns: number;
  totalSuccess: number;
  totalFail: number;
  successRate: string;
}

const typeLabels: Record<string, string> = {
  rpa: 'RPA自动化',
  ai_task: 'AI任务',
  notification: '通知推送',
  custom: '自定义',
  workflow: '工作流',
};

const typeColors: Record<string, string> = {
  rpa: 'blue',
  ai_task: 'purple',
  notification: 'green',
  custom: 'orange',
  workflow: 'cyan',
};

export const AutomationPanel: React.FC = () => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [stats, setStats] = useState<ScheduleStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [form] = Form.useForm();

  // 加载任务列表
  const loadSchedules = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${baseUrl()}/v1/schedules`);
      const data = await response.json();
      if (data.success) {
        setSchedules(data.data);
      }
    } catch (error) {
      message.error('加载任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载统计
  const loadStats = async () => {
    try {
      const response = await fetch(`${baseUrl()}/v1/schedules/stats`);
      const data = await response.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch (error) {
      console.error('加载统计失败:', error);
    }
  };

  useEffect(() => {
    loadSchedules();
    loadStats();
    
    // 定时刷新
    const interval = setInterval(() => {
      loadSchedules();
      loadStats();
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  // 手动执行任务
  const runSchedule = async (id: string) => {
    try {
      message.loading({ content: '执行任务中...', key: id });
      const response = await fetch(`${baseUrl()}/v1/schedules/${id}/run`, {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        message.success({ content: '任务执行成功', key: id });
        loadSchedules();
        loadStats();
      } else {
        message.error({ content: `执行失败: ${data.data?.error || '未知错误'}`, key: id });
      }
    } catch (error) {
      message.error({ content: '执行请求失败', key: id });
    }
  };

  // 暂停任务
  const pauseSchedule = async (id: string) => {
    try {
      const response = await fetch(`${baseUrl()}/v1/schedules/${id}/pause`, {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        message.success('任务已暂停');
        loadSchedules();
      }
    } catch (error) {
      message.error('暂停失败');
    }
  };

  // 恢复任务
  const resumeSchedule = async (id: string) => {
    try {
      const response = await fetch(`${baseUrl()}/v1/schedules/${id}/resume`, {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        message.success('任务已恢复');
        loadSchedules();
      }
    } catch (error) {
      message.error('恢复失败');
    }
  };

  // 删除任务
  const deleteSchedule = async (id: string) => {
    try {
      const response = await fetch(`${baseUrl()}/v1/schedules/${id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      
      if (data.success) {
        message.success('任务已删除');
        loadSchedules();
        loadStats();
      }
    } catch (error) {
      message.error('删除失败');
    }
  };

  // 查看详情
  const viewDetail = async (id: string) => {
    try {
      const response = await fetch(`${baseUrl()}/v1/schedules/${id}`);
      const data = await response.json();
      
      if (data.success) {
        setSelectedSchedule(data.data);
        setDetailModalVisible(true);
      }
    } catch (error) {
      message.error('加载详情失败');
    }
  };

  // 创建任务
  const createSchedule = async (values: any) => {
    try {
      const response = await fetch(`${baseUrl()}/v1/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await response.json();
      
      if (data.success) {
        message.success('任务创建成功');
        setCreateModalVisible(false);
        form.resetFields();
        loadSchedules();
        loadStats();
      } else {
        message.error(`创建失败: ${data.error}`);
      }
    } catch (error) {
      message.error('创建请求失败');
    }
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Schedule) => (
        <div>
          <div style={{ fontWeight: 500 }}>{text}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{record.description}</div>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => (
        <Tag color={typeColors[type]}>{typeLabels[type] || type}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => {
        const statusMap: Record<string, { color: string; text: string; icon: any }> = {
          active: { color: 'success', text: '运行中', icon: CheckCircleOutlined },
          paused: { color: 'warning', text: '已暂停', icon: PauseCircleOutlined },
          disabled: { color: 'default', text: '已禁用', icon: CloseCircleOutlined },
        };
        const s = statusMap[status];
        return <Badge status={s.color as any} text={s.text} />;
      },
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      width: 100,
      render: (rate: string, record: Schedule) => (
        <Tooltip title={`成功: ${record.successCount}, 失败: ${record.failCount}`}>
          <Progress
            percent={parseFloat(rate)}
            size="small"
            status={parseFloat(rate) > 80 ? 'success' : parseFloat(rate) > 50 ? 'normal' : 'exception'}
          />
        </Tooltip>
      ),
    },
    {
      title: '执行次数',
      dataIndex: 'runCount',
      key: 'runCount',
      width: 90,
      render: (count: number) => <span style={{ fontFamily: 'monospace' }}>{count}</span>,
    },
    {
      title: '上次执行',
      dataIndex: 'lastRunAt',
      key: 'lastRunAt',
      width: 150,
      render: (time: string, record: Schedule) => {
        if (!time) return <span style={{ color: '#888' }}>从未</span>;
        const date = new Date(time);
        const isSuccess = record.lastResult?.success;
        return (
          <Space>
            <span>{date.toLocaleString()}</span>
            {record.lastResult && (
              <Tag color={isSuccess ? 'success' : 'error'}>
                {isSuccess ? '✓' : '✗'}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: Schedule) => (
        <Space size="small">
          <Tooltip title="立即执行">
            <Button
              type="text"
              icon={<PlayCircleOutlined />}
              onClick={() => runSchedule(record.id)}
            />
          </Tooltip>
          
          {record.status === 'active' ? (
            <Tooltip title="暂停">
              <Button
                type="text"
                icon={<PauseCircleOutlined />}
                onClick={() => pauseSchedule(record.id)}
              />
            </Tooltip>
          ) : (
            <Tooltip title="恢复">
              <Button
                type="text"
                icon={<CheckCircleOutlined />}
                onClick={() => resumeSchedule(record.id)}
              />
            </Tooltip>
          )}
          
          <Tooltip title="查看详情">
            <Button
              type="text"
              icon={<HistoryOutlined />}
              onClick={() => viewDetail(record.id)}
            />
          </Tooltip>
          
          <Popconfirm
            title="确认删除"
            description="删除后无法恢复，是否继续？"
            onConfirm={() => deleteSchedule(record.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '16px 24px', height: '100%', overflow: 'auto' }}>
      {/* 标题栏 */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThunderboltOutlined />
          自动化任务管理
        </h2>
        <p style={{ margin: '8px 0 0', color: '#666' }}>
          管理和监控所有定时任务，查看执行统计和成功率
        </p>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="总任务数"
                value={stats.total}
                prefix={<SettingOutlined />}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="运行中"
                value={stats.active}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="已暂停"
                value={stats.paused}
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="总执行次数"
                value={stats.totalRuns}
                prefix={<BarChartOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="整体成功率"
                value={stats.successRate}
                prefix={<CheckCircleOutlined />}
                valueStyle={{ 
                  color: parseFloat(stats.successRate) > 80 ? '#52c41a' : 
                         parseFloat(stats.successRate) > 50 ? '#faad14' : '#f5222d'
                }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 任务列表 */}
      <Card
        title={
          <Space>
            <ClockCircleOutlined />
            <span>任务列表</span>
            <Tag>{schedules.length}</Tag>
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => { loadSchedules(); loadStats(); }}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
            >
              新建任务
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={schedules}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          size="small"
        />
      </Card>

      {/* 详情弹窗 */}
      <Modal
        title="任务详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={600}
      >
        {selectedSchedule && (
          <div>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={12}>
                <Card size="small" title="基本信息">
                  <p><strong>ID:</strong> {selectedSchedule.id}</p>
                  <p><strong>名称:</strong> {selectedSchedule.name}</p>
                  <p><strong>类型:</strong> <Tag color={typeColors[selectedSchedule.type]}>{typeLabels[selectedSchedule.type]}</Tag></p>
                  <p><strong>状态:</strong> {selectedSchedule.status}</p>
                  <p><strong>Cron:</strong> <code>{selectedSchedule.cron}</code></p>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" title="执行统计">
                  <p><strong>总执行:</strong> {selectedSchedule.runCount}</p>
                  <p><strong>成功:</strong> <span style={{ color: '#52c41a' }}>{selectedSchedule.successCount}</span></p>
                  <p><strong>失败:</strong> <span style={{ color: '#f5222d' }}>{selectedSchedule.failCount}</span></p>
                  <p><strong>成功率:</strong> {selectedSchedule.successRate}</p>
                </Card>
              </Col>
            </Row>
            
            {selectedSchedule.lastResult && (
              <Card size="small" title="上次执行结果" style={{ marginBottom: 16 }}>
                <p><strong>状态:</strong> {selectedSchedule.lastResult.success ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>}</p>
                <p><strong>耗时:</strong> {selectedSchedule.lastResult.durationMs}ms</p>
                <p><strong>尝试次数:</strong> {selectedSchedule.lastResult.attempts || 1}</p>
                {selectedSchedule.lastResult.error && (
                  <p><strong>错误:</strong> <span style={{ color: '#f5222d' }}>{selectedSchedule.lastResult.error}</span></p>
                )}
              </Card>
            )}
            
            <Card size="small" title="配置">
              <p><strong>最大重试:</strong> {selectedSchedule.maxRetries}</p>
              <p><strong>失败通知:</strong> {selectedSchedule.notifyOnFailure ? '开启' : '关闭'}</p>
              <p><strong>成功通知:</strong> {selectedSchedule.notifyOnSuccess ? '开启' : '关闭'}</p>
            </Card>
          </div>
        )}
      </Modal>

      {/* 创建任务弹窗 */}
      <Modal
        title="新建定时任务"
        open={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
        onOk={() => form.submit()}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={createSchedule}
        >
          <Form.Item
            name="name"
            label="任务名称"
            rules={[{ required: true, message: '请输入任务名称' }]}
          >
            <Input placeholder="例如：每日数据备份" />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea placeholder="任务描述（可选）" />
          </Form.Item>
          
          <Form.Item
            name="type"
            label="任务类型"
            rules={[{ required: true }]}
            initialValue="ai_task"
          >
            <Select>
              <Select.Option value="rpa">RPA自动化</Select.Option>
              <Select.Option value="ai_task">AI任务</Select.Option>
              <Select.Option value="notification">通知推送</Select.Option>
              <Select.Option value="custom">自定义</Select.Option>
            </Select>
          </Form.Item>
          
          <Form.Item
            name="cron"
            label="Cron表达式"
            rules={[{ required: true, message: '请输入Cron表达式' }]}
            extra="例如：0 9 * * * (每天9点)"
          >
            <Input placeholder="0 9 * * *" />
          </Form.Item>
          
          <Form.Item
            name="maxRetries"
            label="最大重试次数"
            initialValue={0}
          >
            <InputNumber min={0} max={10} style={{ width: '100%' }} />
          </Form.Item>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="notifyOnFailure"
                label="失败时通知"
                valuePropName="checked"
                initialValue={true}
              >
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="notifyOnSuccess"
                label="成功时通知"
                valuePropName="checked"
                initialValue={false}
              >
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          
          <Divider />
          
          <Form.Item
            name={['config', 'aiMessage']}
            label="AI消息内容"
            extra="当任务类型为AI任务时填写"
          >
            <Input.TextArea placeholder="发送给AI的消息" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
