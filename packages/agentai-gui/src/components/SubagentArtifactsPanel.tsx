/**
 * SubagentArtifactsPanel — 子智能体「任务产物」区
 * ----------------------------------------------------------------
 * 2026-10-21 新增。
 *
 * 存在理由 (实锤事故):
 *   主 AI 被中断后, 子智能体继续跑 (独立任务单元), 跑完的成果**原本无处可去**:
 *   回注队列没人消费 + SSE 已关 + 随 loop 实例 GC → 成果全丢 (白烧 token)。
 *   现在成果落盘到 {workspace}/.agentai/subagent-artifacts/, 由本面板呈现。
 *
 * 交互 (照 GeneratedFilesPanel 的成熟模式):
 *   · Card 列表, 每行 = 一个子任务产物
 *   · 点击行 = **就地展开** 完整过程 (思考 / 正文 / 工具调用 分色), 不跳页
 *   · 空态用 Empty 插画 (与其它右栏面板一致)
 *
 * 隐私: 按富哥拍板, 产物**不脱敏**全量落盘 —— 本面板如实展示, 不做二次过滤。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, Tag, Empty, Spin, Tooltip, Button } from 'antd';
import { RobotOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { useProfileStore } from '../store';

interface TranscriptEntry {
  kind: 'thinking' | 'text' | 'tool';
  text: string;
  tool?: string;
}

interface Artifact {
  id: string;
  type: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
  transcript?: TranscriptEntry[];
  toolCalls?: number;
  iterations?: number;
  durationMs?: number;
  startedAt: number;
  finishedAt?: number;
  /** 2026-10-21: false = 网关重启后磁盘上的僵尸 (running 但进程已不存在) */
  alive?: boolean;
}

const gatewayHttp = () =>
  (window as any).__AGENTAI_GATEWAY__?.replace(/^ws(s?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';

const ROLE_LABELS: Record<string, string> = {
  research: '研究员',
  explore: '代码探索员',
  pentest: '渗透测试工程师',
  pentest_recon: '渗透侦察',
  architect: '架构师',
  frontend: '前端工程师',
  backend: '后端工程师',
  tester: '测试员',
  review: '代码审查员',
  'security-review': '安全审查员',
  'tech-writer': '技术文档工程师',
  performance: '性能优化专家',
};

const labelOf = (t: string) => ROLE_LABELS[t] || t || '子智能体';

const fmtDur = (ms?: number) => (ms ? `${(ms / 1000).toFixed(1)}s` : '');

export const SubagentArtifactsPanel: React.FC = () => {
  const zustandProfile = (useProfileStore((s) => s?.profile) || {}) as Record<string, any>;
  const workspace = zustandProfile?.workspace || localStorage.getItem('agentai.workspace') || '';

  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!workspace) { setArtifacts([]); return; }
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`${gatewayHttp()}/api/subagent-artifacts?workspace=${encodeURIComponent(workspace)}`);
      const data: any = await res.json().catch(() => null);
      if (data?.success) setArtifacts(data.artifacts || []);
      else setErr(data?.error || '加载失败');
    } catch (e: any) {
      setErr(e?.message || '无法连接网关');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { load(); }, [load]);

  // 有运行中的子任务时轮询刷新 (成果是陆续落盘的)
  // 2026-10-21: 僵尸 (running + alive=false, 网关重启残留) 不算在跑 — 否则永远轮询
  useEffect(() => {
    const hasRunning = artifacts.some(a => a.status === 'running' && a.alive !== false);
    if (!hasRunning) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [artifacts, load]);

  const remove = useCallback(async (id: string) => {
    try {
      await fetch(`${gatewayHttp()}/api/subagent-artifacts/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`, {
        method: 'DELETE',
      });
      setArtifacts(prev => prev.filter(a => a.id !== id));
      if (openId === id) setOpenId(null);
    } catch { /* best-effort */ }
  }, [workspace, openId]);

  if (!workspace) {
    return (
      <Card size="small" title={<span style={{ fontSize: 'var(--fs-sm)' }}>子任务产物</span>}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未选择工作区" />
      </Card>
    );
  }

  return (
    <Card
      size="small"
      title={
        <span style={{ fontSize: 'var(--fs-sm)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RobotOutlined style={{ color: 'var(--accent)' }} />
          子任务产物
          {artifacts.length > 0 && (
            <Tag style={{ marginInlineEnd: 0, fontSize: 'var(--fs-micro)' }}>{artifacts.length}</Tag>
          )}
        </span>
      }
      extra={
        <Tooltip title="刷新">
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} />
        </Tooltip>
      }
    >
      {loading && artifacts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '12px 0' }}><Spin size="small" /></div>
      ) : artifacts.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={err ? `加载失败: ${err}` : '暂无子任务产物'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {artifacts.map(a => {
            const isOpen = openId === a.id;
            const tr = a.transcript || [];
            const thinking = tr.filter(e => e.kind === 'thinking');
            const body = tr.filter(e => e.kind === 'text');
            const tools = tr.filter(e => e.kind === 'tool');
            // 2026-10-21: 僵尸 = 磁盘上 running 但网关重启后进程已蒸发 (alive=false)
            const interrupted = a.status === 'running' && a.alive === false;
            const statusColor = interrupted ? 'var(--danger)'
              : a.status === 'running' ? 'var(--accent)'
              : a.status === 'error' ? 'var(--danger)' : 'var(--success)';
            const statusDot = interrupted ? '⚠' : a.status === 'running' ? '●' : a.status === 'error' ? '✗' : '✓';
            return (
              <div
                key={a.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                }}
              >
                {/* 标题行: 点击就地展开 */}
                <div
                  onClick={() => setOpenId(isOpen ? null : a.id)}
                  style={{
                    padding: '5px 8px',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 'var(--fs-micro)',
                    background: isOpen ? 'var(--bg)' : 'transparent',
                    userSelect: 'none',
                  }}
                >
                  <Tooltip title={interrupted ? '已中断 (网关重启过, 子任务进程已不存在)' : undefined}>
                    <span style={{ color: statusColor, fontSize: 10 }}>
                      {statusDot}
                    </span>
                  </Tooltip>
                  <span style={{ fontWeight: 500, color: 'var(--fg)', flexShrink: 0 }}>
                    {labelOf(a.type)}
                  </span>
                  <span style={{
                    color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                  }}>
                    {a.task}
                  </span>
                  {interrupted && (
                    <span style={{ color: 'var(--danger)', flexShrink: 0, fontSize: 10 }}>已中断</span>
                  )}
                  {a.iterations ? <span style={{ color: 'var(--muted-2)', flexShrink: 0 }}>{a.iterations}轮</span> : null}
                  {a.durationMs ? <span style={{ color: 'var(--muted-2)', flexShrink: 0 }}>{fmtDur(a.durationMs)}</span> : null}
                  <Tooltip title="删除产物">
                    <span
                      onClick={(e) => { e.stopPropagation(); remove(a.id); }}
                      style={{ color: 'var(--muted-2)', flexShrink: 0, cursor: 'pointer' }}
                    >
                      <DeleteOutlined style={{ fontSize: 11 }} />
                    </span>
                  </Tooltip>
                </div>

                {/* 展开区: 完整过程 */}
                {isOpen && (
                  <div style={{
                    padding: '6px 8px',
                    borderTop: '1px solid var(--border)',
                    fontSize: 'var(--fs-micro)',
                    lineHeight: 1.7,
                    maxHeight: 300,
                    overflowY: 'auto',
                    wordBreak: 'break-word',
                  }}>
                    {thinking.length > 0 && (
                      <details style={{ marginBottom: 6 }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--muted-2)' }}>
                          思考过程 ({thinking.length} 段)
                        </summary>
                        <div style={{
                          marginTop: 3, paddingLeft: 8,
                          borderLeft: '2px solid var(--border)',
                          color: 'var(--muted-2)', fontStyle: 'italic', whiteSpace: 'pre-wrap',
                        }}>
                          {thinking.map((e, i) => <div key={`th-${i}`}>{e.text}</div>)}
                        </div>
                      </details>
                    )}
                    {tools.length > 0 && (
                      <div style={{ color: 'var(--muted)', marginBottom: 6 }}>
                        {tools.map((e, i) => (
                          <div key={`tl-${i}`} style={{ display: 'flex', gap: 4 }}>
                            <span style={{ opacity: 0.7 }}>🔧</span>
                            <span style={{ color: 'var(--fg-2)' }}>{e.tool || e.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {body.length > 0 && (
                      <div style={{ color: 'var(--fg)', whiteSpace: 'pre-wrap', marginBottom: 6 }}>
                        {body.map((e, i) => <div key={`tx-${i}`}>{e.text}</div>)}
                      </div>
                    )}
                    {(a.result || a.error) && (
                      <div style={{
                        paddingTop: 6, borderTop: '1px solid var(--border)',
                        color: a.error ? 'var(--danger)' : 'var(--fg)',
                        whiteSpace: 'pre-wrap',
                      }}>
                        <div style={{ fontWeight: 500, color: 'var(--fg-2)', marginBottom: 2 }}>
                          {a.error ? '失败原因' : '最终结果'}
                        </div>
                        {a.error || a.result}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default SubagentArtifactsPanel;
