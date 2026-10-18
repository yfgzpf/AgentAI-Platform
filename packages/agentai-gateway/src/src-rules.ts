/**
 * src-rules.ts — 赏金平台规则解析器（2026-10-16）
 * ============================================================================
 * 问题现场（富哥实机）: 把 SRC 平台页面（如 valasrc.vulbox.com）整页粘进授权面板，
 * 现有解析走 `new URL('http://' + 行)` —— 于是:
 *   - 中文说明文字 "以下域名属于授权范围" → 被 URL 解析成 Punycode 垃圾
 *     `xn--wbrxos8nz2w8gc632e`（实测复现）
 *   - "DoS/CC 攻击" 里的 `DoS` → 被当成域名 `dos`
 *   - **禁止测试项完全没被识别** —— 而这恰恰是越权打标的直接原因
 *   - 结果: 授权列表里一堆垃圾域名, AI 拿不到"哪些不能打"的规则
 *
 * 本模块做的是**上下文分段 + 语义校验**, 而不是纯正则抓域名:
 *   1. 先按标题/关键词把文本切成「授权区 / 禁止区 / 奖励区 / 噪声」
 *   2. 只在授权区里提取域名, 且必须通过 TLD 白名单校验（挡掉 xn-- / dos / 中文）
 *   3. 禁止区单独提取 (含自然语言禁止项, 如 "社会工程学" "DoS")
 *   4. 奖励等级单独抽出来 (帮 AI 优先打高价值目标)
 *
 * 提取结果**全部要人工确认后才写 scope.json** —— 解析器只做"提议", 不做"授权"。
 * 这是白帽工具与攻击框架的分界线, 不能因为自动化就丢掉。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

export interface ParsedSrcPage {
  /** 建议授权的目标（已去重、已校验、已排序） */
  inScope: string[];
  /** 建议禁止的目标/行为（deny 优先于 allow） */
  outOfScope: string[];
  /** 从禁止区提炼的行为禁令（不是域名，是"不许做什么"） */
  forbiddenActions: string[];
  /** 奖励等级线索（帮 AI 优先打高价值面） */
  rewards: string[];
  /** 平台名（从标题/URL 推断，用作 source 标注） */
  platform?: string;
  /** 无法归类但含域名的行（提示用户人工看一眼，不静默丢弃） */
  uncertain: string[];
  /** 解析器整体置信度 0~1，低时要提示人工复核 */
  confidence: number;
  /** 给人看的提示 */
  notes: string[];
}

// ═══════════════════════════════════════════════════════════
// TLD 白名单（挡 Punycode / 噪声的关键）
// ═══════════════════════════════════════════════════════════

/**
 * 只认"长得像真域名"的字符串。
 *
 * 为什么必须有 TLD 白名单: `new URL('http://' + 文本)` 是**无条件**把任何东西
 * 塞进 hostname, 中文会被 punycode 编码成 xn--..., 单个英文词会被原样当主机名。
 * 只有校验末段 TLD 落在已知公共后缀里, 才能确认这真的是域名。
 */
const KNOWN_TLDS = new Set([
  'com', 'cn', 'net', 'org', 'io', 'co', 'gov', 'edu', 'mil', 'int',
  'info', 'biz', 'me', 'tv', 'cc', 'xyz', 'top', 'site', 'online',
  'app', 'dev', 'cloud', 'tech', 'store', 'vip', 'shop', 'live',
  'hk', 'tw', 'mo', 'jp', 'kr', 'sg', 'my', 'th', 'vn', 'id', 'ph',
  'uk', 'de', 'fr', 'nl', 'ru', 'us', 'ca', 'au', 'in', 'br', 'it', 'es',
  // 常见云厂商自有域 (SRC 常把这些列进授权范围)
  'aliyuncs', 'myqcloud', 'qcloud', 'huaweicloud', 'wicare', 'tencent-cloud',
]);

/** 一级域名必须是纯字母数字（挡 xn--、挡纯中文） */
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * 从任意文本片段里提取**可信域名**。
 * @returns 域名数组 (已小写, 已校验 TLD)
 */
export function extractTrustedHosts(text: string): string[] {
  const out = new Set<string>();
  // 匹配候选。
  // ⚠️ 2026-10-16 修正: 原式 `\*?\.[a-zA-Z0-9]...` 里 `\.` 是**必需**的,
  // 于是无通配符域名 `example.com` 匹配不到(返回 null), `admin.bestpay.cn` 只匹配到
  // 后半段 `.bestpay.cn` —— 标签被吃掉, 结果整页解析出 0 个域名。
  // 正确写法: 标签之间用点分隔, 至少两级; 通配前缀 `*.` 单独可选。
  const candidates = String(text || '').match(
    /(?:[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,24}|\*\.(?:[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,24}/g,
  ) || [];

  for (const raw of candidates) {
    // 结尾是字母(2~24)才算 TLD —— 同时挡掉 `1.2.3.4` 之类被当域名
    const bare = raw.toLowerCase().replace(/^\*\./, '');
    if (bare.includes('*')) continue;
    const labels = bare.split('.').filter(Boolean);
    if (labels.length < 2) continue;
    const tld = labels[labels.length - 1];
    if (!KNOWN_TLDS.has(tld)) continue;          // 挡 punycode / dos / 中文
    if (!labels.every(l => LABEL_RE.test(l))) continue;
    out.add(bare);
  }
  return [...out];
}

/**
 * 取出行里的通配形态 (`*.example.com`)。
 * extractTrustedHosts 会把 `*.` 归一掉（校验时更方便），这里按原文还原回去 ——
 * 通配授权的语义与具体子域不同，丢掉 `*.` 会让 `*.bestpay.com.cn` 退化成 `bestpay.com.cn`，
 * 授权范围被悄悄放大/缩小都可能。
 */
function restoreWildcards(raw: string): string | null {
  const m = String(raw).match(/(\*\.[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z])/);
  if (!m) return null;
  const w = m[1].toLowerCase().replace(/\.+$/, '');
  const bare = w.slice(2);
  return extractTrustedHosts(bare).length ? w : null;
}

// ═══════════════════════════════════════════════════════════
// 分段：把整页文本切成授权区 / 禁止区 / 奖励区
// ═══════════════════════════════════════════════════════════

/**
 * 授权区关键词 —— 出现这些词之后的域名，倾向于是"可以打"的
 * 注意: 英文站多是 "In Scope" / "Scope"，中文站是 "授权范围"/"测试范围"/"接收范围"
 */
const ALLOW_HINTS = [
  '授权范围', '授权测试', '测试范围', '接收范围', '漏洞接收', '可测试', '可以测试',
  '允许测试', '授权资产', '资产范围', '测试目标', '赏金范围', '收录范围',
  'in scope', 'in-scope', 'in_scope', 'scope of testing', 'eligible', 'allowed',
  'targets', 'assets', 'reward scope',
];

/**
 * 弱授权词 —— 单独出现时**不足以**把状态切到 allow。
 *
 * ⚠️ 2026-10-16 实测事故: `assets` / `targets` / `allowed` 这类词会出现在
 * 各种普通描述行里。英文站典型序列:
 *     Out of scope:
 *     Third-party assets          ← 含 'assets' → 状态被翻成 allow
 *     Social engineering          ← 继承 allow → 行为禁令漏抓
 *     github.com                  ← 继承 allow → 禁止域名进了授权列表 ❌
 * 结果是"整页禁止项全部失效", 而禁止项漏识别 = 越权打标 = 封号/法律风险。
 * 规则: 弱词只在 neutral 态生效; 一旦进了 deny 区, 只能由**强**授权标题或
 * 分区结束线索(ZONE_END_HINTS)才能切走。
 */
const ALLOW_HINTS_WEAK = new Set(['eligible', 'allowed', 'targets', 'assets', 'reward scope', '可测试', '可以测试']);

/**
 * 禁止区关键词 —— 出现这些词之后的内容，倾向于是"不许打"的
 * **这是安全性的关键**: 禁止项漏识别 = AI 越权打标 = 赏金封号甚至法律风险
 */
const DENY_HINTS = [
  '禁止', '不得', '不允许', '严禁', '除外', '不在范围', '不接收', '不纳入', '拒绝',
  '排除', '规避', '请勿', '不予', '无授权',
  'out of scope', 'out-of-scope', 'out_scope', 'not eligible', 'disallowed',
  'prohibited', 'excluded', 'do not test', "don't test", 'forbidden',
  'never test', 'avoid', 'restricted',
];

/** 行为禁令（非域名，是"不许做什么"）—— 这些不需要授权，直接就是禁止 */
const ACTION_FORBIDDEN = [
  '社会工程', '钓鱼', '钓鱼邮件', '社工',
  'ddos', 'dos', '拒绝服务', '压力测试', '流量攻击', 'cc 攻击', '资源耗尽',
  '物理攻击', '上门', '暴力破解（针对真实账户）',
  '破坏', '删除数据', '篡改数据', '植入后门', '留后门',
  '影响正常业务', '中断服务', '不可恢复',
  // 英文站表述（2026-10-16 补: 英文 SRC 页面只识别中文别名会整段漏抓）
  'social[- ]engineering', 'phishing', 'pretexting',
  'denial[- ]of[- ]service', 'resource exhaustion', 'load (test|testing)',
  'physical attack', 'on[- ]site',
  'brute[- ]?force', 'password spraying', 'credential stuffing',
  'data (deletion|destruction|removal)', 'delete .*data', 'modify .*data',
  'backdoor', 'malware', 'trojan', 'ransomware', 'rootkit',
  'spam', 'mass mail', 'email bombing',
  'third[- ]party', 'third party',
  'disrupt(ion|ing)? (of )?(service|business)', 'degrad(e|ing) service',
  'scan(ning)? (the )?entire (internet|network)', 'port scan(ning)? (the )?entire',
  '未授权访问', '越权', '越权访问', '提权',
];

const REWARD_HINTS = [
  '高危', '严重', 'critical', 'high', '中危', 'medium', '低危', 'low',
  '奖励', '赏金', '奖金', ' bounty', '奖金池', '评级', 'cvss',
];

/** 奖励线索里的短词必须"独立成词"才算命中（见 looksRewardish 注释） */
const REWARD_WEAK = new Set(['high', 'low', 'medium', 'critical', '奖励', '评级', '奖金池']);

/**
 * 否定前缀 —— 出现时把整行定性为 deny, 优先级**高于**任何授权词。
 *
 * ⚠️ 2026-10-16 实测事故: 真实页面写的是「以下域名**不在授权范围**：」,
 * 而 DENY_HINTS 里只有 '不在范围' —— 中间插了「授权」两字就匹配不上;
 * 结果该行只命中强授权词 '授权范围', 把状态从 deny 反转成 allow,
 * 后面的 `oms.bestpay.cn` / `www.tycredit.com` 两个明确禁止项
 * **被当成授权目标收进inScope**。这是最危险的一类误判(越权打标)。
 *
 * 不能靠继续枚举否定词解决 —— 中文里否定词可以插在授权词任意位置
 * ("不在授权范围" / "不属于授权测试范围" / "不纳入授权资产")。
 * 改为: 授权词**前面 6 字内**出现否定前缀 → 直接判 deny。
 */
const NEGATION_PREFIX = /不|未|勿|禁|无|非|除外|除外|not |non-|never |out of|outside/;

/** 距离授权词最近的前置切片长度（中文否定一般紧贴，6 字足够覆盖 "不纳入"/"不属于"） */
const NEGATION_WINDOW = 6;

/**
 * 判断一行里是否存在 "否定前缀 + 授权词" 的否定授权表达。
 * @returns命中的否定授权短语（如 "不在授权范围"），无则null
 */
function detectNegatedAllow(line: string): string | null {
  const low = line.toLowerCase();
  for (const h of ALLOW_HINTS) {
    const idx = low.indexOf(h);
    if (idx < 0) continue;
    const before = low.slice(Math.max(0, idx - NEGATION_WINDOW), idx);
    // 前缀里有否定词 → 整条是"否定授权"表述
    if (NEGATION_PREFIX.test(before)) {
      return line.slice(Math.max(0, idx - NEGATION_WINDOW), idx + h.length).trim();
    }
  }
  return null;
}

/**
 * 奖励线索判定: 短词走独立词边界, 长词/中文走 includes。
 * ⚠️ 反例: `low` 是 `allow` / `below` 的子串, 若用 `includes` 判定,
 * 任何含 "allowed" 的授权标题行都会被误判成奖励区并把状态从 deny 抢走。
 */
function looksRewardish(line: string): boolean {
  const low = line.toLowerCase();
  for (const h of REWARD_HINTS) {
    if (!REWARD_WEAK.has(h)) { if (low.includes(h)) return true; continue; }
    if (new RegExp(`(^|[^a-z])${h}([^a-z]|$)`, 'i').test(line)) return true;
  }
  return false;
}

/**
 * 逐行判定该行属于哪个语义区。
 * 用「最近一次出现的标题词」做状态机 —— 授权/禁止/奖励 通常都以小标题出现。
 */
type Zone = 'allow' | 'deny' | 'reward' | 'neutral';

function segmentLines(text: string): Array<{ line: string; zone: Zone }> {
  const lines = String(text || '').split(/\r?\n/);
  // ⚠️ 显式类型注解: 循环体内反复赋值 zone, TS 会把它窄化成初始值 'neutral'
  let zone: Zone = 'neutral';
  const out: Array<{ line: string; zone: Zone }> = [];

  // 分区**结束**线索: 出现这些词说明离开当前区, 回到中性态
  // ⚠️ 2026-10-16 修正: 原实现 zone 一旦被 DENY 命中就永久停在那里,
  // 于是"授权范围 → 禁止测试 → (后续又一段授权说明)"的页面, 后面的授权域名
  // 全被误判成禁止项 —— 实测导致整页解析出 0 个授权目标。
  // 靠"结束线索"把状态机复位, 并允许 deny/allow 区之间正常来回切换。
  const ZONE_END_HINTS = [
    '以下域名', '以下内容', '包括', '如下', '范围如下', '内容如下',
    'targets', 'include', 'includes', 'following', 'as follows', 'below',
  ];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const low = line.toLowerCase();
    const looksLikeHeading =
      /^[\d一二三四五六七八九十]+[.、)]/.test(line) ||      // "1." "一、"
      /^[-*•·]\s/.test(line) ||
      line.length <= 30;
    const hasDeny = DENY_HINTS.some(h => low.includes(h));
    const negatedAllow = detectNegatedAllow(line);
    const allowHits = ALLOW_HINTS.filter(h => low.includes(h));
    // 只由"强"授权词（且不在弱词表里）才允许把状态切回 allow
    const allowStrong = allowHits.filter(h => !ALLOW_HINTS_WEAK.has(h));
    const hasAllow = allowHits.length > 0;

    // 行为禁令词也算强分区线索: "禁止测试: 社会工程学 / DoS / ..."
    // 否则标题行本身不含 DENY_HINTS 时(纯列表), 列表项会落在 neutral 被丢弃。
    const hasActionForbidden = ACTION_FORBIDDEN.some(p =>
      new RegExp(`(^|[^a-z])${p}`, 'i').test(low));

    // ⚠️ isZoneMarker 不能只看"短行" —— `line.length <= 30` 意味着几乎每行都像标题,
    // 于是列表里的普通域名行也会走进判定分支。改为: 短行**且**含分区线索才算标记,
    // 避免无信号的普通行干扰状态机。
    const hasZoneWord = hasDeny || hasAllow || negatedAllow !== null || hasActionForbidden;
    const isZoneMarker = hasZoneWord &&
      (looksLikeHeading || ZONE_END_HINTS.some(h => low.includes(h)) || /[:：]$/.test(line));
    // "以下域名/以下内容/如下"这类**纯结束线索**行: 不带授权或否定语义,
    // 作用是把上一段收敛掉, 让后续内容回到中性等待下一个标题。
    const isZoneEndOnly = !hasZoneWord &&
      (looksLikeHeading || /[:：]$/.test(line)) &&
      ZONE_END_HINTS.some(h => low.includes(h));

    if (negatedAllow !== null) {
      // 否定授权("以下域名不在授权范围") → 直接 deny, 不看其他词
      zone = 'deny';
    } else if (isZoneMarker) {
      // 禁止词优先判定（"不接收的漏洞" 同时含 "不接收" 和 "漏洞接收"，
      // 若先判 allow 会把禁止项误当授权 —— 这是安全相关的判定顺序）
      if (hasDeny) zone = 'deny';
      else if (allowStrong.length) zone = 'allow';
      // ⚠️ 2026-10-16 修正: 弱授权词（assets/targets/allowed）**不得**把 deny 翻回 allow。
      // 英文站 "Out of scope: / Third-party assets / Social engineering / github.com"
      // 里 "Third-party assets" 含 'assets', 曾把 deny 区翻成 allow →
      // 后续所有禁止项(域名+行为)全部漏识别, 等于禁止规则失效。
      else if (hasAllow && zone !== 'deny') zone = 'allow';
      else if (hasActionForbidden && zone === 'neutral') zone = 'deny';
      else if (ZONE_END_HINTS.some(h => low.includes(h))) {
        // 明确的分区结束线索 → 复位到中性, 等下一条标题重新定性
        zone = 'neutral';
      }
    } else if (isZoneEndOnly) {
      // 纯结束线索行: 离开当前分区, 回到中性(否则后续普通行会继承上一个区的语义)
      zone = 'neutral';
    } else if (looksRewardish(line) && /\d/.test(line) && zone !== 'deny') {
      zone = 'reward';
    }

    out.push({ line, zone });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════

/**
 * 解析 SRC 页面文本 → 结构化规则
 *
 * @param text    页面文本 (用户粘贴, 或 browser_extract 抓的整页)
 * @param platform 平台名 (如 "漏洞盒子vala"), 用于 source 标注
 *
 * @example
 *   parseSrcPage(`
 *     授权范围: *.bestpay.com.cn  admin.bestpay.com.cn
 *     禁止测试: 社会工程学  DoS  第三方资产
 *     高危 5000-20000 元
 *   `, 'vala')
 *   // → { inScope: ['*.bestpay.com.cn','admin.bestpay.com.cn'],
 *   //      outOfScope: [], forbiddenActions: ['社会工程学','dos'],
 *   //      rewards: ['高危 5000-20000 元'] }
 */
export function parseSrcPage(text: string, platform?: string): ParsedSrcPage {
  const notes: string[] = [];
  const src = String(text || '');
  if (!src.trim()) {
    return { inScope: [], outOfScope: [], forbiddenActions: [], rewards: [], uncertain: [], confidence: 0, notes: ['输入为空'] };
  }

  const lines = segmentLines(src);

  const inScope = new Set<string>();
  const outOfScope = new Set<string>();
  const forbiddenActions = new Set<string>();
  const rewards: string[] = [];
  const uncertain: string[] = [];

  for (const { line, zone } of lines) {
    const low = line.toLowerCase();

    // ① 行为禁令（任何区都识别: 禁止区最典型，但有的平台写在"注意事项"里）
    for (const pat of ACTION_FORBIDDEN) {
      const re = new RegExp(`(^|[^a-z])${pat}`, 'i');
      if (re.test(line)) {
        // 只在"禁止语义"下才算行为禁令, 避免把 "禁止项: 无" 也当禁令
        if (zone === 'deny' || /禁止|不得|严禁|不允许|请勿|prohibit|forbid|never/i.test(line)) {
          forbiddenActions.add(line.length <= 60 ? line : line.slice(0, 60));
        }
      }
    }

    // ② 奖励线索
    if (zone === 'reward' || (looksRewardish(line) && /\d/.test(line))) {
      if (line.length <= 80) rewards.push(line);
    }

    // ③ 域名提取 —— 只在 allow / deny 区做
    const wild = restoreWildcards(line);
    const hosts = extractTrustedHosts(line);
    // ⚠️ hosts 里已含通配的裸域 (extractTrustedHosts 归一掉了 `*.`),
    // 若该行同时有通配与具体子域, 用通配形态覆盖对应裸项, 其余保留。
    // 早期实现只取 wild 而丢掉同行的其他域名 —— "*.a.com + api.a.com" 会只留通配。
    const hostSet = new Set(hosts);
    if (wild) hostSet.delete(wild.replace(/^\*\./, ''));
    const allForLine = wild ? [wild, ...hostSet] : [...hostSet];

    if (allForLine.length === 0) continue;

    if (zone === 'deny') {
      allForLine.forEach(h => outOfScope.add(h));
    } else if (zone === 'allow') {
      allForLine.forEach(h => inScope.add(h));
    } else {
      // 语义不明: 不敢自作主张授权, 交给人看
      allForLine.forEach(h => uncertain.push(h));
    }
  }

  // ④ 安全后处理: 禁止项从授权项里剔除（deny 优先）
  // 平台常常在授权通配里包含了禁止的子域, 这是最危险的组合
  const deniedBare = [...outOfScope].map(d => d.replace(/^\*\./, ''));
  const before = inScope.size;
  for (const host of [...inScope]) {
    const bare = host.replace(/^\*\./, '');
    if (deniedBare.some(d => bare === d || bare.endsWith('.' + d))) {
      inScope.delete(host);
      notes.push(`已从授权列表剔除 ${host}（命中禁止项）`);
    }
  }
  // 通配授权 vs 禁止具体子域: 保留通配但记录冲突提示（交人判断）
  for (const host of inScope) {
    const bare = host.replace(/^\*\./, '');
    if (host.startsWith('*.') && deniedBare.some(d => bare.endsWith('.' + d))) {
      notes.push(`授权通配 ${host} 与禁止项 ${bare} 有交集，需人工确认范围`);
    }
  }
  if (before !== inScope.size) notes.push('已按 deny 优先规则移除冲突目标');

  // ⑤ 兜底: 若完全没识别出授权区, 退化为"扫描全文但全部标 uncertain"
  if (inScope.size === 0 && uncertain.length === 0) {
    const all = extractTrustedHosts(src);
    if (all.length) {
      uncertain.push(...all);
      notes.push('未识别到明确的授权范围标题，全部域名列入待确认');
    }
  }

  // ⑥ 置信度: 有明确授权区且数量合理 → 高
  let confidence = 0.3;
  if (inScope.size > 0) confidence += 0.35;
  if (outOfScope.size > 0 || forbiddenActions.size > 0) confidence += 0.2;
  if (src.includes('授权范围') || src.toLowerCase().includes('in scope')) confidence += 0.1;
  if (uncertain.length > inScope.size) confidence -= 0.15;
  confidence = Math.max(0.1, Math.min(1, Number(confidence.toFixed(2))));

  if (uncertain.length) {
    notes.push(`${uncertain.length} 处域名语义不明（无授权/禁止标题统领），已列入待确认，未自动授权`);
  }
  if (forbiddenActions.size === 0) {
    notes.push('未识别到禁止项 —— 建议人工确认平台规则后再开扫，避免越权打标');
  }

  return {
    inScope: [...inScope].sort(),
    outOfScope: [...outOfScope].sort(),
    forbiddenActions: [...forbiddenActions].sort(),
    rewards,
    ...(platform ? { platform } : {}),
    uncertain,
    confidence,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════
// 落盘：写入 .agentai/src-rules.json（AI 侧读取用）
// ═══════════════════════════════════════════════════════════

export interface StoredSrcRules extends ParsedSrcPage {
  version: 1;
  ts: string;
  /** 是否已被人类确认（未确认前 AI 不得据此自动开扫） */
  confirmed: boolean;
}

/** 保存解析结果到 workspace/.agentai/src-rules.json */
export function saveSrcRules(ws: string, parsed: ParsedSrcPage, confirmed = false): string {
  const dir = path.join(ws, '.agentai');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'src-rules.json');
  const payload: StoredSrcRules = { ...parsed, version: 1, ts: new Date().toISOString(), confirmed };
  // 先写临时文件再 rename: 防进程被杀留下半截 JSON
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

/** 读回解析结果（AI 侧每轮读一次，用于构造上下文） */
export function readSrcRules(ws: string): StoredSrcRules | null {
  try {
    const file = path.join(ws, '.agentai', 'src-rules.json');
    if (!fs.existsSync(file)) return null;
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!j || j.version !== 1) return null;
    return j as StoredSrcRules;
  } catch { return null; }
}

/** 标记为已人工确认（人类在面板点确认后调） */
export function confirmSrcRules(ws: string): boolean {
  const r = readSrcRules(ws);
  if (!r) return false;
  r.confirmed = true;
  saveSrcRules(ws, r, true);
  return true;
}

/** 生成投喂给 AI 的人类可读摘要（这段文本会进系统提示，让 AI 不再反复问） */
export function renderSrcRulesForAi(r: StoredSrcRules | null): string {
  if (!r) return '';
  const L: string[] = [];
  L.push(`📋 已授权测试目标 (${r.inScope.length} 个, 来源: ${r.platform || 'SRC 平台'}, ${r.confirmed ? '人类已确认' : '⚠️待人类确认'}):`);
  L.push(...r.inScope.map(h => `   · ${h}`));

  if (r.outOfScope.length) {
    L.push(`\n🚫 明确禁止的目标 (${r.outOfScope.length} 个):`);
    L.push(...r.outOfScope.map(h => `   · ${h}`));
  }
  if (r.forbiddenActions.length) {
    L.push(`\n⛔ 禁止的行为:`);
    L.push(...r.forbiddenActions.map(a => `   · ${a}`));
  }
  if (r.rewards.length) {
    L.push(`\n💰 奖励等级参考 (优先投入高价值面):`);
    L.push(...r.rewards.slice(0, 6).map(a => `   · ${a}`));
  }

  L.push('\n⚠️ 执行纪律:');
  L.push('   1. 上面清单里的目标**已授权**，直接开扫，不要再逐个向我确认');
  L.push('   2. 清单外的目标一律先 scope_guard.check_scope 查，不在清单且未提案 → 不要打');
  L.push('   3. 禁止项与禁止行为**永久排除**，即使命中高价值线索也不要碰');
  L.push('   4. 命中即停：一个目标确认可报洞 + 证据落盘后就换下一个，把数量堆上去');
  return L.join('\n');
}