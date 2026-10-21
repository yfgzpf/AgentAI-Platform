/**
 * 赏金跨会话记忆 (2026-10-21, 富哥拍板)
 * ═══════════════════════════════════════════════════════════════════════
 * 富哥原话: 「你要每次做这个赏金任务都不会再重复犯错的」+
 *   「如果用户不用继续就不要回顾这个是不对的」。
 *
 * 旧行为 (routes/chat.ts 跨会话注入块) 的两宗罪:
 *   ① 非"继续"开头的消息只注入 1 行摘要, 还附一句
 *      "当前是新任务, 除非用户提到继续, 否则不要回顾上次" ——
 *      **主动命令 AI 丢弃上次上下文**。赏金 engagement 跨天是常态,
 *      用户新开会话问"接着挖 AnyShare"时不会说"继续",
 *      于是上次的发现/错误/目标状态全部蒸发 → 重复探测、重复踩坑
 *      (/tmp/jxnu 没建目录、Windows 路径读 WSL 侧文件 ENOENT …)。
 *   ② 60 分钟新鲜度门槛对赏金过紧 (中午的会话晚上就断忆)。
 *
 * 本模块把"继承上次进度"变成**无条件注入** (赏金工作区):
 *   · 目标状态快照 — save_target_state 历次落盘的真源 (与消息无关,
 *     新会话没有 _prevPmSessionId 链接时也能注入);
 *   · 上次请求 / 已确认发现 / 已犯错误 — 从上次会话消息提取
 *     (发现走 finding-extract.ts 单一真源, 与压缩摘要/台账同款判据)。
 *
 * 注入指令的措辞从"不要回顾"翻转为:
 *   「直接继承; 已测/已排除不要重复; 已犯错误不要重犯」。
 *
 * 设计约束: 纯函数、零 LLM、fail-safe (坏输入返回空串, 绝不抛)。
 * ═══════════════════════════════════════════════════════════════════════
 */

import { extractFindings } from './finding-extract.js';
import { loadAllTargetStates, formatTargetStateBrief } from './pentest/target-state.js';

/** 上次会话消息的最小形态 (persistent-memory 的 ChatMessage 子集) */
export interface MemoryMsg {
  role: string;
  content?: string;
  toolName?: string;
}

/** 各部分配额 (注入是每轮都拼的, 必须控量) */
const MAX_REQUESTS = 3;
const MAX_FINDINGS = 8;
const MAX_ERRORS = 5;
const MAX_STATES = 3;
/** 提取发现时最多回看多少条产出 (扫描输出可能很长) */
const SCAN_TAIL = 20;
/** 错误行判定: 首 300 字符命中即认为该工具有失败迹象 */
const ERROR_HEAD_RE = /error|失败|FAILED|✗|❌|not found|ENOENT|超时|timeout|拒绝|blocked/i;
/** 错误证据行: 行内命中 + 长度合法 (过滤装饰线) */
const ERROR_LINE_RE = /error|失败|FAILED|✗|❌|not found|ENOENT|超时|timeout|拒绝|blocked/i;

function clip(s: string, n: number): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, n);
}

/**
 * 目标状态快照段 (与上次消息无关, 新会话无 prev 链接时也能继承)。
 * 无快照返回空串。
 */
export function buildBountyTargetStateBlock(ws: string): string {
  const states = loadAllTargetStates(ws).slice(0, MAX_STATES);
  const briefs = states.map((st) => formatTargetStateBrief(st)).filter(Boolean);
  if (briefs.length === 0) return '';
  return [
    '## 🗺️ 目标状态快照 (跨会话落盘, save_target_state 真源)',
    ...briefs,
    '(以上为本工作区历次沉淀的目标进度 — **直接继承, 已测/已排除项不要重复, 聚焦待打点**)',
  ].join('\n');
}

/**
 * 从上次会话消息提取: 请求 + 已确认发现 + 已犯错误。
 * 全部为空且无目标快照时返回空串 (不注入空块)。
 */
export function buildBountyCrossSessionMemory(ws: string, msgs?: MemoryMsg[]): string {
  const lines: string[] = ['## 🎯 赏金任务跨会话记忆 (继承上次进度, 不要重复犯错)'];

  // ① 上次请求 (最近 N 条)
  const userTurns = (msgs || []).filter((m) => m.role === 'user');
  if (userTurns.length > 0) {
    const reqs = userTurns.slice(-MAX_REQUESTS).map((m, i) => `${i + 1}. ${clip(String(m.content || ''), 150)}`);
    lines.push(`\n**上次会话请求**:\n${reqs.join('\n')}`);
  }

  // ② 已确认发现 — F0 单一真源 (与压缩摘要/台账同判据)
  const findings: string[] = [];
  const outputs = (msgs || []).filter((m) => m.role === 'assistant' || m.role === 'tool').slice(-SCAN_TAIL);
  for (const m of outputs) {
    for (const f of extractFindings(String(m.content || ''), { max: 3 })) {
      if (!findings.includes(f)) findings.push(f);
    }
    if (findings.length >= MAX_FINDINGS) break;
  }
  if (findings.length > 0) {
    lines.push(`\n**已确认发现 (事实 — 不要重复探测/读取)**:\n${findings.slice(0, MAX_FINDINGS).map((f) => `- ${f}`).join('\n')}`);
  }

  // ③ 已犯错误 (工具失败证据行, 去重)
  const errors: string[] = [];
  for (const m of (msgs || []).filter((m) => m.role === 'tool').slice(-30)) {
    const c = String(m.content || '');
    if (!ERROR_HEAD_RE.test(c.slice(0, 300))) continue;
    const bad = c.split('\n').map((l) => l.trim())
      .find((l) => l.length >= 8 && l.length <= 200 && ERROR_LINE_RE.test(l));
    if (!bad) continue;
    const entry = `${m.toolName || 'tool'}: ${clip(bad, 120)}`;
    if (!errors.includes(entry)) errors.push(entry);
    if (errors.length >= MAX_ERRORS) break;
  }
  if (errors.length > 0) {
    lines.push(`\n**已犯错误 (不要重犯)**:\n${errors.map((e) => `- ${e}`).join('\n')}`);
  }

  // ④ 目标状态快照 (与消息无关的真源)
  const tsBlock = buildBountyTargetStateBlock(ws);
  if (tsBlock) lines.push(`\n${tsBlock}`);

  // 只有标题 = 什么都没有 → 不注入空块
  if (lines.length === 1) return '';
  lines.push('\n💡 直接继承以上进度; 已测/已排除项不要重复, 已犯错误不要重犯; 与当前任务无关的条目忽略。');
  return lines.join('\n');
}
