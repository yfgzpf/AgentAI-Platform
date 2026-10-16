/**
 * curriculum.ts — 全局「课程循环」(RSIAgent 式 探索→验证→沉淀, 2026-10-16)
 *
 * 背景 (2026-10-16, 7 篇 RSIAgent/技能生态文章学习后落地):
 * 现有 model-distiller 已实现「success 条目 → 聚类蒸馏 → 注入 prompt / 装 cron」,
 * 但 success 条目只有"任务完成了 N 轮"这种**笼统记录**, 缺"哪条技术路线有效"的
 * **技术粒度**沉淀。本模块补这个缺口, 不新建存储 — 写侧走 evolution.jsonl,
 * 读侧走 recallEvolution + extractPatterns 既有管道。
 *
 * 两个入口:
 * - distillRound(ws, opts) — 写侧: loop 终态 (loop:done) 调用, 把"本轮有效路线"
 *   沉淀为 type:'success' 进化条目 + 工作区 .agentai/curriculum.json (GUI 可查)。
 * - focusBlock(ws, taskType, maxChars) — 读侧: buildImmutablePrefix §1.1 区调用,
 *   召回同 taskType 历史有效路线, 渲染成一段注入文本 (弱模型区, 强模型门控在外层)。
 *
 * 安全边界:
 * - 所有 evolution 写走 requireEvolution 冻结门 (evolution-freeze), 冻结期不写不抛
 * - pentest 特化段只读 (vulns.jsonl / cve 告警), 不打目标, 不影响 scope_guard 闸门
 * - 全程 try/catch, 课程循环失败**绝不阻塞**主循环收尾
 */

import * as fs from 'fs';
import * as path from 'path';
import { writeEvolution, recallEvolution, extractPatterns } from './evolution.js';
import { requireEvolution } from './evolution-freeze.js';
import type { TaskLedgerSnapshot } from './task-ledger.js';

// ===== 工作区层: 近 5 轮有效路线 + 下轮焦点 (GUI 展示/调试, 不注入 prompt) =====

export interface CurriculumRound {
  ts: number;
  taskType: string;
  goal: string;
  technique: string;          // 本轮判定有效的那条路线 (一句话)
  nextFocus: string;          // 下轮该聚焦什么 (一句话)
  effective: boolean;
}

export interface CurriculumState {
  rounds: CurriculumRound[];   // 近 5 轮 (FIFO)
  nextFocus: string;           // 最近一轮的 nextFocus (下轮开场用)
  updated: number;
}

const MAX_ROUNDS = 5;

function curriculumPath(ws: string): string {
  // 与 pentest-scope-guard 的 .agentai/ 同层 (ws 已归一化, 字符串拼接不走 path.join
  // 防中文反斜杠路径损坏 — 同 scope.json 的口径)
  return (ws || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '') + '/.agentai/curriculum.json';
}

function readState(ws: string): CurriculumState {
  try {
    const f = curriculumPath(ws);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')) as CurriculumState;
  } catch { /* 损坏/缺文件 → 空态 */ }
  return { rounds: [], nextFocus: '', updated: 0 };
}

function writeState(ws: string, s: CurriculumState): void {
  try {
    const f = curriculumPath(ws);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(s, null, 2), 'utf8');
  } catch (e: any) {
    console.warn('[curriculum] 工作区状态写盘失败 (不影响主流程):', e?.message);
  }
}

// ===== 写侧: 本轮有效路线沉淀 =====

export interface DistillRoundOpts {
  /** 任务目标 (一句话, 缺省用 ledger.userGoal) */
  goal?: string;
  taskType: 'coding' | 'research' | 'media' | 'industry' | 'general';
  /** 本轮判定"有效"的技术路线 (一句话摘要)。空 = 本轮无明确有效路线, 跳过沉淀 */
  technique: string;
  /** 下一轮该聚焦什么 (一句话)。空 = 自动 */
  nextFocus?: string;
  /** 本轮证据级成功信号 (hasSuccessfulWrite / quickScore>=0.4), false 时不写"有效" */
  verified: boolean;
  /** 本轮台账 (读/写/命令/失败), 供 technique 摘要与下轮焦点 */
  ledger?: TaskLedgerSnapshot;
  /** pentest 特化: 额外扫 vulns.jsonl 本轮新命中 + KEV 告警, 生成下轮攻击焦点 */
  pentest?: boolean;
  keywords?: string[];
  userId?: string;
}

/**
 * 课程循环写侧入口 — loop 终态调用。
 * ① 技术粒度 success 条目 → evolution.jsonl (走冻结门)
 * ② 近 5 轮 + 下轮焦点 → 工作区 .agentai/curriculum.json
 * 永不抛异常 (课程循环失败不能拖垮主循环)。
 */
export function distillRound(ws: string, opts: DistillRoundOpts): { written: boolean; reason?: string } {
  try {
    if (!opts.verified || !opts.technique || !String(opts.technique).trim()) {
      return { written: false, reason: '未验证或无有效路线, 跳过沉淀' };
    }
    const goal = String(opts.goal || opts.ledger?.userGoal || '').slice(0, 120);
    const technique = String(opts.technique).trim().slice(0, 300);
    const nextFocus = String(opts.nextFocus || '').trim() || autoNextFocus(ws, opts);

    // ① 跨会话层: 技术粒度 success (带 taskType/keywords, 供 model-distiller 聚类 + 下轮召回)
    const ok = requireEvolution(() => {
      writeEvolution({
        type: 'success',
        content: `课程沉淀: ${goal || '任务'} → 有效路线: ${technique}`,
        taskType: opts.taskType,
        keywords: opts.keywords?.length ? opts.keywords : extractKeywordsFromLedger(opts.ledger),
        metadata: { source: 'curriculum', technique, nextFocus, effective: true, pentest: !!opts.pentest },
        triggerCount: 0,
        effectCount: 1,
        userId: opts.userId,
        workspace: ws,
      });
    }, 'curriculum:distill');
    if (!ok) return { written: false, reason: '进化冻结期, 跳过 (读不受影响)' };

    // ② 工作区层: 近 5 轮 + 下轮焦点 (GUI 可查, 同任务类型下一轮开场召回)
    const st = readState(ws);
    st.rounds.push({ ts: Date.now(), taskType: opts.taskType, goal, technique, nextFocus, effective: true });
    if (st.rounds.length > MAX_ROUNDS) st.rounds = st.rounds.slice(-MAX_ROUNDS);
    st.nextFocus = nextFocus;
    st.updated = Date.now();
    writeState(ws, st);
    return { written: true };
  } catch (e: any) {
    console.warn('[curriculum] distillRound 异常 (不影响主流程):', e?.message);
    return { written: false, reason: e?.message };
  }
}

// ===== 读侧: 同 taskType 有效路线召回 =====

/** 从台账提取技术关键词 (工具名/命令特征), 供 evolution 召回过滤 */
function extractKeywordsFromLedger(ledger?: TaskLedgerSnapshot): string[] {
  if (!ledger) return [];
  const kw = new Set<string>();
  for (const c of ledger.commands?.slice(-5) || []) {
    const cmd = String(c).trim().split(/\s+/)[0];
    if (cmd && cmd.length <= 24) kw.add(cmd);
  }
  for (const f of ledger.writtenFiles?.slice(-3) || []) kw.add(path.basename(String(f)));
  return [...kw].slice(0, 8);
}

/**
 * 课程循环读侧入口 — buildImmutablePrefix §1.1 区调用。
 * 召回同 taskType 历史有效路线 + (pentest 时) vulns/告警焦点, 渲染成注入文本。
 * 无内容返回 '' (调用方不 push)。maxChars 硬截断防上下文膨胀。
 */
export function focusBlock(ws: string, taskType: string, maxChars = 600, userId?: string): string {
  try {
    const parts: string[] = [];

    // (a) 跨会话: 同 taskType 有效路线 (recall + extractPatterns 既有管道, 零新检索逻辑)
    const recalled = recallEvolution({
      taskType: taskType as any,
      userId,
      workspace: ws,
      limit: 12,
      minEffectiveness: 0.3,
      prioritizeEffective: true,
    }).filter((e: any) => e.metadata?.source === 'curriculum' || e.type === 'success');
    if (recalled.length > 0) {
      const patterns = extractPatterns(recalled).slice(0, 6);
      if (patterns.length > 0) parts.push(`🧭 历史有效路线 (同 ${taskType} 任务):\n${patterns.join('\n')}`);
    }

    // (b) 工作区: 本任务类型最近沉淀的下轮焦点 (比跨会话层更具体)
    const st = readState(ws);
    const sameType = st.rounds.filter((r: CurriculumRound) => r.taskType === taskType || taskType === 'general');
    if (sameType.length > 0) {
      const last = sameType[sameType.length - 1];
      parts.push(`🎯 上轮该类型焦点: ${last.technique} → 下轮: ${last.nextFocus || '继续深入'}`);
    }

    // (c) pentest 特化: vulns.jsonl 本轮未上报洞 + KEV 告警 → 下轮攻击面
    if (taskType === 'industry' && (readState(ws).nextFocus || '').includes('pentest')) {
      const p = pentestFocusSegment(ws, 5);
      if (p) parts.push(p);
    }

    if (parts.length === 0) return '';
    let text = parts.join('\n\n');
    if (text.length > maxChars) text = text.slice(0, maxChars) + '…';
    return `# 课程循环焦点 (探索→验证→沉淀)\n${text}`;
  } catch {
    return ''; // 读侧同样绝不阻塞主循环
  }
}

/** pentest 特化段: 读 vulns.jsonl (status=unverified 的待坐实洞) + cve 告警 (KEV), 纯读不打目标 */
function pentestFocusSegment(ws: string, maxLines: number): string {
  const norm = (s: string) => String(s || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
  const lines: string[] = [];
  try {
    const vulnsFile = norm(ws) + '/.agentai/vulns/vulns.jsonl';
    if (fs.existsSync(vulnsFile)) {
      const raw = fs.readFileSync(vulnsFile, 'utf8').split('\n').filter(Boolean).slice(-50);
      const pending = raw
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((v: any) => v && v.status === 'unverified');
      if (pending.length > 0) lines.push(`🔴 待坐实漏洞 ${pending.length} 个: ${pending.slice(0, 5).map((v: any) => `${v.target}·${v.vulnType}`).join(', ')}`);
    }
    const alertsFile = norm(ws) + '/.agentai/cve/alerts.jsonl';
    if (fs.existsSync(alertsFile)) {
      const raw = fs.readFileSync(alertsFile, 'utf8').split('\n').filter(Boolean).slice(-100);
      const kev = raw
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((a: any) => a && a.kev);
      if (kev.length > 0) lines.push(`⚠️ KEV 在野利用告警 ${kev.length} 条: ${kev.slice(0, 5).map((a: any) => `${a.cveId}→${a.host}`).join(', ')} (优先 nuclei -id 验证)`);
    }
  } catch { /* 读盘失败静默 */ }
  if (lines.length === 0) return '';
  return lines.slice(0, maxLines).join('\n');
}

/** 自动推导下轮焦点 (无显式 nextFocus 时) */
function autoNextFocus(ws: string, opts: DistillRoundOpts): string {
  if (opts.pentest) {
    try {
      const st = readState(ws);
      const p = pentestFocusSegment(ws, 2);
      if (p) return p + ' (pentest 下轮优先重扫)';
    } catch { /* fall through */ }
    return 'pentest: 对已授权目标提高 depth 重扫 / 盯哨等新 CVE';
  }
  const fail = opts.ledger?.failures?.slice(-1) || [];
  if (fail.length > 0) return `规避上轮失败点: ${String(fail[0]).slice(0, 80)}`;
  return '沿本轮有效路线继续深入, 优先处理最薄弱项';
}
