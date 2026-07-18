/**
 * WorkflowPanel — 行业工作流模板面板
 * ==================================================
 * 功能:
 *   1. 浏览内置/自定义工作流模板 (按行业分组)
 *   2. 一键执行模板 (填入变量)
 *   3. 查看执行历史 + 步骤详情
 *   4. 可视化 DAG 步骤流程 (卡片连线)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Empty, Modal, Input, Select, Tag, Tooltip, message, Collapse, Steps, Spin, Progress } from 'antd';
import {
  PartitionOutlined, PlayCircleOutlined, ReloadOutlined,
  DeleteOutlined, BulbOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ClockCircleOutlined, MinusCircleOutlined,
  HomeOutlined, ShoppingOutlined, DashboardOutlined, ToolOutlined,
} from '@ant-design/icons';
import { gatewayFallback } from '../services/GatewayFallback';
import { io, type Socket } from 'socket.io-client';
import { GATEWAY_HTTP } from '../services/config';

const { TextArea } = Input;
const { Option } = Select;

interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  defaultValue: any;
  description?: string;
  required?: boolean;
}

interface WorkflowStep {
  id: string;
  name: string;
  type: string;
  dependsOn: string[];
  config: Record<string, any>;
  retryCount?: number;
  timeout?: number;
  condition?: string;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  industry: string;
  description: string;
  variables: WorkflowVariable[];
  steps: WorkflowStep[];
  builtin?: boolean;
  notifyOnComplete?: boolean;
  notifyOnFailure?: boolean;
  createdAt: number;
}

interface StepResult {
  stepId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  output?: any;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  retryAttempts?: number;
}

interface WorkflowExecution {
  id: string;
  templateId: string;
  templateName: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  startedAt: number;
  completedAt?: number;
  variables: Record<string, any>;
  stepResults: Record<string, StepResult>;
  error?: string;
}

const gatewayUrl = () => gatewayFallback.url || 'http://127.0.0.1:18789';

const INDUSTRY_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  decoration: { label: '装修行业', icon: <HomeOutlined />, color: '#f97316' },
  ecommerce: { label: '电商行业', icon: <ShoppingOutlined />, color: '#3b82f6' },
  monitoring: { label: '监控运维', icon: <DashboardOutlined />, color: '#10b981' },
  custom: { label: '自定义', icon: <ToolOutlined />, color: '#8b5cf6' },
};

const STEP_ICONS: Record<string, React.ReactNode> = {
  rpa: <PlayCircleOutlined />,
  ai_task: <BulbOutlined />,
  notification: <CheckCircleOutlined />,
  condition: <PartitionOutlined />,
  extract: <ReloadOutlined />,
  transform: <PartitionOutlined />,
  delay: <ClockCircleOutlined />,
  http: <DashboardOutlined />,
};

const STEP_COLORS: Record<string, string> = {
  rpa: '#3b82f6',
  ai_task: '#f97316',
  notification: '#10b981',
  condition: '#f59e0b',
  extract: '#8b5cf6',
  transform: '#ec4899',
  delay: '#6b7280',
  http: '#06b6d4',
};

interface LiveStep {
  stepId: string;
  stepName: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
  error?: string;
  output?: string;
}

export const WorkflowPanel: React.FC = () => {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [runModal, setRunModal] = useState<WorkflowTemplate | null>(null);
  const [runVars, setRunVars] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [detailExec, setDetailExec] = useState<WorkflowExecution | null>(null);

  // 实时进度状态
  const [liveExecId, setLiveExecId] = useState<string | null>(null);
  const [liveTemplateName, setLiveTemplateName] = useState('');
  const [liveTotalSteps, setLiveTotalSteps] = useState(0);
  const [liveSteps, setLiveSteps] = useState<Record<string, LiveStep>>({});
  const [liveStatus, setLiveStatus] = useState<'running' | 'completed' | 'failed' | 'partial'>('running');
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tmplResp, execResp] = await Promise.all([
        fetch(`${gatewayUrl()}/v1/workflows/templates`),
        fetch(`${gatewayUrl()}/v1/workflows/executions?limit=30`),
      ]);
      const tmplData = await tmplResp.json();
      const execData = await execResp.json();
      setTemplates(tmplData.templates || []);
      setExecutions(execData.executions || []);
    } catch (e: any) {
      message.error(`加载失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Socket.IO 实时进度监听
  useEffect(() => {
    const ws = io(GATEWAY_HTTP, { transports: ['websocket', 'polling'], reconnection: true });
    socketRef.current = ws;

    ws.on('workflow:started', (data: any) => {
      setLiveExecId(data.executionId);
      setLiveTemplateName(data.templateName || '');
      setLiveTotalSteps(data.totalSteps || 0);
      setLiveSteps({});
      setLiveStatus('running');
    });

    ws.on('workflow:step', (data: any) => {
      setLiveSteps(prev => ({
        ...prev,
        [data.stepId]: {
          stepId: data.stepId,
          stepName: data.stepName || data.stepId,
          status: data.status,
          error: data.error,
          output: data.output,
        },
      }));
    });

    ws.on('workflow:completed', (data: any) => {
      setLiveStatus(data.status || 'completed');
      // 3秒后自动清除实时进度显示
      setTimeout(() => {
        setLiveExecId(null);
        setLiveSteps({});
      }, 3000);
      // 刷新执行历史
      load();
    });

    return () => { ws.disconnect(); socketRef.current = null; };
  }, [load]);

  const handleRun = async () => {
    if (!runModal) return;
    setRunning(true);
    try {
      // 转换变量类型
      const vars: Record<string, any> = {};
      for (const v of runModal.variables) {
        const raw = runVars[v.name] ?? String(v.defaultValue ?? '');
        if (v.type === 'number') vars[v.name] = parseFloat(raw) || 0;
        else if (v.type === 'boolean') vars[v.name] = raw === 'true' || raw === '1';
        else if (v.type === 'json') { try { vars[v.name] = JSON.parse(raw); } catch { vars[v.name] = raw; } }
        else vars[v.name] = raw;
      }
      const resp = await fetch(`${gatewayUrl()}/v1/workflows/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: runModal.id, variables: vars }),
      });
      const data = await resp.json();
      if (data.success) {
        const exec = data.execution;
        const icon = exec.status === 'completed' ? '✅' : exec.status === 'failed' ? '❌' : '⚠️';
        message.success(`${icon} 工作流${exec.status === 'completed' ? '执行完成' : '执行结束'}: ${exec.templateName}`);
        setRunModal(null);
        setRunVars({});
        load();
      } else {
        message.error(`执行失败: ${data.error}`);
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后不可恢复，确定要删除这个工作流模板吗？',
      onOk: async () => {
        try {
          await fetch(`${gatewayUrl()}/v1/workflows/templates/${id}`, { method: 'DELETE' });
          message.success('已删除');
          load();
        } catch (e: any) { message.error(e.message); }
      },
    });
  };

  // 按行业分组
  const grouped: Record<string, WorkflowTemplate[]> = {};
  for (const t of templates) {
    const key = t.industry || 'custom';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(t);
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircleOutlined style={{ color: '#10b981' }} />;
      case 'failed': return <CloseCircleOutlined style={{ color: '#ef4444' }} />;
      case 'partial': return <MinusCircleOutlined style={{ color: '#f59e0b' }} />;
      default: return <ClockCircleOutlined style={{ color: '#6b7280' }} />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      {/* 头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PartitionOutlined style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 13 }}>行业工作流</span>
          <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>{templates.length} 模板</Tag>
          <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>{executions.length} 执行记录</Tag>
        </div>
        <Tooltip title="刷新">
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} loading={loading} />
        </Tooltip>
      </div>

      {/* 实时执行进度 */}
      {liveExecId && (
        <div style={{
          padding: '8px 12px', borderBottom: '1px solid var(--border)',
          background: liveStatus === 'running' ? 'rgba(99,102,241,0.06)' : liveStatus === 'completed' ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            {liveStatus === 'running' ? <Spin size="small" /> : statusIcon(liveStatus)}
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>
              {liveStatus === 'running' ? '⚡ 执行中' : liveStatus === 'completed' ? '✅ 已完成' : '⚠️ 执行结束'}: {liveTemplateName}
            </span>
            <Tag style={{ fontSize: 9, margin: 0 }}>
              {Object.values(liveSteps).filter(s => s.status === 'success' || s.status === 'failed').length}/{liveTotalSteps}
            </Tag>
          </div>
          <Progress
            percent={liveTotalSteps > 0 ? Math.round((Object.values(liveSteps).filter(s => s.status === 'success' || s.status === 'failed').length / liveTotalSteps) * 100) : 0}
            size="small"
            status={liveStatus === 'failed' ? 'exception' : liveStatus === 'completed' ? 'success' : 'active'}
          />
          {/* 步骤实时状态 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
            {Object.values(liveSteps).map(s => (
              <Tag key={s.stepId} style={{
                fontSize: 9, margin: 0, lineHeight: '18px', padding: '0 4px',
                color: s.status === 'success' ? '#10b981' : s.status === 'failed' ? '#ef4444' : s.status === 'skipped' ? '#6b7280' : '#f59e0b',
                borderColor: s.status === 'success' ? '#10b981' : s.status === 'failed' ? '#ef4444' : s.status === 'skipped' ? '#6b7280' : '#f59e0b',
                background: 'transparent',
              }}>
                {s.status === 'success' ? '✅' : s.status === 'failed' ? '❌' : s.status === 'skipped' ? '⏭️' : '⚡'} {s.stepName}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
        {loading && templates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="加载中..." /></div>
        ) : templates.length === 0 ? (
          <Empty description="暂无工作流模板" style={{ marginTop: 60 }} />
        ) : (
          <Collapse
            defaultActiveKey={Object.keys(grouped)}
            ghost
            items={Object.entries(grouped).map(([industry, tmps]) => {
              const meta = INDUSTRY_META[industry] || INDUSTRY_META.custom;
              return {
                key: industry,
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: meta.color }}>
                    {meta.icon} {meta.label} ({tmps.length})
                  </span>
                ),
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {tmps.map(t => (
                      <div key={t.id} style={{
                        border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px',
                        background: 'var(--bg-2)', transition: 'border-color 0.2s',
                      }}>
                        {/* 模板头部 */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--fg)' }}>{t.name}</span>
                            {t.builtin && <Tag color="blue" style={{ fontSize: 9, margin: 0, lineHeight: '16px' }}>内置</Tag>}
                          </div>
                          <div style={{ display: 'flex', gap: 2 }}>
                            <Tooltip title="执行">
                              <Button size="small" type="text" icon={<PlayCircleOutlined style={{ color: 'var(--accent)' }} />}
                                onClick={() => {
                                  setRunModal(t);
                                  const defaults: Record<string, string> = {};
                                  for (const v of t.variables) defaults[v.name] = String(v.defaultValue ?? '');
                                  setRunVars(defaults);
                                }} />
                            </Tooltip>
                            {!t.builtin && (
                              <Tooltip title="删除">
                                <Button size="small" type="text" danger icon={<DeleteOutlined />}
                                  onClick={() => handleDelete(t.id)} />
                              </Tooltip>
                            )}
                          </div>
                        </div>
                        {/* 描述 */}
                        <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 6, lineHeight: 1.5 }}>{t.description}</div>
                        {/* DAG 步骤可视化 */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
                          {t.steps.map((step, i) => (
                            <React.Fragment key={step.id}>
                              {i > 0 && <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>→</span>}
                              <Tooltip title={`${step.type}${step.dependsOn.length ? ` (依赖: ${step.dependsOn.join(',')})` : ''}`}>
                                <Tag style={{
                                  fontSize: 9, margin: 0, lineHeight: '18px', padding: '0 4px',
                                  color: STEP_COLORS[step.type] || '#666',
                                  borderColor: STEP_COLORS[step.type] || '#666',
                                  background: 'transparent',
                                }}>
                                  {STEP_ICONS[step.type]} {step.name}
                                </Tag>
                              </Tooltip>
                            </React.Fragment>
                          ))}
                        </div>
                        {/* 变量 */}
                        {t.variables.length > 0 && (
                          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--muted-2)' }}>
                            变量: {t.variables.map(v => `${v.name}${v.required ? '*' : ''}`).join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ),
              };
            })}
          />
        )}

        {/* 执行历史 */}
        {executions.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 6, padding: '0 4px' }}>
              📋 执行历史
            </div>
            {executions.slice(0, 15).map(e => (
              <div key={e.id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 8px', marginBottom: 2, borderRadius: 4,
                background: 'var(--bg-2)', cursor: 'pointer', fontSize: 11,
                border: '1px solid transparent',
              }}
              onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
              onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.borderColor = 'transparent'; }}
              onClick={() => setDetailExec(e)}
              >
                {statusIcon(e.status)}
                <span style={{ color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.templateName}
                </span>
                <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>
                  {e.completedAt ? `${((e.completedAt - e.startedAt) / 1000).toFixed(1)}s` : '...'}
                </span>
                <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>
                  {new Date(e.startedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 执行模板对话框 */}
      <Modal
        title={runModal ? `执行: ${runModal.name}` : ''}
        open={!!runModal}
        onOk={handleRun}
        onCancel={() => { setRunModal(null); setRunVars({}); }}
        okText="执行"
        cancelText="取消"
        confirmLoading={running}
        width={500}
      >
        {runModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            <div style={{ padding: '8px 10px', background: 'rgba(99,102,241,0.08)', borderRadius: 6, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
              {runModal.description}
            </div>
            {runModal.variables.length > 0 ? (
              runModal.variables.map(v => (
                <div key={v.name}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {v.name}{v.required && <span style={{ color: '#ef4444' }}>*</span>}
                    <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>({v.type})</span>
                  </label>
                  {v.description && <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 2 }}>{v.description}</div>}
                  <Input
                    value={runVars[v.name] ?? ''}
                    onChange={(e) => setRunVars(prev => ({ ...prev, [v.name]: e.target.value }))}
                    placeholder={v.description || `输入 ${v.name}`}
                    size="small"
                  />
                </div>
              ))
            ) : (
              <div style={{ fontSize: 11, color: 'var(--muted-2)', textAlign: 'center', padding: 8 }}>此模板无需输入变量</div>
            )}
            {/* DAG 预览 */}
            <div style={{ marginTop: 4, padding: '6px 8px', background: 'var(--bg-2)', borderRadius: 4 }}>
              <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 4 }}>执行流程:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
                {runModal.steps.map((step, i) => (
                  <React.Fragment key={step.id}>
                    {i > 0 && <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>→</span>}
                    <Tag style={{
                      fontSize: 9, margin: 0, lineHeight: '18px', padding: '0 4px',
                      color: STEP_COLORS[step.type] || '#666',
                      borderColor: STEP_COLORS[step.type] || '#666',
                    }}>
                      {step.name}
                    </Tag>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 执行详情对话框 */}
      <Modal
        title={detailExec ? `执行详情: ${detailExec.templateName}` : ''}
        open={!!detailExec}
        onCancel={() => setDetailExec(null)}
        footer={<Button onClick={() => setDetailExec(null)}>关闭</Button>}
        width={600}
      >
        {detailExec && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <Tag>{statusIcon(detailExec.status)} {detailExec.status}</Tag>
              <Tag>耗时: {detailExec.completedAt ? `${((detailExec.completedAt - detailExec.startedAt) / 1000).toFixed(1)}s` : '进行中'}</Tag>
              <Tag>开始: {new Date(detailExec.startedAt).toLocaleString()}</Tag>
            </div>
            {detailExec.error && (
              <div style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.1)', borderRadius: 4, fontSize: 11, color: '#ef4444', marginBottom: 8 }}>
                {detailExec.error}
              </div>
            )}
            <Steps
              direction="vertical"
              size="small"
              current={Object.values(detailExec.stepResults).findIndex(r => r.status === 'running')}
              status={detailExec.status === 'failed' ? 'error' : detailExec.status === 'completed' ? 'finish' : 'process'}
              items={Object.entries(detailExec.stepResults).map(([id, r]) => ({
                title: id,
                description: (
                  <div style={{ fontSize: 11 }}>
                    <span style={{ color: r.status === 'success' ? '#10b981' : r.status === 'failed' ? '#ef4444' : r.status === 'skipped' ? '#6b7280' : '#f59e0b' }}>
                      {r.status}
                    </span>
                    {r.retryAttempts ? ` · 重试${r.retryAttempts}次` : ''}
                    {r.error && <div style={{ color: '#ef4444', marginTop: 2 }}>{r.error}</div>}
                    {r.output && <div style={{ color: 'var(--muted)', marginTop: 2, maxHeight: 60, overflow: 'auto' }}>{typeof r.output === 'string' ? r.output.slice(0, 200) : JSON.stringify(r.output).slice(0, 200)}</div>}
                  </div>
                ),
                status: r.status === 'success' ? 'finish' : r.status === 'failed' ? 'error' : r.status === 'skipped' ? 'wait' : 'process',
              }))}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};
