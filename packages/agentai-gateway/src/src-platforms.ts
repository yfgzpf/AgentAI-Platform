/**
 * src-platforms.ts — SRC 平台档案 (2026-10-16)
 * ============================================================================
 * 问题现场 (富哥实机): "如果我同时授权多个SRC, 系统没有自动处理挖到了,
 *   不能正确对应SRC到底座是属于哪家的问题, 这也会导致我们的浪费"
 *
 * 现状缺陷 (2026-10-16 审计确认):
 *   - scope.json 的 targets 元素有 source 字段, 但只是**自由文本字符串**
 *     ("漏洞盒子" / "补天" / "自加"), 无稳定 ID、无元数据
 *   - `grant_scope` 工具写入时用 string[] 覆盖 → **把 {host,source} 降级成裸字符串,
 *     source 全部丢失** (tools.ts的 existing.targets = targets)
 *   - deny (禁止项) 在 scope 层**完全不存在** —— 只有 src-rules.ts 内存里有
 *   - vulns.jsonl 的 platform 字段从不自动填, AI 从 list_scope 也读不到来源
 *   - batch_pentest 已经 readScopeWithSource 拿到 source, 却**没传进子智能体 task**
 *
 * 本模块做的是把 source 从"标签"升级为"实体":
 *   平台 = { id, name, baseUrl, hosts[], deny[], forbiddenActions[], rewards[], note }
 *   - hosts 与 deny 都参与 isTargetInScope 判定, 且 **deny 永远优先**
 *   - 任何 host 都能反查归属平台 → report_vulnerability 自动带 platform
 *   - batch_pentest 按平台分组投喂, AI 明确知道"这个洞该报给谁"
 *
 * 存储: <workspace>/.agentai/src-platforms.json (单文件, 原子写)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { normWsPath } from './ws-paths.js';

// ═══════════════════ 类型 ═══════════════════

export interface SrcPlatform {
  /** 稳定 ID (slug, 如 "vulbox-vala") —— 归属判定与去重都用它, 不依赖显示名 */
  id: string;
  /** 显示名 (如 "漏洞盒子·vala") */
  name: string;
  /** 平台页面地址 (可选) */
  baseUrl?: string;
  /** 该平台授权的目标 (含通配符) */
  hosts: string[];
  /** 该平台**明确禁止**的目标 —— 全局硬闸门, deny 优先于任何 allow */
  deny: string[];
  /** 禁止的行为 (不是域名, 是"不许做什么") */
  forbiddenActions: string[];
  /** 奖励等级线索 (帮 AI 优先打高价值面) */
  rewards: string[];
  /** 原始解析置信度 (0~1), 低说明页面没解析清楚 */
  confidence?: number;
  /** 是否已被人类确认 */
  confirmed: boolean;
  /** 导入来源: 'paste' | 'url' | 'manual' */
  importedFrom?: string;
  ts: number;
}

export interface SrcPlatformsFile {
  version: 1;
  platforms: SrcPlatform[];
  updated: number;
}

// ═══════════════════ 路径与读写 ═══════════════════

export function srcPlatformsPath(ws: string): string {
  return normWsPath(ws) + '/.agentai/src-platforms.json';
}

function ensureDir(ws: string): string {
  const dir = path.join(normWsPath(ws), '.agentai');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 原子写: 先写 .tmp 再 rename, 防进程被杀留下半截 JSON (会读出空平台表) */
function writeFileAtomic(file: string, data: string): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function readSrcPlatforms(ws: string): SrcPlatform[] {
  try {
    const file = srcPlatformsPath(ws);
    if (!fs.existsSync(file)) return [];
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as SrcPlatformsFile;
    if (!j || j.version !== 1 || !Array.isArray(j.platforms)) return [];
    return j.platforms.filter(p => p && p.id && Array.isArray(p.hosts));
  } catch { return []; }
}

export function writeSrcPlatforms(ws: string, platforms: SrcPlatform[]): string {
  ensureDir(ws);
  const file = srcPlatformsPath(ws);
  const payload: SrcPlatformsFile = { version: 1, platforms, updated: Date.now() };
  writeFileAtomic(file, JSON.stringify(payload, null, 2));
  return file;
}

// ═══════════════════ ID 生成 ═══════════════════

/**
 * 由平台名/URL 生成稳定 slug。
 * 优先从 baseUrl 取 host (valasrc.vulbox.com → vulbox), 否则用名字音译保留英文与数字。
 * 中文名会退化 —— 所以**建议**用 URL 导入, 或显式传 id。
 */
export function slugifyPlatform(nameOrUrl: string): string {
  const s = String(nameOrUrl || '').trim();
  if (!s) return 'unknown';
  // 优先从 URL 取 host
  const urlMatch = s.match(/https?:\/\/([^/\s?#]+)/i);
  if (urlMatch) {
    const host = urlMatch[1].replace(/^www\./, '');
    return host.replace(/[^a-z0-9.-]/gi, '-').toLowerCase();
  }
  // 否则取英文/数字部分
  const ascii = s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  if (ascii) return ascii;
  // 全中文 → 用时间戳兜底(保证唯一, 但可读性差)
  return `p-${Date.now().toString(36)}`;
}

// ═══════════════════ 归属查询 ═══════════════════

/**
 * host 通配符匹配 —— 与 pentest-scope-guard.isTargetInScope 的语义保持一致:
 *   `*.a.com` 覆盖 x.a.com / x.y.a.com, **不覆盖**裸 a.com, 也不匹配 evil-a.com
 */
export function hostMatches(pattern: string, target: string): boolean {
  const p = String(pattern || '').trim().toLowerCase();
  const t = String(target || '').trim().toLowerCase();
  if (!p || !t) return false;
  if (p.startsWith('*.') && p.length > 2) {
    return t.endsWith('.' + p.slice(2));
  }
  return t === p || t.endsWith('.' + p);
}

/**
 * 判断 target 是否被**任何平台**明确禁止。
 * ⚠️ 这是比isTargetInScope 更强的拒绝 —— 无论 target 是否在某个平台授权范围内,
 *   只要命中任一平台的 deny, 就是禁止。deny 优先于 allow 是安全底线:
 *   平台清单常常在授权通配里**包含**了禁止的子域 (实测 src-rules 就是这种情况)。
 */
export function isDeniedByAnyPlatform(ws: string, target: string): { denied: boolean; platformId?: string; pattern?: string } {
  const t = String(target || '').trim().toLowerCase();
  if (!t) return { denied: false };
  for (const p of readSrcPlatforms(ws)) {
    for (const d of p.deny || []) {
      if (hostMatches(d, t)) return { denied: true, platformId: p.id, pattern: d };
    }
  }
  return { denied: false };
}

/**
 * 反查 target 归属哪个平台 (用于 report_vulnerability 自动填 platform)。
 * 多个平台都覆盖时, 返回**命中范围最具体**的那个 (最长 pattern优先),
 * 因为 `*.api.example.com` 比 `*.example.com` 更精确。
 */
export function findPlatformForTarget(ws: string, target: string): SrcPlatform | null {
  const t = String(target || '').trim().toLowerCase();
  if (!t) return null;
  let best: { p: SrcPlatform; len: number } | null = null;
  for (const p of readSrcPlatforms(ws)) {
    // 跳过未确认的平台: 未确认时 AI 不该据此开扫, 归属也暂不生效
    if (!p.confirmed) continue;
    for (const h of p.hosts || []) {
      if (!hostMatches(h, t)) continue;
      const len = h.replace(/^\*\./, '').length;
      if (!best || len > best.len) best = { p, len };
    }
  }
  return best?.p || null;
}

/** 按平台分组的授权目标 —— batch_pentest 用它按平台投喂 */
export function groupHostsByPlatform(ws: string): Array<{ platform: SrcPlatform; hosts: string[] }> {
  const out: Array<{ platform: SrcPlatform; hosts: string[] }> = [];
  for (const p of readSrcPlatforms(ws)) {
    if (!p.confirmed || !p.hosts?.length) continue;
    out.push({ platform: p, hosts: p.hosts });
  }
  return out;
}

// ═══════════════════ 从 src-rules 导入 ═══════════════════

/**
 * 把 src-rules.ts 的解析结果转成平台档案。
 *
 * 设计要点: **deny 直接进平台档案**, 而不只是留在 src-rules.json ——
 * 因为只有进了平台档案, isDeniedByAnyPlatform 才能在授权闸门里硬拦截它。
 * "禁止项只是给人看的文字" 就是漏洞。
 */
export function platformFromParsed(input: {
  id?: string;
  name: string;
  baseUrl?: string;
  inScope: string[];
  outOfScope: string[];
  forbiddenActions: string[];
  rewards: string[];
  confidence?: number;
  confirmed?: boolean;
  importedFrom?: string;
}): SrcPlatform {
  const id = (input.id && /^[a-z0-9._-]+$/i.test(input.id))
    ? input.id
    : slugifyPlatform(input.baseUrl || input.name);
  return {
    id,
    name: input.name || id,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    hosts: [...new Set(input.inScope.map(h => h.trim()).filter(Boolean))].sort(),
    deny: [...new Set(input.outOfScope.map(h => h.trim()).filter(Boolean))].sort(),
    forbiddenActions: [...new Set(input.forbiddenActions.filter(Boolean))].sort(),
    rewards: [...new Set(input.rewards.filter(Boolean))].slice(0, 20),
    ...(typeof input.confidence === 'number' ? { confidence: input.confidence } : {}),
    confirmed: input.confirmed === true,
    ...(input.importedFrom ? { importedFrom: input.importedFrom } : {}),
    ts: Date.now(),
  };
}

/**
 * 导入/更新一个平台 (同 id 则合并 hosts/deny, 不覆盖已确认状态)。
 * 合并而不是替换的理由: 用户分多次粘贴同一平台页面, 不该把上次解析的结果清掉。
 */
export function upsertPlatform(ws: string, platform: SrcPlatform): { platform: SrcPlatform; created: boolean } {
  const list = readSrcPlatforms(ws);
  const idx = list.findIndex(p => p.id === platform.id);
  if (idx < 0) {
    list.push(platform);
    writeSrcPlatforms(ws, list);
    return { platform, created: true };
  }
  const old = list[idx]!;
  const merged: SrcPlatform = {
    ...old,
    ...platform,
    // 合并而非覆盖: 新解析可能是页面的一部分
    hosts: [...new Set([...old.hosts, ...platform.hosts])].sort(),
    deny: [...new Set([...old.deny, ...platform.deny])].sort(),
    forbiddenActions: [...new Set([...old.forbiddenActions, ...platform.forbiddenActions])].sort(),
    rewards: [...new Set([...old.rewards, ...platform.rewards])].slice(0, 20),
    // 已确认状态**只能由人升级为确认**, 不能被新的未确认导入降级
    confirmed: old.confirmed || platform.confirmed,
    ts: Date.now(),
  };
  // deny 与 hosts 的冲突清理: 命中 deny 的 host 不该留在授权列表
  const deniedBare = merged.deny.map(d => d.replace(/^\*\./, '').toLowerCase());
  merged.hosts = merged.hosts.filter(h => {
    const bare = h.replace(/^\*\./, '').toLowerCase();
    return !deniedBare.some(d => bare === d || bare.endsWith('.' + d));
  });
  list[idx] = merged;
  writeSrcPlatforms(ws, list);
  return { platform: merged, created: false };
}

/** 确认某平台 (人类在面板点确认) */
export function confirmPlatform(ws: string, id: string): boolean {
  const list = readSrcPlatforms(ws);
  const p = list.find(x => x.id === id);
  if (!p) return false;
  p.confirmed = true;
  writeSrcPlatforms(ws, list);
  return true;
}

export function removePlatform(ws: string, id: string): boolean {
  const list = readSrcPlatforms(ws);
  const next = list.filter(p => p.id !== id);
  if (next.length === list.length) return false;
  writeSrcPlatforms(ws, next);
  return true;
}

// ═══════════════════ AI 投喂 ═══════════════════

/**
 * 生成投喂给 AI 的上下文 —— 这是消除"AI 反复追问授权"的关键。
 *
 * 三个必备信息, 缺一个 AI 就会回头问:
 *   ① 各平台分别授权了什么 (归属!)
 *   ② 哪些是明确禁止的 (硬拦截)
 *   ③ 报告该发给谁
 */
export function renderPlatformsForAi(ws: string): string {
  const list = readSrcPlatforms(ws);
  if (!list.length) return '';

  const L: string[] = [];
  const confirmed = list.filter(p => p.confirmed);
  const unconfirmed = list.filter(p => !p.confirmed);

  if (confirmed.length) {
    L.push(`🎯 已授权的 SRC 平台 (${confirmed.length} 家) —— 这些资产已获人类授权，直接开扫，不要再逐个向我确认:`);
    for (const p of confirmed) {
      L.push(`\n【${p.name}】(platform id: ${p.id}) — 授权 ${p.hosts.length} 个目标`);
      for (const h of p.hosts) L.push(`   · ${h}`);
      if (p.rewards.length) {
        L.push(`   奖励参考: ${p.rewards.slice(0, 4).join(' / ')}`);
      }
      if (p.forbiddenActions.length) {
        L.push(`   ⛔ 该平台禁止的行为: ${p.forbiddenActions.join('、')}`);
      }
    }
  }

  if (unconfirmed.length) {
    L.push(`\n⏳ 待人类确认的平台 (${unconfirmed.length} 家) —— ⚠️ 未经确认,**不要对这些资产发起扫描或攻击**, 需要时我会先问你:`);
    for (const p of unconfirmed) {
      L.push(`   · ${p.name} (${p.hosts.length} 个目标待确认)`);
    }
  }

  // 全局 deny (跨平台汇总 —— 同一家公司不同项目可能互相矛盾, 这里一律最严)
  const allDeny = new Map<string, string[]>(); // host -> platformIds
  for (const p of list) {
    for (const d of p.deny) {
      const k = d.toLowerCase();
      allDeny.set(k, [...(allDeny.get(k) || []), p.id]);
    }
  }
  if (allDeny.size) {
    L.push(`\n🚫 全局禁止目标 (${allDeny.size} 个) —— 命中即拒，**deny 优先于任何授权**:`);
    for (const [d, ids] of allDeny) L.push(`   · ${d}   (来自: ${ids.join(', ')})`);
  }

  const allActions = new Set<string>();
  for (const p of list) for (const a of p.forbiddenActions) allActions.add(a);
  if (allActions.size) {
    L.push(`\n⛔ 全局禁止的行为:`);
    for (const a of [...allActions].slice(0, 20)) L.push(`   · ${a}`);
  }

  L.push('\n⚠️ 执行纪律:');
  L.push('   1. 上面的平台清单**已授权**，直接开扫，不要再逐个向我确认目标归属');
  L.push('   2. **不属于任何已确认平台**的目标 → 先 scope_guard.check_scope 查，不在清单且未提案 → 不要打');
  L.push('   3. 禁止目标与禁止行为**永久排除**，即使命中高价值线索也不要碰(deny 优先于 allow)');
  L.push('   4. 报告漏洞时用 report_vulnerability 的 platform 参数填**归属平台 id**（上面每个平台都有 id）');
  // ⚠️ "把数量堆上去"这种鼓励横扫的措辞, 在**单平台**下是对的, 在多平台下有害
  // (会诱发一锅端 + 跨项目串味)。所以按平台数条件化。
  if (confirmed.length === 1) {
    L.push('   5. 命中即停：一个目标确认可报 + 证据落盘后就换下一个，把数量堆上去');
  } else if (confirmed.length === 0) {
    L.push('   5. 暂无已确认平台 → 不要开扫, 先等我确认');
  }
  // 多平台情形由下面的「多项目隔离纪律」接管第5 条

  // ═══ 2026-10-16 多项目隔离纪律 (实机事故: 授权两个项目被一锅端) ═══
  //
  // 富哥反馈"授权了两个项目, AI 是一并探, 无法分开"。根因不是 AI 偷懒, 而是
  // 这里的清单把 N 家平台**平铺成一份**, 还给了"命中即停, 把数量堆上去"这种
  // 鼓励横扫的措辞 —— 模型自然把 10 个目标当一锅端。
  //
  // 真实代价不只是报告难分, 更严重的是**项目间串味**:
  //   · A 项目的凭据/会话被拿去打 B 项目 → 变成未授权访问
  //   · A 项目挖到的洞报给 B 项目 → 白干 + 可能触发对方风控
  //   · 两个项目规则不同 (一个禁 DoS 一个不禁), 混着做必然踩到其中一个的禁令
  const activeConfirmed = confirmed.length;
  if (activeConfirmed >= 2) {
    L.push('');
    L.push(`🚨🚨 多项目隔离纪律 (你有 ${activeConfirmed} 个已授权项目, **必须分开探测**) 🚨🚨`);
    L.push(`   把上面 ${activeConfirmed} 家平台当成 ${activeConfirmed} 个**互不相干的独立任务**, 不是一批目标:`);
    L.push(`   ① **一次只做一个项目**, 做完整 (侦察→验证→证据落盘→report_vulnerability) 再换下一个;`);
    L.push(`   ② **绝不跨项目混用上下文**: 凭据/Cookie/session/接口路径发现**不得**从 A 项目带到 B 项目;`);
    L.push(`      拿 A 的凭据打 B = 未授权访问, 这是最严重的事故, 比漏挖严重得多;`);
    L.push(`   ③ **汇报必须按项目分节**: 每家平台单独一段, 开头写清【平台名/platform id】,`);
    L.push(`      不要把多家平台的发现混在同一段里 —— 我要按项目分别提交/分别对账;`);
    L.push(`   ④ **禁令按项目分别遵守**: 不同项目规则可能不同, 做完 A 不要把 A 的规则套到 B;`);
    L.push(`   ⑤ 如果时间/轮次不够, **先明确告诉我你打算先做哪个项目**, 我同意后再开始, 不要自己排序硬扫。`);
  }

  return L.join('\n');
}
/**
 * 2026-10-16: scope.json 兜底的项目分组与隔离纪律
 * ----------------------------------------------------
 * 为什么需要兜底: 富哥实机的授权入口最早只是往 scope.json 里塞目标
 * (source 字段是 'unknown'/'manual'/'ai-granted'), **没有建平台档案也没有签声明**。
 * 而 renderPlatformsForAi 只看平台档案、renderAuthForAi 只看声明 ——
 * 这两种情况下多项目隔离纪律**一条都不会注入**, 于是 AI 必然一锅端(实机确认)。
 *
 * 所以再补一层: 直接从 scope.json 的 source 字段做分组。
 * `unknown` / `ai-granted` / `manual` 这类**不是真实项目名**的标记要归到
 * "未归属"组 (并提示用户去面板补归属), 不能把它们各自当成一个独立项目 ——
 * 那会凭空造出三个项目让 AI 去"分别探测", 反而更乱。
 *
 * 返回 '' 表示只有 0 或 1 个真实项目 (无需隔离纪律)。
 */
export async function renderScopeGroupsForAi(ws: string): Promise<string> {
  let targets: Array<{ host: string; source: string }>;
  try {
    // ⚠️ 静态 import 会与 pentest-scope-guard 成环 (guard 也 import 本模块做 deny 闸门),
    //   所以这里必须用**动态** import。ESM 下 require() 不可用(本项目老坑)。
    const guard = await import('./pentest-scope-guard.js');
    targets = guard.readScopeWithSource(ws);
  } catch {
    return '';
  }
  if (!targets.length) return '';

  // 非真实项目名的占位标记 —— 归入"未归属"而不是各自成组
  const PLACEHOLDERS = new Set(['unknown', 'manual', 'ai-granted', 'panel', 'gui', '']);
  const groups = new Map<string, string[]>();
  let ungrouped = 0;
  for (const t of targets) {
    const src = (t.source || '').trim();
    if (PLACEHOLDERS.has(src.toLowerCase())) { ungrouped++; continue; }
    groups.set(src, [...(groups.get(src) || []), t.host]);
  }

  // 真实项目 < 2 → 无需隔离纪律
  if (groups.size < 2) return '';

  const L: string[] = [];
  L.push('');
  L.push(`🚨🚨 授权范围里有 ${groups.size} 个不同项目 (按来源区分), **必须分开探测** 🚨🚨`);
  L.push(`   当前授权范围共 ${targets.length} 个目标, 归属如下:`);
  for (const [name, hosts] of groups) {
    L.push(`\n   【${name}】(${hosts.length} 个目标)`);
    for (const h of hosts.slice(0, 30)) L.push(`      · ${h}`);
    if (hosts.length > 30) L.push(`      … 另 ${hosts.length - 30} 个`);
  }
  if (ungrouped) {
    L.push(`\n   【未归属】(${ungrouped} 个目标, 来源未标注)`);
    L.push(`      这些目标的归属不明 —— 探测它们前先告诉我它们属于哪个项目, 别混进上面任何一家。`);
  }
  L.push('');
  L.push(`   把这 ${groups.size} 个项目当成 ${groups.size} 个**互不相干的独立任务**, 不是一批目标:`);
  L.push(`   ① **一次只做一个项目**, 做完整 (侦察→验证→证据落盘→report_vulnerability) 再换下一个;`);
  L.push(`   ② **绝不跨项目混用上下文**: 凭据/Cookie/session/接口路径发现**不得**从 A 项目带到 B 项目;`);
  L.push(`      拿 A 的凭据打 B = 未授权访问, 这是最严重的事故, 比漏挖严重得多;`);
  L.push(`   ③ **汇报必须按项目分节**: 每家单独一段, 开头写清【项目名】, 不要混在一起;`);
  L.push(`   ④ **禁令按项目分别遵守**: 不同项目规则可能不同, 不要把 A 的规则套到 B;`);
  L.push(`   ⑤ 如果轮次不够, **先告诉我要先做哪个项目**, 我同意后再开始, 不要自己排序硬扫。`);
  return L.join('\n');
}
