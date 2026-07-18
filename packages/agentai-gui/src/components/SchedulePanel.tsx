/**
 * SchedulePanel — 定时任务调度面板
 * 
 * 核心功能:
 *   1. Cron表达式定时任务管理
 *   2. RPA自动化脚本定时执行
 *   3. AI任务自动化编排
 *   4. 执行历史与日志
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Table, Button, Modal, Form, Input, Select, Switch, 
  Tag, Space, Popconfirm, message, Card, Descriptions,
  Tabs, List, Typography, Badge
} from 'antd';
import { 
  PlusOutlined, PlayCircleOutlined, PauseCircleOutlined,
  DeleteOutlined, EditOutlined, HistoryOutlined,
  ClockCircleOutlined, RobotOutlined, ThunderboltOutlined
} from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

const { Option } = Select;
const { TabPane } = Tabs;
const { Text } = Typography;

interface ScheduledTask {
  id: string;
  name: string;
  type: 'cron' | 'rpa' | 'ai';
  schedule: string; // Cron表达式或描述
  command: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  status: 'idle' | 'running' | 'error';
  description?: string;
}

interface TaskExecution {
  id: string;
  taskId: string;
  taskName: string;
  startTime: string;
  endTime?: string;
  status: 'success' | 'failed' | 'running';
  output?: string;
  error?: string;
}

export const SchedulePanel: React.FC = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [form] = Form.useForm();

  // 获取任务列表
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${GATEWAY_HTTP}/v1/scheduler/tasks`);
      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks || []);
      }
    } catch (error) {
      console.error('获取任务列表失败:', error);
      // 使用示例数据
      setTasks([
        {
          id: '1',
          name: '每日微信客户跟进',
          type: 'rpa',
          schedule: '0 9 * * *',
          command: 'wechat:follow-up',
          enabled: true,
          lastRun: '2026-07-17 09:00:00',
          nextRun: '2026-07-18 09:00:00',
          status: 'idle',
          description: '每天早上9点自动跟进微信客户'
        },
        {
          id: '2',
          name: '线索自动评分',
          type: 'ai',
          schedule: '0 */2 * * *',
          command: 'lead:score-batch',
          enabled: true,
          lastRun: '2026-07-17 14:00:00',
          nextRun: '2026-07-17 16:00:00',
          status: 'idle',
          description: '每2小时自动评分新线索'
        },
        {
          id: '3',
          name: '营销数据备份',
          type: 'cron',
          schedule: '0 0 * * 0',
          command: 'backup:marketing-data',
          enabled: false,
          lastRun: '2026-07-13 00:00:00',
          status: 'idle',
          description: '每周日零点备份营销数据'
        }
      ]);
    }
    setLoading(false);
  }, []);

  // 获取执行历史
  const fetchExecutions = useCallback(async () => {
    try {
      const response = await fetch(`${GATEWAY_HTTP}/v1/scheduler/executions?limit=20`);
      if (response.ok) {
        const data = await response.json();
        setExecutions(data.executions || []);
      }
    } catch (error) {
      console.error('获取执行历史失败:', error);
      setExecutions([]);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchExecutions();
    // 定时刷新
    const interval = setInterval(() => {
      fetchTasks();
      fetchExecutions();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchTasks, fetchExecutions]);

  // 创建/编辑任务
  const handleSave = async (values: any) => {
    try {
      const url = editingTask 
        ? `${GATEWAY_HTTP}/v1/scheduler/tasks/${editingTask.id}`
        : `${GATEWAY_HTTP}/v1/scheduler/tasks`;
      
      const response = await fetch(url, {
        method: editingTask ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (response.ok) {
        message.success(editingTask ? '任务更新成功' : '任务创建成功');
        setModalVisible(false);
        fetchTasks();
      } else {
        message.error('保存失败');
      }
    } catch (error) {
      message.error('网络错误');
    }
  };

  // 删除任务
  const handleDelete = async (taskId: string) => {
    try {
      const response = await fetch(`${GATEWAY_HTTP}/v1/scheduler/tasks/${taskId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        message.success('任务删除成功');
        fetchTasks();
      }
    } catch (error) {
      message.error('删除失败');
    }
  };

  // 切换任务状态
  const handleToggle = async (task: ScheduledTask) => {
    try {
      const response = await fetch(`${GATEWAY_HTTP}/v1/scheduler/tasks/${task.id}/toggle`, {
        method: 'POST',
      });
      if (response.ok) {
        message.success(task.enabled ? '任务已暂停' : '任务已启用');
        fetchTasks();
      }
    } catch (error) {
      message.error('操作失败');
    }
  };

  // 立即执行任务
  const handleRunNow = async (task: ScheduledTask) => {
    try {
      const response = await fetch(`${GATEWAY_HTTP}/v1/scheduler/tasks/${task.id}/run`, {
        method: 'POST',
      });
      if (response.ok) {
        message.success('任务已触发执行');
        fetchExecutions();
      }
    } catch (error) {
      message.error('执行失败');
    }
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: ScheduledTask) => (
        <Space direction="vertical" size={0}>
          <Text strong>{text}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.description}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const icons = {
          cron: <ClockCircleOutlined />,
          rpa: <RobotOutlined />,
          ai: <ThunderboltOutlined />,
        };
        const labels = { cron: '定时', rpa: 'RPA', ai: 'AI' };
        return (
          <Tag icon={icons[type as keyof typeof icons]}>
            {labels[type as keyof typeof labels]}
          </Tag>
        );
      },
    },
    {
      title: '调度规则',
      dataIndex: 'schedule',
      key: 'schedule',
      render: (schedule: string) => <code>{schedule}</code>,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled: boolean, record: ScheduledTask) => (
        <Space>
          <Badge 
            status={enabled ? 'success' : 'default'} 
            text={enabled ? '启用' : '暂停'} 
          />
          {record.status === 'running' && (
            <Badge status="processing" text="执行中" />
          )}
        </Space>
      ),
    },
    {
      title: '上次执行',
      dataIndex: 'lastRun',
      key: 'lastRun',
      render: (time: string) => time || '-',
    },
    {
      title: '下次执行',
      dataIndex: 'nextRun',
      key: 'nextRun',
      render: (time: string) => time || '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: ScheduledTask) => (
        <Space>
          <Button
            icon={<PlayCircleOutlined />}
            size="small"
            onClick={() => handleRunNow(record)}
            disabled={record.status === 'running'}
          >
            执行
          </Button>
          <Button
            icon={record.enabled ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            size="small"
            onClick={() => handleToggle(record)}
          >
            {record.enabled ? '暂停' : '启用'}
          </Button>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => {
              setEditingTask(record);
              form.setFieldsValue(record);
              setModalVisible(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此任务？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button icon={<DeleteOutlined />} size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <Space>
            <ClockCircleOutlined />
            <span>定时任务调度</span>
          </Space>
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingTask(null);
              form.resetFields();
              setModalVisible(true);
            }}
          >
            新建任务
          </Button>
        }
      >
        <Tabs defaultActiveKey="tasks">
          <TabPane tab="任务列表" key="tasks">
            <Table
              columns={columns}
              dataSource={tasks}
              rowKey="id"
              loading={loading}
              pagination={{ pageSize: 10 }}
            />
          </TabPane>
          <TabPane tab="执行历史" key="history">
            <List
              dataSource={executions}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space>
                        <Text strong>{item.taskName}</Text>
                        <Tag color={item.status === 'success' ? 'success' : item.status === 'failed' ? 'error' : 'processing'}>
                          {item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '执行中'}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={0}>
                        <Text type="secondary">开始: {item.startTime}</Text>
                        {item.endTime && <Text type="secondary">结束: {item.endTime}</Text>}
                        {item.output && <Text code>{item.output.substring(0, 100)}...</Text>}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </TabPane>
        </Tabs>
      </Card>

      <Modal
        title={editingTask ? '编辑任务' : '新建任务'}
        visible={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => setModalVisible(false)}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
        >
          <Form.Item
            name="name"
            label="任务名称"
            rules={[{ required: true, message: '请输入任务名称' }]}
          >
            <Input placeholder="例如：每日微信客户跟进" />
          </Form.Item>

          <Form.Item
            name="type"
            label="任务类型"
            rules={[{ required: true }]}
          >
            <Select placeholder="选择任务类型">
              <Option value="cron">定时任务 (Cron)</Option>
              <Option value="rpa">RPA自动化</Option>
              <Option value="ai">AI任务</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="schedule"
            label="调度规则 (Cron表达式)"
            rules={[{ required: true, message: '请输入Cron表达式' }]}
            extra="例如：0 9 * * * 表示每天早上9点"
          >
            <Input placeholder="0 9 * * *" />
          </Form.Item>

          <Form.Item
            name="command"
            label="执行命令"
            rules={[{ required: true, message: '请输入执行命令' }]}
          >
            <Input placeholder="例如：wechat:follow-up" />
          </Form.Item>

          <Form.Item
            name="description"
            label="任务描述"
          >
            <Input.TextArea rows={2} placeholder="任务功能描述..." />
          </Form.Item>

          <Form.Item
            name="enabled"
            label="立即启用"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SchedulePanel;
