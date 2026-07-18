/**
 * TaskCenterPanel — 统一任务中心
 * ===================================
 * 整合: 长任务快照 + 定时任务 + 工作流 + 执行日志
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Card, Table, Tag, Space, Button, Modal, message, Spin, Statistic, Row, Col,
  Progress, Tooltip, Popconfirm, Empty, Tabs, Timeline, Drawer, Alert, Switch,
  Collapse, Descriptions,
} from 'antd';
import {
  ReloadOutlined, PlayCircleOutlined, DeleteOutlined, CheckCircleOutlined,
  CloseCircleOutlined, PauseCircleOutlined, EyeOutlined, HistoryOutlined,
  ClearOutlined, ThunderboltOutlined, FileTextOutlined, BulbOutlined,
  ClockCircleOutlined, FlagOutlined, ApiOutlined, ScheduleOutlined,
  NodeIndexOutlined, FileSearchOutlined, CheckOutlined, StopOutlined,
} from '@ant-design/icons';
import { useTaskResumeStore } from '../store/taskResumeStore';
import {
  taskDuration, taskIdleMin, statusLabel, statusColor,
  type TaskMeta, type TaskSnapshot, type TaskStatus,
} from '../services/tasksApi';
import { io, Socket } from 'socket.io-client';

export const TaskCenterPanel: React.FC = () => {
  const {
    allTasks, resumableTasks, currentTask, loading, error,
    activeTaskId, lastRefreshAt,
    refreshAll, loadTask, markCompleted, markFailed, deleteTask, cleanupOld, setActiveTaskId, clearError,
  } = useTaskResumeStore();

  const [detailVisible, setDetailVisible] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all');
  const [activeTab, setActiveTab] = useState('resumable');

  // 定时任务状态
  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const loadSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    try {
      const r = await fetch('/v1/schedules');
      if (r.ok) { const j = await r.json(); setSchedules(j.data || []); }
    } catch { /* silent */ }
    setSchedulesLoading(false);
  }, []);

  // 工作流状态
  const [workflowTemplates, setWorkflowTemplates] = useState<any[]>([]);
  const [workflowExecs, setWorkflowExecs] = useState<any[]>([]);
  const loadWorkflows = useCallback(async () => {
    try {
      const [tr, er] = await Promise.all([
        fetch('/v1/workflows/templates'),
        fetch('/v1/workflows/executions?limit=10'),
      ]);
      if (tr.ok) { const j = await tr.json(); setWorkflowTemplates(j.templates || []); }
      if (er.ok) { const j = await er.json(); setWorkflowExecs(j.executions || []); }
    } catch { /* silent */ }
  }, []);

  // 执行日志状态 - 从工作流执行历史和自动化任务历史合并
  const [execLogs, setExecLogs] = useState<any[]>([]);
  const loadExecLogs = useCallback(async () => {
    try {
      const [wfRes, autoRes] = await Promise.all([
        fetch('/v1/workflows/executions?limit=20'),
        fetch('/v1/automations'),
      ]);
      const logs: any[] = [];
      if (wfRes.ok) {
        const j = await wfRes.json();
        (j.executions || []).forEach((e: any) => {
          logs.push({
            time: e.completedAt || e.startedAt,
            source: 'workflow',
            name: e.templateName,
            status: e.status === 'completed' ? 'success' : e.status === 'failed' ? 'failed' : e.status,
            duration: e.completedAt && e.startedAt ? e.completedAt - e.startedAt : undefined,
            error: e.error,
          });
        });
      }
      if (autoRes.ok) {
        const j = await autoRes.json();
        (j.automations || []).forEach((a: any) => {
          if (a.lastResult) {
            logs.push({
              time: a.lastRunAt,
              source: 'automation',
              name: a.name,
              status: a.lastResult.success ? 'success' : 'failed',
              error: a.lastResult.error,
            });
          }
        });
      }
      logs.sort((a, b) => (b.time || 0) - (a.time || 0));
      setExecLogs(logs.slice(0, 50));
    } catch { /* silent */ }
  }, []);

  // Tab 切换时按需加载
  const onTabChange = (key: string) => {
    setActiveTab(key);
    if (key === 'schedules' && schedules.length === 0) loadSchedules();
    if (key === 'workflows' && workflowTemplates.length === 0) loadWorkflows();
    if (key === 'logs' && execLogs.length === 0) loadExecLogs();
  };

  // 初始加载
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Socket.IO 实时监听执行结果，自动刷新数据
  useEffect(() => {
    const gw = (window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789';
    const httpUrl = gw.replace(/^ws([s]?):\/\//, 'http$1://');
    const sock = io(httpUrl, { transports: ['websocket', 'polling'] });
    sock.on('execution:result', () => { refreshAll(); loadExecLogs(); });
    sock.on('workflow:completed', () => { loadWorkflows(); loadExecLogs(); });
    sock.on('workflow:step', () => { /* 工作流步骤更新，此处不刷新避免频繁请求 */ });
    return () => { sock.disconnect(); };
  }, [refreshAll]);

  // 自动刷新 (每 5s)
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => refreshAll(), 5000);
    return () => clearInterval(t);
  }, [autoRefresh, refreshAll]);

  // 统计数据
  const stats = useMemo(() => {
    const total = allTasks.length;
    const resumable = resumableTasks.length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayNew = allTasks.filter((t) => t.createdAt >= todayStart.getTime()).length;
    const failed = allTasks.filter((t) => t.status === 'failed').length;
    return { total, resumable, todayNew, failed };
  }, [allTasks, resumableTasks]);

  // 过滤后的任务
  const filteredTasks = useMemo(() => {
    if (filterStatus === 'all') return allTasks;
    return allTasks.filter((t) => t.status === filterStatus);
  }, [allTasks, filterStatus]);

  // 详情加载
  const openDetail = async (taskId: string) => {
    setDetailVisible(true);
    await loadTask(taskId);
  };

  // 一键恢复: 设置 activeTaskId, 提示用户切到 chat
  const handleResume = (taskId: string) => {
    setActiveTaskId(taskId);
    message.success(`已激活任务 ${taskId.slice(0, 20)}..., 切到对话页继续`);
  };

  // 标记完成
  const handleComplete = async (taskId: string) => {
    const ok = await markCompleted(taskId, '用户在 TaskCenter 手动标记完成');
    if (ok) message.success('已标记完成');
  };

  // 标记失败
  const handleFail = async (taskId: string) => {
    const ok = await markFailed(taskId, '用户在 TaskCenter 手动标记失败');
    if (ok) message.success('已标记失败');
  };

  // 删除
  const handleDelete = async (taskId: string) => {
    const ok = await deleteTask(taskId);
    if (ok) message.success('已删除');
  };

  // 清理
  const handleCleanup = async () => {
    const removed = await cleanupOld(30);
    if (removed > 0) message.success(`清理了 ${removed} 个过期任务`);
    else message.info('没有需要清理的过期任务');
  };

  // 表格列
  const columns = [
    {
      title: '目标',
      dataIndex: 'goal',
      key: 'goal',
      ellipsis: true,
      width: '40%',
      render: (goal: string, t: TaskMeta) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <Tooltip title={goal}>
            <span style={{ fontWeight: 500 }}>{goal || '(无目标)'}</span>
          </Tooltip>
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #888)' }}>
            {t.taskId.slice(0, 30)}...
          </span>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: TaskStatus) => <Tag color={statusColor(s)}>{statusLabel(s)}</Tag>,
      filters: [
        { text: '运行中', value: 'running' },
        { text: '已暂停', value: 'paused' },
        { text: '已完成', value: 'completed' },
        { text: '失败', value: 'failed' },
        { text: '已放弃', value: 'abandoned' },
      ],
      onFilter: (v: any, r: TaskMeta) => r.status === v,
    },
    {
      title: '更新',
      dataIndex: 'lastUpdatedAt',
      key: 'lastUpdatedAt',
      width: 80,
      render: (ts: number) => {
        const min = taskIdleMin({ lastUpdatedAt: ts } as any);
        return <span style={{ fontSize: 12 }}>{min < 1 ? '刚刚' : `${min}分钟前`}</span>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_: any, t: TaskMeta) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(t.taskId)} />
          </Tooltip>
          {(['running', 'paused', 'abandoned'] as TaskStatus[]).includes(t.status) && (
            <Tooltip title="设为活跃, 切到对话页继续">
              <Button
                size="small"
                type={activeTaskId === t.taskId ? 'primary' : 'default'}
                icon={<PlayCircleOutlined />}
                onClick={() => handleResume(t.taskId)}
              />
            </Tooltip>
          )}
          {t.status !== 'completed' && t.status !== 'failed' && (
            <Tooltip title="标记完成">
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                onClick={() => handleComplete(t.taskId)}
              />
            </Tooltip>
          )}
          {t.status !== 'failed' && (
            <Tooltip title="标记失败">
              <Button
                size="small"
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => handleFail(t.taskId)}
              />
            </Tooltip>
          )}
          <Popconfirm
            title="确认删除?"
            description="任务数据将被永久删除"
            onConfirm={() => handleDelete(t.taskId)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <Card
        title={
          <Space>
            <ThunderboltOutlined />
            <span>任务中心</span>
            <Tag color="blue">跨会话恢复</Tag>
          </Space>
        }
        extra={
          <Space>
            <Tooltip title="自动刷新 (5秒)">
              <Switch
                size="small"
                checked={autoRefresh}
                onChange={setAutoRefresh}
                checkedChildren="自动"
                unCheckedChildren="手动"
              />
            </Tooltip>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => refreshAll()}
              loading={loading}
              size="small"
            >
              刷新
            </Button>
            <Popconfirm
              title="清理 30 天前的已完成/失败任务?"
              onConfirm={handleCleanup}
              okText="清理"
              cancelText="取消"
            >
              <Button icon={<ClearOutlined />} size="small">
                清理过期
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        {error && (
          <Alert
            type="error"
            message="错误"
            description={error}
            closable
            onClose={clearError}
            style={{ marginBottom: 16 }}
          />
        )}

        {activeTaskId && (
          <Alert
            type="info"
            showIcon
            message={
              <Space>
                <ApiOutlined />
                <span>当前活跃任务: <code>{activeTaskId}</code></span>
              </Space>
            }
            description="切到对话页发送消息时, AI 将自动加载此任务的进度上下文"
            action={
              <Button size="small" onClick={() => setActiveTaskId(null)}>
                取消激活
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 统计卡片 */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card size="small"><Statistic title="总任务" value={stats.total} prefix={<FileTextOutlined />} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="可恢复" value={stats.resumable} valueStyle={{ color: '#fa8c16' }} prefix={<PlayCircleOutlined />} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="今日新增" value={stats.todayNew} prefix={<ClockCircleOutlined />} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="失败" value={stats.failed} valueStyle={{ color: '#cf1322' }} prefix={<CloseCircleOutlined />} /></Card></Col>
        </Row>

        <Tabs activeKey={activeTab} onChange={onTabChange}>
          <Tabs.TabPane
            tab={
              <Space>
                <PlayCircleOutlined />
                <span>可恢复</span>
                <Tag color="orange">{resumableTasks.length}</Tag>
              </Space>
            }
            key="resumable"
          >
            {resumableTasks.length === 0 ? (
              <Empty description="当前没有可恢复的任务" />
            ) : (
              <Table
                size="small"
                dataSource={resumableTasks}
                columns={columns}
                rowKey="taskId"
                pagination={false}
                loading={loading}
              />
            )}
          </Tabs.TabPane>

          <Tabs.TabPane
            tab={
              <Space>
                <HistoryOutlined />
                <span>全部</span>
                <Tag>{allTasks.length}</Tag>
              </Space>
            }
            key="all"
          >
            <Space style={{ marginBottom: 12 }}>
              <span>过滤:</span>
              {(['all', 'running', 'paused', 'completed', 'failed', 'abandoned'] as const).map((s) => (
                <Tag.CheckableTag
                  key={s}
                  checked={filterStatus === s}
                  onChange={() => setFilterStatus(s)}
                >
                  {s === 'all' ? '全部' : statusLabel(s as TaskStatus)} ({
                    s === 'all' ? allTasks.length : allTasks.filter((t) => t.status === s).length
                  })
                </Tag.CheckableTag>
              ))}
            </Space>
            <Table
              size="small"
              dataSource={filteredTasks}
              columns={columns}
              rowKey="taskId"
              loading={loading}
              pagination={{ pageSize: 20, showSizeChanger: false }}
            />
          </Tabs.TabPane>

          {/* ===== 定时任务 Tab ===== */}
          <Tabs.TabPane
            tab={<span><ScheduleOutlined /> 定时任务</span>}
            key="schedules"
          >
            <Spin spinning={schedulesLoading}>
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Button icon={<ReloadOutlined />} size="small" onClick={loadSchedules}>刷新</Button>
                {schedules.length === 0 ? (
                  <Empty description="暂无定时任务" />
                ) : (
                  <Table
                    size="small"
                    dataSource={schedules}
                    rowKey={(r: any) => r.id || r.name}
                    pagination={false}
                    columns={[
                      { title: '名称', dataIndex: 'name', ellipsis: true },
                      { title: '类型', dataIndex: 'type', width: 100, render: (t: string) => <Tag>{t}</Tag> },
                      { title: 'Cron', dataIndex: 'cron', width: 120 },
                      { title: '状态', dataIndex: 'status', width: 80, render: (s: string) => <Tag color={s === 'active' ? 'green' : 'default'}>{s}</Tag> },
                      { title: '运行', dataIndex: 'runCount', width: 60 },
                      { title: '成功率', dataIndex: 'successRate', width: 80, render: (v: number) => <span>{v ?? '-'}%</span> },
                      { title: '上次结果', dataIndex: 'lastResult', width: 120, render: (r: any) => r ? <Tag color={r.success ? 'green' : 'red'}>{r.success ? '成功' : '失败'}</Tag> : '-' },
                    ]}
                  />
                )}
              </Space>
            </Spin>
          </Tabs.TabPane>

          {/* ===== 工作流 Tab ===== */}
          <Tabs.TabPane
            tab={<span><NodeIndexOutlined /> 工作流</span>}
            key="workflows"
          >
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Button icon={<ReloadOutlined />} size="small" onClick={() => { loadWorkflows(); }}>刷新</Button>
              {workflowTemplates.length === 0 ? (
                <Empty description="暂无工作流模板" />
              ) : (
                <Collapse size="small" items={workflowTemplates.slice(0, 10).map((w: any) => ({
                  key: w.id || w.name,
                  label: <Space><Tag>{w.industry || '通用'}</Tag>{w.name}</Space>,
                  children: <div style={{ fontSize: 12 }}>
                    <p>{w.description || '无描述'}</p>
                    <p>步骤: {(w.steps || []).length} 个 · {(w.variables || []).length > 0 ? `变量: ${(w.variables || []).map((v: any) => v.name).join(', ')}` : '无变量'}</p>
                  </div>,
                }))} />
              )}
            </Space>
          </Tabs.TabPane>

          {/* ===== 执行日志 Tab ===== */}
          <Tabs.TabPane
            tab={<span><FileSearchOutlined /> 执行日志</span>}
            key="logs"
          >
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Button icon={<ReloadOutlined />} size="small" onClick={() => { loadExecLogs(); }}>刷新</Button>
              {execLogs.length === 0 ? (
                <Empty description="暂无执行日志" />
              ) : (
                <Table
                  size="small"
                  dataSource={execLogs}
                  rowKey="time"
                  pagination={{ pageSize: 10 }}
                  columns={[
                    { title: '时间', dataIndex: 'time', width: 160, render: (t: number) => t ? new Date(t).toLocaleString() : '-' },
                    { title: '来源', dataIndex: 'source', width: 80, render: (s: string) => <Tag>{s === 'workflow' ? '工作流' : '自动化'}</Tag> },
                    { title: '名称', dataIndex: 'name', ellipsis: true },
                    { title: '状态', dataIndex: 'status', width: 80, render: (s: string) => <Tag color={s === 'success' ? 'green' : s === 'failed' ? 'red' : 'orange'}>{s}</Tag> },
                    { title: '耗时', dataIndex: 'duration', width: 80, render: (d: number) => d ? `${(d / 1000).toFixed(1)}s` : '-' },
                    { title: '错误', dataIndex: 'error', ellipsis: true, render: (e: string) => e ? <Tooltip title={e}><Tag color="red">有错误</Tag></Tooltip> : <Tag color="green">正常</Tag> },
                  ]}
                />
              )}
            </Space>
          </Tabs.TabPane>
        </Tabs>
      </Card>

      {/* 详情抽屉 */}
      <Drawer
        title={
          <Space>
            <EyeOutlined />
            <span>任务详情</span>
            {currentTask && <Tag color={statusColor(currentTask.status)}>{statusLabel(currentTask.status)}</Tag>}
          </Space>
        }
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        width={640}
      >
        {currentTask ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Card size="small" title="基本信息">
              <Row gutter={[16, 8]}>
                <Col span={8}><span style={{ color: 'var(--text-secondary)' }}>ID</span></Col>
                <Col span={16}><code style={{ fontSize: 11 }}>{currentTask.taskId}</code></Col>

                <Col span={8}><span style={{ color: 'var(--text-secondary)' }}>目标</span></Col>
                <Col span={16}>{currentTask.goal}</Col>

                <Col span={8}><span style={{ color: 'var(--text-secondary)' }}>用户</span></Col>
                <Col span={16}>{currentTask.userId}</Col>

                <Col span={8}><span style={{ color: 'var(--text-secondary)' }}>工作区</span></Col>
                <Col span={16}>{currentTask.workspace}</Col>

                <Col span={8}><span style={{ color: 'var(--text-secondary)' }}>开始</span></Col>
                <Col span={16}>{new Date(currentTask.startedAt).toLocaleString()}</Col>

                <Col span={8}><span style={{ color: 'var(--text-secondary)' }}>最后更新</span></Col>
                <Col span={16}>{new Date(currentTask.lastUpdatedAt).toLocaleString()} ({taskIdleMin({ lastUpdatedAt: currentTask.lastUpdatedAt } as any)}分钟前)</Col>

                <Col span={8}><span style={{ color: 'var(--text-secondary)' }}>当前阶段</span></Col>
                <Col span={16}><Tag color="blue">{currentTask.currentStage}</Tag> (第 {currentTask.iteration} 轮)</Col>

                <Col span={8}><span style={{ color: 'var(--text-secondary)' }}>工具调用</span></Col>
                <Col span={16}>{currentTask.totalToolCalls} 次</Col>
              </Row>
            </Card>

            <Card
              size="small"
              title={
                <Space>
                  <Progress
                    type="circle"
                    percent={currentTask.progress.completedSteps.length +
                      currentTask.progress.pendingSteps.length === 0 ? 0 :
                      Math.round(100 * currentTask.progress.completedSteps.length /
                        (currentTask.progress.completedSteps.length + currentTask.progress.pendingSteps.length))}
                    size={20}
                  />
                  <span>进度</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {currentTask.progress.completedSteps.length} 完成 / {currentTask.progress.pendingSteps.length} 待办
                  </span>
                </Space>
              }
            >
              {currentTask.progress.completedSteps.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: 12, color: 'var(--text-secondary)' }}>✅ 已完成</strong>
                  <Timeline style={{ marginTop: 8 }}>
                    {currentTask.progress.completedSteps.map((s, i) => (
                      <Timeline.Item key={i} color="green">
                        <div style={{ fontWeight: 500 }}>{s.step}</div>
                        {s.result && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.result}</div>}
                      </Timeline.Item>
                    ))}
                  </Timeline>
                </div>
              )}
              {currentTask.progress.pendingSteps.length > 0 && (
                <div>
                  <strong style={{ fontSize: 12, color: 'var(--text-secondary)' }}>⏳ 待办</strong>
                  <Timeline style={{ marginTop: 8 }}>
                    {currentTask.progress.pendingSteps.map((s, i) => (
                      <Timeline.Item key={i} color="gray">
                        <div>{s}</div>
                      </Timeline.Item>
                    ))}
                  </Timeline>
                </div>
              )}
            </Card>

            {currentTask.progress.keyDecisions.length > 0 && (
              <Card size="small" title={<Space><BulbOutlined /><span>关键决策</span></Space>}>
                <Timeline>
                  {currentTask.progress.keyDecisions.map((d, i) => (
                    <Timeline.Item key={i} color="blue">
                      <div style={{ fontWeight: 500 }}>{d.decision}</div>
                      {d.reasoning && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.reasoning}</div>}
                    </Timeline.Item>
                  ))}
                </Timeline>
              </Card>
            )}

            {currentTask.resumeHints.nextAction && (
              <Card size="small" title={<Space><FlagOutlined /><span>下一步</span></Space>}>
                <Alert type="info" message={currentTask.resumeHints.nextAction} />
              </Card>
            )}

            {currentTask.filesTouched.length > 0 && (
              <Card size="small" title={<Space><FileTextOutlined /><span>触碰文件</span></Space>}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {currentTask.filesTouched.slice(-10).map((f, i) => (
                    <div key={i} style={{ fontSize: 12, fontFamily: 'monospace' }}>
                      <Tag color="cyan">{f.action}</Tag> {f.path}
                    </div>
                  ))}
                </Space>
              </Card>
            )}

            {currentTask.recentErrors.length > 0 && (
              <Card size="small" title={<Space><CloseCircleOutlined /><span>最近错误</span></Space>}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {currentTask.recentErrors.slice(-5).map((e, i) => (
                    <div key={i} style={{ fontSize: 12 }}>
                      <Tag color="red">{e.tool}</Tag> {e.error}
                    </div>
                  ))}
                </Space>
              </Card>
            )}
          </Space>
        ) : (
          <Spin />
        )}
      </Drawer>
    </div>
  );
};
