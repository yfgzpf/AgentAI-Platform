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
 *
 * 2026-10-21 治「黑箱」改造 (富哥实锤: "AI 发的子智能体是黑箱子运行, 无法看到过程"):
 *   - **transcript**: 之前只有 `steps` (一行一个字符串, 且只保留最后 3 步、单行 ellipsis 截断)
 *     → 用户完全看不到子智能体"说了什么、在想什么"。现在 transcript 分 kind 累积:
 *       thinking(深度思考) / text(模型正文) / tool(工具调用), 完整保留不截断。
 *   - **默认折叠**: 富哥要求「思考等过程是要折叠的, 不要全展开不然会不美观也太长了」。
 *     → 每个 agent 独立折叠态, 默认全折叠; 思考过程再单独一级折叠 (默认收起)。
 *   - **终态不删除**: 之前 done/error 后 5 秒整条被删 (结果只剩一个 ✓ 勾) →
 *     产出对用户隐形。现在保留折叠行, 可随时展开看结果。
 */
import React, { useEffect, useState } from 'react';

export interface SubagentTranscriptEntry {
  /** thinking = 深度思考; text = 模型正文; tool = 工具调用 */
  kind: 'thinking' | 'text' | 'tool';
  /** 内容 */
  text: string;
  /** 工具名 (kind==='tool') */
  tool?: string;
}

export interface SubagentInfo {
  id: string;
  type: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
  /**
   * 执行步骤流水（2026-10-05 补齐）
   * 骨架事件摘要 (第N轮/调用工具), 保留作"时间线"参考。
   */
  steps?: string[];
  /**
   * ★ 2026-10-21: 完整过程记录 (治黑箱核心)
   * 正文(text)/思考(thinking)/工具(tool) 分流累积, 供展开查看。
   */
  transcript?: SubagentTranscriptEntry[];
  /** 工具调用计数 */
  toolCalls?: number;
  /** 迭代轮数 */
  iterations?: number;
  /** 耗时 (ms) */
  durationMs?: number;
}

export interface SubagentStatusProps {
  agents: SubagentInfo[];
  pending: boolean;
  /** 全部进入终态后触发, 上层可清空 agents state 让容器彻底消失 */
  onAllFinished?: () => void;
  /** ★ 2026-10-21: 父任务已中断但子智能体仍在跑 —— 明确告知用户, 避免"还在跑吗"的困惑 */
  parentInterrupted?: boolean;
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

/** 折叠区滚动高度上限 —— 防止长过程把对话流撑爆 */
const SCROLL_MAX_H = 280;

export const SubagentStatus: React.FC<SubagentStatusProps> = ({ agents, pending, onAllFinished, parentInterrupted }) => {
  // 摘要层折叠 (多 agent 时的整体收起)
  const [expanded, setExpanded] = useState<boolean>(() => (agents?.length ?? 0) <= 1);
  const [fading, setFading] = useState(false);
  // ★ 2026-10-21: 每个 agent 独立展开态 —— **默认全部折叠** (富哥要求)
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set());
  // 思考过程二级折叠 —— 默认收起
  const [openThinking, setOpenThinking] = useState<Set<string>>(new Set());

  const running = agents.filter(a => a.status === 'running');
  const done = agents.filter(a => a.status === 'done');
  const failed = agents.filter(a => a.status === 'error');
  const allTerminal = agents.length > 0 && running.length === 0;

  // 多 agent 场景: 一旦有 agent 进入终态, 自动折叠回摘要行
  useEffect(() => {
    if (allTerminal) setExpanded(false);
  }, [allTerminal]);

  // 全部终态 → 3s 后淡出并通知上层清空
  // ★ 2026-10-21: **父任务已中断时不清空** —— 子智能体的成果此时是用户唯一的
  //   可见产出 (主 AI 已经退出, 不会再回来说"我接着做")。淡出会把结果一起带走。
  useEffect(() => {
    if (!allTerminal) { setFading(false); return; }
    if (parentInterrupted) return;
    const t1 = setTimeout(() => setFading(true), 3000);
    const t2 = setTimeout(() => onAllFinished?.(), 3400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [allTerminal, onAllFinished, parentInterrupted]);

  // agents 为空不再渲染 (上层清空后自动卸载)
  if (!agents || agents.length === 0) return null;

  // 摘要行文案
  const summaryBits: string[] = [`${agents.length} 个子智能体`];
  if (running.length > 0) summaryBits.push(`${running.length} 运行中`);
  if (done.length > 0) summaryBits.push(`${done.length} 完成`);
  if (failed.length > 0) summaryBits.push(`${failed.length} 失败`);

  const autoCollapse = agents.length > 1; // 单 agent 不折叠

  const toggleAgent = (id: string) => {
    setOpenAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleThinking = (id: string) => {
    setOpenThinking(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** 渲染单个 agent 的详情区 (transcript 分色: 思考/正文/工具) */
  const renderTranscript = (agent: SubagentInfo) => {
    const tr = agent.transcript || [];
    const thinking = tr.filter(e => e.kind === 'thinking');
    const body = tr.filter(e => e.kind === 'text');
    const tools = tr.filter(e => e.kind === 'tool');
    if (tr.length === 0) return null;
    const thinkOpen = openThinking.has(agent.id);

    return (
      <div style={{
        marginTop: 6, padding: '6px 8px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        fontSize: 'var(--fs-micro)',
        lineHeight: 1.7,
        maxHeight: SCROLL_MAX_H,
        overflowY: 'auto',
        wordBreak: 'break-word',
      }}>
        {/* 思考过程: 二级折叠, 默认收起 */}
        {thinking.length > 0 && (
          <div style={{ marginBottom: body.length || tools.length ? 6 : 0 }}>
            <div
              onClick={(e) => { e.stopPropagation(); toggleThinking(agent.id); }}
              style={{ cursor: 'pointer', color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <span>{thinkOpen ? '▼' : '▶'}</span>
              <span style={{ fontWeight: 500 }}>思考过程</span>
              <span style={{ opacity: 0.7 }}>({thinking.length} 段)</span>
            </div>
            {thinkOpen && (
              <div style={{
                marginTop: 4, paddingLeft: 8,
                borderLeft: '2px solid var(--border)',
                color: 'var(--muted-2)', fontStyle: 'italic',
                whiteSpace: 'pre-wrap',
              }}>
                {thinking.map((e, i) => <div key={`th-${i}`}>{e.text}</div>)}
              </div>
            )}
          </div>
        )}

        {/* 工具调用 */}
        {tools.length > 0 && (
          <div style={{ marginBottom: body.length ? 6 : 0, color: 'var(--muted)' }}>
            {tools.map((e, i) => (
              <div key={`tl-${i}`} style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
                <span style={{ opacity: 0.7 }}>🔧</span>
                <span style={{ color: 'var(--fg-2)' }}>{e.tool || e.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* 模型正文 */}
        {body.length > 0 && (
          <div style={{ color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>
            {body.map((e, i) => <div key={`tx-${i}`}>{e.text}</div>)}
          </div>
        )}
      </div>
    );
  };

  const renderAgentRow = (agent: SubagentInfo) => {
    const label = ROLE_LABELS[agent.type] || agent.type;
    const icon = ROLE_ICONS[agent.type] || '🤖';
    const isRunning = agent.status === 'running';
    const isError = agent.status === 'error';
    const isDone = agent.status === 'done';
    const isOpen = openAgents.has(agent.id);
    const hasDetail = (agent.transcript?.length || 0) > 0 || !!agent.result || !!agent.error;

    return (
      <div key={agent.id} style={{
        padding: '3px 6px',
        marginBottom: 2,
        borderRadius: 'var(--radius-sm)',
        background: isRunning ? 'var(--bg)' : 'transparent',
        opacity: isDone ? 0.85 : 1,
        transition: 'all 0.2s',
      }}>
        <div
          onClick={() => hasDetail && toggleAgent(agent.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: hasDetail ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
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
            <>
              <span style={{ color: 'var(--success)', flexShrink: 0 }}>✓</span>
              {/* ★ 结果摘要可见 (之前只渲染一个 ✓ 勾, 产出隐形) */}
              <span style={{
                color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', maxWidth: 260,
              }}>
                {agent.result || '已完成'}
              </span>
            </>
          )}
          {isError && (
            <span style={{ color: 'var(--danger)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
              ✗ {agent.error}
            </span>
          )}
          {/* 折叠指示 */}
          {hasDetail && (
            <span style={{ marginLeft: 'auto', color: 'var(--muted-2)', fontSize: 'var(--fs-micro)', flexShrink: 0 }}>
              {isOpen ? '▲' : '▼'}
            </span>
          )}
        </div>

        {/* 展开区: transcript + 最终结果 */}
        {isOpen && (
          <div onClick={(e) => e.stopPropagation()}>
            {renderTranscript(agent)}
            {(agent.result || agent.error) && (
              <div style={{
                marginTop: 4, padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                fontSize: 'var(--fs-micro)', lineHeight: 1.7,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: SCROLL_MAX_H, overflowY: 'auto',
                color: agent.error ? 'var(--danger)' : 'var(--fg)',
              }}>
                <div style={{ fontWeight: 500, color: 'var(--fg-2)', marginBottom: 2 }}>
                  {agent.error ? '失败原因' : '最终结果'}
                  {agent.iterations ? ` · ${agent.iterations} 轮` : ''}
                  {agent.durationMs ? ` · ${(agent.durationMs / 1000).toFixed(1)}s` : ''}
                </div>
                {agent.error || agent.result}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const hasSteps = agents.some(a => a.steps && a.steps.length > 0);

  return (
    <div style={{
      margin: '8px 0',
      padding: '8px 10px',
      borderRadius: 'var(--radius-md)',
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

      {/* ★ 父任务已中断但子智能体仍在跑 —— 明确告知, 不让用户以为卡死 */}
      {parentInterrupted && running.length > 0 && (
        <div style={{
          marginTop: 6, padding: '4px 7px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          color: 'var(--muted)', fontSize: 'var(--fs-micro)',
        }}>
          ⏳ 父任务已中断, {running.length} 个子智能体仍在后台运行 —— 完成后会自动唤醒主智能体接着做, 成果也会存进「子任务产物」区。
        </div>
      )}

      {/* 详情区 (折叠时隐藏) */}
      {(!autoCollapse || expanded) ? (
        <div style={{ marginTop: 6 }}>
          {agents.map(renderAgentRow)}

          {/* 骨架时间线 (最后 3 条, 保留作"第N轮/工具"速览) */}
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
