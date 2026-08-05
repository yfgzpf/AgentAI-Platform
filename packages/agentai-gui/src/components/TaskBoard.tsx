/**
 * TaskBoard — 实时任务板 (对标 Trae TodoWrite)
 * ==============================================
 * 核心能力:
 *   1. 实时 SSE 监听: agent_task:created/updated/completed/failed
 *   2. 任务卡片: 拖拽式状态流转 + 一键创建下一步
 *   3. 自动提示引导: 任务完成后自动推荐下一步
 *   4. 上下文记忆: 跨会话任务连续性
 *
 * 对标 Trae TodoWrite:
 *   - TodoWrite(tool_name, todos) → agent:task:create/update
 *   - 任务完成 → 自动提示下一步
 *   - 跨会话持久化 → SQLite agent-tasks.db
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Card, List, Tag, Button, Space, Typography, Badge, Progress,
  Tooltip, Popconfirm, message, Avatar, Empty, Alert, Modal, Input,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined,
  PlusOutlined, DeleteOutlined, BulbOutlined, ClockCircleOutlined,
  RobotOutlined, ArrowRightOutlined, ReloadOutlined,
  CheckOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

const { Text, Title } = Typography;

// ===== Types =====
interface TaskCard {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  tags: string[];
  result?: string;
  nextStepHint?: string;
  createdAt: number;
  completedAt?: number;
}

interface TaskCounts {
  pending: number;
  running: number;
  done: number;
  failed: number;
}

// ===== Component =====
export const TaskBoard: React.FC = () => {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [counts, setCounts] = useState<TaskCounts>({ pending: 0, running: 0, done: 0, failed: 0 });
  const [loading, setLoading] = useState(false);
  const [newTaskVisible, setNewTaskVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [nextSteps, setNextSteps] = useState<string[]>([]);
  const [pendingTasks, setPendingTasks] = useState<TaskCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const GW = GATEWAY_HTTP;

  // ── 拉取任务 ──
  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const [tasksRes, countsRes, nextRes] = await Promise.all([
        fetch(`${GW}/v1/agent-tasks?limit=20`),
        fetch(`${GW}/v1/agent-tasks?limit=1`),
        fetch(`${GW}/v1/agent-tasks/next`),
      ]);
      if (tasksRes.ok) {
        const j = await tasksRes.json();
        setTasks(j.tasks || []);
        setCounts(j.counts || { pending: 0, running: 0, done: 0, failed: 0 });
      }
      if (nextRes.ok) {
        const j = await nextRes.json();
        setNextSteps(j.nextSteps || []);
        setPendingTasks(j.pendingTasks || []);
      }
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [GW]);

  // ── SSE 实时推送 ──
  useEffect(() => {
    fetchTasks();
    const es = new EventSource(`${GW}/v1/agent-tasks/stream`);
    eventSourceRef.current = es;

    es.addEventListener('agent_task:created', (e: any) => {
      const task: TaskCard = JSON.parse(e.data);
      setTasks(prev => [task, ...prev]);
      setCounts(prev => ({ ...prev, [task.status]: prev[task.status] + 1 }));
      message.success(`📋 新任务: ${task.title}`);
    });

    es.addEventListener('agent_task:updated', (e: any) => {
      const task: TaskCard = JSON.parse(e.data);
      setTasks(prev => prev.map(t => t.id === task.id ? task : t));
    });

    es.addEventListener('agent_task:completed', (e: any) => {
      const { task, nextSteps: steps } = JSON.parse(e.data);
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'done', result: task.result, completedAt: Date.now() } : t));
      if (steps.length > 0) {
        setNextSteps(steps);
        message.success(`✅ ${steps[0]}`, 3);
      }
    });

    es.addEventListener('agent_task:failed', (e: any) => {
      const { task } = JSON.parse(e.data);
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'failed', result: task.result, completedAt: Date.now() } : t));
    });

    return () => { es.close(); eventSourceRef.current = null; };
  }, [GW]);

  // ── 创建任务 ──
  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch(`${GW}/v1/agent-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, description: newDesc || undefined, tags: ['manual'] }),
      });
      if (res.ok) {
        message.success('任务已创建');
        setNewTaskVisible(false);
        setNewTitle('');
        setNewDesc('');
        fetchTasks();
      }
    } catch (e: any) {
      message.error(`创建失败: ${e.message}`);
    }
  };

  // ── 完成任务 + 引导下一步 ──
  const handleComplete = async (taskId: string) => {
    try {
      const res = await fetch(`${GW}/v1/agent-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', taskId }),
      });
      if (res.ok) fetchTasks();
    } catch (e: any) {
      message.error(`完成失败: ${e.message}`);
    }
  };

  // ── 删除任务 ──
  const handleDelete = async (taskId: string) => {
    try {
      await fetch(`${GW}/v1/agent-tasks/${taskId}`, { method: 'DELETE' });
      setTasks(prev => prev.filter(t => t.id !== taskId));
      message.success('任务已删除');
    } catch (e: any) {
      message.error(`删除失败: ${e.message}`);
    }
  };

  // ── 状态颜色 ──
  const statusConfig = {
    pending: { color: 'default', icon: <ClockCircleOutlined />, label: '待办' },
    running: { color: 'processing', icon: <LoadingOutlined spin />, label: '执行中' },
    done: { color: 'success', icon: <CheckCircleOutlined />, label: '完成' },
    failed: { color: 'error', icon: <CloseCircleOutlined />, label: '失败' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            <RobotOutlined /> 任务板
          </Title>
          <Badge count={counts.pending + counts.running} color="blue" />
        </Space>
        <Space>
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} size="small" onClick={fetchTasks} />
          </Tooltip>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => setNewTaskVisible(true)}
          >
            新建任务
          </Button>
        </Space>
      </div>

      {/* 统计行 */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { label: '待办', key: 'pending', color: '#d9d9d9' },
          { label: '执行中', key: 'running', color: '#1677ff' },
          { label: '完成', key: 'done', color: '#52c41a' },
          { label: '失败', key: 'failed', color: '#ff4d4f' },
        ].map(({ label, key, color }) => (
          <div key={key} style={{ flex: 1, textAlign: 'center', padding: '4px 8px', background: `${color}20`, borderRadius: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color }}>{counts[key as keyof TaskCounts]}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* 错误 */}
      {error && (
        <Alert type="error" message={error} showIcon closable />
      )}

      {/* 下一步引导 */}
      {nextSteps.length > 0 && (
        <Alert
          type="info"
          icon={<BulbOutlined />}
          message="下一步推荐"
          description={
            <List size="small" dataSource={nextSteps} renderItem={step => (
              <List.Item>
                <Text style={{ fontSize: 12 }}>{step}</Text>
                <ArrowRightOutlined style={{ marginLeft: 8, color: '#1677ff' }} />
              </List.Item>
            )} />
          }
          showIcon
        />
      )}

      {/* 任务列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <LoadingOutlined style={{ fontSize: 24 }} />
        </div>
      ) : tasks.length === 0 ? (
        <Empty description="暂无任务" />
      ) : (
        <List
          dataSource={tasks}
          renderItem={task => {
            const cfg = statusConfig[task.status];
            return (
              <List.Item
                style={{
                  background: task.status === 'running' ? '#e6f4ff' : task.status === 'failed' ? '#fff2f0' : 'transparent',
                  borderRadius: 6,
                  padding: '8px 12px',
                  marginBottom: 4,
                }}
                extra={
                  <Space>
                    {task.status !== 'done' && task.status !== 'failed' && (
                      <Tooltip title="标记完成">
                        <Button
                          type="text"
                          icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                          size="small"
                          onClick={() => handleComplete(task.id)}
                        />
                      </Tooltip>
                    )}
                    <Tooltip title="删除">
                      <Popconfirm
                        title="确定删除此任务?"
                        onConfirm={() => handleDelete(task.id)}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                      </Popconfirm>
                    </Tooltip>
                  </Space>
                }
              >
                <List.Item.Meta
                  avatar={<Avatar style={{ background: cfg.color, color: '#fff' }}>{cfg.icon}</Avatar>}
                  title={
                    <Space>
                      <Text strong>{task.title}</Text>
                      <Tag color={cfg.color}>{cfg.label}</Tag>
                      {task.tags.map(tag => (
                        <Tag key={tag} style={{ fontSize: 10 }}>{tag}</Tag>
                      ))}
                    </Space>
                  }
                  description={
                    <div>
                      {task.description && <Text type="secondary" style={{ fontSize: 12 }}>{task.description}</Text>}
                      {task.result && (
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                          结果: {(task.result as string).slice(0, 100)}...
                        </Text>
                      )}
                      <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
                        {new Date(task.createdAt).toLocaleString()}
                      </Text>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}

      {/* 新建任务 Modal */}
      <Modal
        title={<Space><PlusOutlined />新建任务</Space>}
        open={newTaskVisible}
        onCancel={() => setNewTaskVisible(false)}
        onOk={handleCreate}
        okText="创建"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Input
            placeholder="任务标题 (必填)"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onPressEnter={handleCreate}
          />
          <Input.TextArea
            placeholder="任务描述 (可选)"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            rows={3}
          />
        </Space>
      </Modal>
    </div>
  );
};
