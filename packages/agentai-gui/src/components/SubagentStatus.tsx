/**
 * SubagentStatus — 子智能体状态实时显示
 * ----------------------------------------------------
 * 在 AI 回复流中紧凑显示子 Agent 的执行状态
 * 流式时展开显示所有 Agent, 完成后折叠为摘要
 */
import React from 'react';

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

export const SubagentStatus: React.FC<SubagentStatusProps> = ({ agents, pending }) => {
  if (!agents || agents.length === 0) return null;

  const running = agents.filter(a => a.status === 'running');
  const done = agents.filter(a => a.status === 'done');
  const failed = agents.filter(a => a.status === 'error');

  return (
    <div style={{
      margin: '8px 0',
      padding: '8px 10px',
      borderRadius: 8,
      background: 'var(--accent-soft)',
      border: '1px solid var(--border)',
      fontSize: 12,
      lineHeight: 1.6,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--fg-2)', fontSize: 11 }}>
        🤖 子智能体 {agents.length > 0 && `(${agents.length})`}
        {running.length > 0 && (
          <span style={{ marginLeft: 6, color: 'var(--accent)' }}>
            · {running.length} 运行中
          </span>
        )}
      </div>
      {agents.map(agent => {
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
            <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
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
      })}
      {/* 2026-10-05: 真正渲染 steps —— 此前 ChatView 收集了几十条步骤描述，
          这里一个都没消费，属于"只做了 UI 没接线"。运行中显示最近 3 步。 */}
      {agents.some(a => a.steps && a.steps.length > 0) && (
        <div style={{
          marginTop: 6, paddingTop: 6,
          borderTop: '1px solid var(--border)',
          fontSize: 11, color: 'var(--muted)', lineHeight: 1.7,
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
      {pending && running.length === 0 && agents.length > 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
          ⏳ 等待子智能体启动...
        </div>
      )}
    </div>
  );
};

export default SubagentStatus;