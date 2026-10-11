/**
 * SubagentStatus — 子智能体状态实时显示
 * ----------------------------------------------------
 * 在 AI 回复流中紧凑显示子 Agent 的执行状态
 *
 * 2026-10-11 折叠改造:
 *   - 默认折叠为单行摘要 ("🤖 N 个子智能体 · M 运行中"), 点击展开详情
 *   - 只有 1 个且正在运行时直接展开 (单 agent 场景不需要折叠)
 *   - 所有 agent 都进入终态 (done/error) 后 3s 自动淡出并回调 onAllFinished
 *     让上层 ChatView 清空 subagents state, 容器彻底消失
 *   - 失败行保留红色高亮 (子任务挂掉不能被藏起来)
 */
import React, { useEffect, useState } from 'react';

export interface SubagentInfo {
  id: string;
  type: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
  /**
   * 执行步骤流水（2026-10-05 补齐）
   * ----------------------------------------------------
   * ChatView 的 subagent:progress / :done / :error 三个 handler 一直在往
   * `steps` 里追加步骤描述（工具调用/ 完成 / 失败），但本接口**没声明该字段**
   * → tsc 报 TS2339 "Property 'steps' does not exist on type 'SubagentInfo'"
   * → 且更严重：即使补了类型，下方渲染也没消费它 →
   *   前端收集几十条步骤，用户一个字都看不到（又一处"只做了 UI 没接线"）。
   *
   * 现在：类型补齐 + 渲染真正展示（运行中展开最近 3 步，完成后折叠摘要）。
   */
  steps?: string[];
}

export interface SubagentStatusProps {
  agents: SubagentInfo[];
  pending: boolean;
  /** 全部进入终态后触发, 上层可清空 agents state 让容器彻底消失 */
  onAllFinished?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  architect: '架构师',
  frontend: '前端工程师',
  backend: '后端工程师',
  tester: '测试员',
  'tech-writer': '技术文档工程师',
  performance: '性能优化专家',
  pentest: '渗透测试工程师',
  explore: '代码探索员',
  research: '研究员',
  review: '代码审查员',
  'security-review': '安全审查员',
};

const ROLE_ICONS: Record<string, string> = {
  architect: '🏗️',
  frontend: '🎨',
  backend: '⚙️',
  tester: '🧪',
  'tech-writer': '📝',
  performance: '⚡',
  pentest: '🔒',
  explore: '🔍',
  research: '📚',
  review: '👁️',
  'security-review': '🛡️',
};

export const SubagentStatus: React.FC<SubagentStatusProps> = ({ agents, pending, onAllFinished }) => {
  const [expanded, setExpanded] = useState<boolean>(() => {
    // 初始展开策略: 单 agent 展开; 多 agent 默认折叠
    return (agents?.length ?? 0) <= 1;
  });
  const [fading, setFading] = useState(false);

  const running = agents.filter(a => a.status === 'running');
  const done = agents.filter(a => a.status === 'done');
  const failed = agents.filter(a => a.status === 'error');
  const allTerminal = agents.length > 0 && running.length === 0;

  // 多 agent 场景: 一旦有 agent 进入终态, 自动折叠回摘要行
  useEffect(() => {
    if (allTerminal) setExpanded(false);
  }, [allTerminal]);

  // 全部终态 → 3s 后淡出并通知上层清空
  useEffect(() => {
    if (!allTerminal) { setFading(false); return; }
    const t1 = setTimeout(() => setFading(true), 3000);
    const t2 = setTimeout(() => onAllFinished?.(), 3400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [allTerminal, onAllFinished]);

  // agents 为空不再渲染 (上层清空后自动卸载)
  if (!agents || agents.length === 0) return null;

  // 摘要行文案
  const summaryBits: string[] = [`${agents.length} 个子智能体`];
  if (running.length > 0) summaryBits.push(`${running.length} 运行中`);
  if (done.length > 0) summaryBits.push(`${done.length} 完成`);
  if (failed.length > 0) summaryBits.push(`${failed.length} 失败`);

  const autoCollapse = agents.length > 1; // 单 agent 不折叠

  const renderAgentRow = (agent: SubagentInfo) => {
    const label = ROLE_LABELS[agent.type] || agent.type;
    const icon = ROLE_ICONS[agent.type] || '🤖';
    const isRunning = agent.status === 'running';
    const isError = agent.status === 'error';
    const isDone = agent.status === 'done';

    return (
      <div key={agent.id} style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 6px',
        marginBottom: 2,
        borderRadius: 4,
        background: isRunning ? 'var(--bg)' : 'transparent',
        opacity: isDone ? 0.7 : 1,
        transition: 'all 0.2s',
      }}>
        <span style={{ fontSize: 'var(--fs-md)', flexShrink: 0 }}>{icon}</span>
        <span style={{ fontWeight: 500, color: 'var(--fg)', flexShrink: 0 }}>
          {label}
        </span>
        {isRunning && (
          <>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent)',
              flexShrink: 0,
              animation: 'pulse 1s ease-in-out infinite',
            }}/>
            <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
              {agent.task}
            </span>
          </>
        )}
        {isDone && (
          <span style={{ color: 'var(--success)', flexShrink: 0 }}>✓</span>
        )}
        {isError && (
          <span style={{ color: 'var(--danger)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            ✗ {agent.error}
          </span>
        )}
      </div>
    );
  };

  const hasSteps = agents.some(a => a.steps && a.steps.length > 0);

  return (
    <div style={{
      margin: '8px 0',
      padding: '8px 10px',
      borderRadius: 8,
      background: 'var(--accent-soft)',
      border: '1px solid var(--border)',
      fontSize: 'var(--fs-sm)',
      lineHeight: 1.6,
      opacity: fading ? 0 : 1,
      transition: 'opacity 0.4s',
    }}>
      {/* 摘要行 / 展开开关 */}
      <div
        onClick={() => autoCollapse && setExpanded(v => !v)}
        style={{
          fontWeight: 600,
          color: 'var(--fg-2)',
          fontSize: 'var(--fs-micro)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: autoCollapse ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <span>🤖</span>
        <span>{autoCollapse ? '子智能体' : `子智能体 (${agents.length})`}</span>
        {autoCollapse && (
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
            {summaryBits.join(' · ')}
          </span>
        )}
        {running.length > 0 && (
          <span style={{ color: 'var(--accent)', marginLeft: autoCollapse ? 0 : 6 }}>
            · {running.length} 运行中
          </span>
        )}
        {autoCollapse && (
          <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{expanded ? '▲ 收起' : '▼ 展开'}</span>
        )}
      </div>

      {/* 详情区 (折叠时隐藏) */}
      {(!autoCollapse || expanded) ? (
        <div style={{ marginTop: 6 }}>
          {agents.map(renderAgentRow)}

          {hasSteps && expanded && (
            <div style={{
              marginTop: 6, paddingTop: 6,
              borderTop: '1px solid var(--border)',
              fontSize: 'var(--fs-micro)', color: 'var(--muted)', lineHeight: 1.7,
            }}>
              {agents.filter(a => a.steps && a.steps.length > 0).map(a => {
                const label = ROLE_LABELS[a.type] || a.type;
                const tail = (a.steps || []).slice(-3);
                const hidden = (a.steps || []).length - tail.length;
                return (
                  <div key={`steps-${a.id}`} style={{ marginBottom: 2 }}>
                    <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>{label}</span>
                    {hidden > 0 && <span style={{ opacity: 0.6 }}> （前 {hidden} 步已折叠）</span>}
                    {tail.map((s, i) => (
                      <div key={i} style={{
                        paddingLeft: 10, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {s}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* 折叠态摘要统计 (多 agent 且收起时) */}
      {autoCollapse && !expanded && (
        <div style={{
          marginTop: 4,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          color: 'var(--muted)',
          fontSize: 'var(--fs-micro)',
        }}>
          {running.length > 0 && <span style={{ color: 'var(--accent)' }}>▶ {running.length} 运行中</span>}
          {done.length > 0 && <span style={{ color: 'var(--success)' }}>✓ {done.length} 完成</span>}
          {failed.length > 0 && <span style={{ color: 'var(--danger)' }}>✗ {failed.length} 失败</span>}
        </div>
      )}

      {pending && running.length === 0 && agents.length > 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-micro)', marginTop: 4 }}>
          ⏳ 等待子智能体启动...
        </div>
      )}
    </div>
  );
};

export default SubagentStatus;
