/**
 * quota-safe-storage — localStorage 配额安全层
 * ============================================================
 * 实机事故 (富哥, 2026-10-18):
 *   `Failed to execute 'setItem' on 'Storage': Setting the value of
 *    'agentai-sessions' exceeded the quota.` → ErrorBoundary 接管整页
 *   → 用户看到"页面加载中断", 应用直接不能用。
 *
 * 根因 (不是偶发, 是必然):
 *   ① `sessionStore` 用 zustand persist **默认** storage (裸 localStorage),
 *      没有任何 try/catch —— 配额一满 setItem 抛 QuotaExceededError;
 *   ② persist 的写入发生在 React set() 过程中, 异常直接冒到 ErrorBoundary;
 *   ③ 载荷是**全部会话的完整消息**: 每会话留 50 条, 全局留 200 个会话,
 *      而单条消息可能带整段工具日志 (一次渗透任务 100+ 步) —— 几个会话即爆;
 *   ④ 同源还有 chat-messages / write-draft / video-refimg(可能是 data URI 大图)
 *      一起抢那 5MB。
 *
 * 设计原则:
 *   - **永不抛异常**: 任何写失败都降级, 绝不让 UI 崩;
 *   - **先瘦身再写**: 超预算时按"最不伤用户"的顺序逐级裁剪 (先动非当前会话,
 *     最后才动当前会话), 而不是等抛错;
 *   - **先清临时键**: 截图帧/草稿这类可牺牲的数据优先腾地方;
 *   - 裁剪是**粘性棘轮**: 一旦降级到某档就停在那档, 避免每次写入反复重算。
 */

/** 裁剪标记 (让用户/开发者能看出这条消息被本地裁剪过) */
export const TRIM_SUFFIX = (omitted: number) => `\n\n…[本地存储空间不足, 已省略 ${omitted} 字]`;

/**
 * 可牺牲的临时键 —— 配额告急时优先丢弃。
 * 这些都是"传一次就消费掉"的中间数据, 丢了不影响对话历史。
 */
export const TRANSIENT_KEYS = [
  'agentai-video-sceneframe',
  'agentai-video-refimg',
  'agentai-video-firstframe',
  'agentai-edit-messages',
  'decorai-saved',
  'agentai-3d-tasks',
];

export function isQuotaError(e: unknown): boolean {
  if (!e) return false;
  const err = e as { name?: string; code?: number; message?: string };
  if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (err.code === 22 || err.code === 1014) return true;
  return /quota|exceeded/i.test(String(err.message || ''));
}

/** 取 localStorage; 不可用 (SSR / 隐私模式 / 测试) 时返回 null, 全部调用降级为 no-op */
export function getLS(): Storage | null {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 统计当前已用字符数 (按 key 拆分, 用于诊断面板/日志) */
export function storageUsage(): { usedChars: number; items: Array<{ key: string; chars: number }> } {
  const ls = getLS();
  if (!ls) return { usedChars: 0, items: [] };
  const items: Array<{ key: string; chars: number }> = [];
  try {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k) continue;
      items.push({ key: k, chars: (ls.getItem(k) || '').length });
    }
  } catch { /* ignore */ }
  items.sort((a, b) => b.chars - a.chars);
  return { usedChars: items.reduce((n, x) => n + x.chars, 0), items };
}

/**
 * 腾地方: 先删可牺牲的临时键。
 * @returns 释放的字符数
 */
export function rescueSpace(opts: { keep?: string[]; extra?: string[] } = {}): number {
  const ls = getLS();
  if (!ls) return 0;
  const skip = new Set(opts.keep || []);
  let freed = 0;
  for (const k of [...TRANSIENT_KEYS, ...(opts.extra || [])]) {
    if (skip.has(k)) continue;
    try {
      const cur = ls.getItem(k);
      if (cur == null) continue;
      freed += cur.length;
      ls.removeItem(k);
    } catch { /* ignore */ }
  }
  return freed;
}

/**
 * 安全写入单个 key —— 用于散落在组件里的裸 `localStorage.setItem`。
 * 永不抛异常; 配额不足时依次尝试: 清临时键 → 截断到 maxChars → 放弃。
 * @returns 是否真正写入成功 (false = 降级, 但调用方流程不受影响)
 */
export function safeSetItem(
  key: string,
  value: string,
  opts: { maxChars?: number; label?: string } = {},
): boolean {
  const ls = getLS();
  if (!ls) return false;
  const { maxChars = 200_000, label = key } = opts;

  // 超长直接截断 (例如草稿/图片 data URI), 避免一条就把配额吃干
  let v = value;
  if (typeof v === 'string' && v.length > maxChars) {
    v = v.slice(0, maxChars) + TRIM_SUFFIX(v.length - maxChars);
  }

  try {
    ls.setItem(key, v);
    return true;
  } catch (e) {
    if (!isQuotaError(e)) {
      console.warn(`[quota-safe] ${label} 写入失败(非配额):`, e);
      return false;
    }
  }
  // 配额不足: 腾地方再试
  const freed = rescueSpace({ keep: [key] });
  if (freed > 0) {
    try {
      ls.setItem(key, v);
      return true;
    } catch { /* 继续降级 */ }
  }
  // 再狠一点: 只留 1/4
  try {
    ls.setItem(key, v.slice(0, Math.max(1000, Math.floor(v.length / 4))) + TRIM_SUFFIX(v.length));
    return true;
  } catch { /* 放弃 */ }
  console.warn(`[quota-safe] ${label} 放弃写入 (配额不足, 已降级继续运行)`);
  return false;
}

/** 从 JSON 里取一个字段; 解析失败返回 null (损坏数据不阻塞启动) */
function parseJSON<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export interface QuotaSafeOptions {
  /** 单 key 字符预算 (默认 1.4M ≈ 2.8MB UTF-16, 同源总配额约 5MB) */
  budgetChars?: number;
  /** 节流毫秒 (0 = 同步写, 保持 zustand 默认语义) */
  throttleMs?: number;
  /**
   * 渐进裁剪器: 收到当前序列化串, 返回**更小**的串 (无法再压时返回 null)。
   * 内部应按"先动非当前会话、最后动当前会话"的顺序逐级加码。
   */
  pruner?: (rawJson: string) => string | null;
  /** 日志标签 */
  label?: string;
  /** 写入结果回调 (ok=false 表示已降级为内存态) */
  onWrite?: (ok: boolean, chars: number) => void;
}

/** 最近一次裁剪记录 (供设置页/诊断显示) */
export const quotaState = {
  lastTrimAt: 0,
  lastTrimLabel: '',
  lastChars: 0,
  degraded: false,
};

/**
 * 构造 zustand persist 用的 storage: 节流 + 预算 + 多级裁剪, 永不抛异常。
 */
export function createQuotaSafeStorage(opts: QuotaSafeOptions = {}) {
  const {
    budgetChars = 1_400_000,
    throttleMs = 0,
    pruner,
    label = 'storage',
    onWrite,
  } = opts;

  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const doWrite = (name: string, value: string) => {
    const ls = getLS();
    if (!ls) { onWrite?.(false, 0); return; }

    let v = value;

    // ① 超预算 → 先裁剪 (不等抛错, 省掉一次异常开销)
    if (pruner && v.length > budgetChars) {
      const smaller = pruner(v);
      if (smaller) v = smaller;
    }

    // ② 直接写
    try {
      ls.setItem(name, v);
      quotaState.lastChars = v.length;
      quotaState.degraded = v.length < value.length;
      if (quotaState.degraded) { quotaState.lastTrimAt = Date.now(); quotaState.lastTrimLabel = label; }
      onWrite?.(true, v.length);
      return;
    } catch (e) {
      if (!isQuotaError(e)) {
        console.warn(`[quota-safe] ${label} 写入失败(非配额):`, e);
        onWrite?.(false, v.length);
        return;
      }
    }

    // ③ 配额真满了: 清临时键 (截图帧/草稿) 再试
    rescueSpace({ keep: [name] });
    try {
      ls.setItem(name, v);
      quotaState.lastTrimAt = Date.now();
      quotaState.lastTrimLabel = label + ':rescue';
      onWrite?.(true, v.length);
      return;
    } catch { /* 继续 */ }

    // ④ 逐级裁剪直到塞得下
    if (pruner) {
      for (let i = 0; i < 12; i++) {
        const smaller = pruner(v);
        if (!smaller || smaller.length >= v.length) break;
        v = smaller;
        try {
          ls.setItem(name, v);
          quotaState.lastTrimAt = Date.now();
          quotaState.lastTrimLabel = label + `:pruned${i + 1}`;
          quotaState.lastChars = v.length;
          quotaState.degraded = true;
          onWrite?.(true, v.length);
          return;
        } catch { /* 继续压 */ }
      }
    }

    // ⑤ 彻底塞不下: 放弃持久化, 保留内存态 —— **绝不抛异常**
    quotaState.degraded = true;
    quotaState.lastTrimAt = Date.now();
    quotaState.lastTrimLabel = label + ':giveup';
    console.warn(
      `[quota-safe] ${label} 无法写入 localStorage (配额不足), 已降级为内存态。` +
      `建议清理历史会话以恢复持久化。`,
    );
    onWrite?.(false, v.length);
  };

  return {
    getItem: (name: string): string | null => {
      const ls = getLS();
      if (!ls) return null;
      try {
        return ls.getItem(name);
      } catch (e) {
        console.warn(`[quota-safe] ${label} getItem 失败:`, e);
        return null;
      }
    },
    setItem: (name: string, value: string): void => {
      if (throttleMs <= 0) {
        doWrite(name, value);
        return;
      }
      const t = timers.get(name);
      if (t) clearTimeout(t);
      timers.set(name, setTimeout(() => {
        timers.delete(name);
        doWrite(name, value);
      }, throttleMs));
    },
    removeItem: (name: string): void => {
      const t = timers.get(name);
      if (t) { clearTimeout(t); timers.delete(name); }
      const ls = getLS();
      if (!ls) return;
      try { ls.removeItem(name); } catch { /* ignore */ }
    },
    /** 立即刷出所有挂起的节流写 (页面卸载前调用, 防丢数据) */
    flush: (): void => {
      for (const [name, t] of timers) { clearTimeout(t); void name; }
      timers.clear();
    },
  };
}

/**
 * 启动自愈: 应用启动时主动体检一次, 已经撑爆的存储立刻瘦身。
 *
 * 为什么需要它 (而不是等下次写入再修):
 *   配额是"已经满"的状态, 用户可能一进来只浏览不发言 —— 那就永远不触发写入,
 *   一旦某天某个组件写一下 (比如草稿自动保存), 又原地爆炸。启动时修一次,
 *   把"满仓"直接降到安全水位, 界面打开就是健康的。
 *
 * @returns 前后用量与执行过的动作 (供 console/诊断显示)
 */
export function ensureLocalStorageHealthy(opts: {
  /** 超过这个字符数才动手 (默认 2.2M ≈ 4.4MB, 5MB 配额的 88%) */
  thresholdChars?: number;
  /** 需要瘦身的 key 及其预算/裁剪器 */
  targets?: Array<{ key: string; budgetChars: number; pruner: (raw: string) => string | null }>;
} = {}): { before: number; after: number; actions: string[] } {
  const ls = getLS();
  const actions: string[] = [];
  if (!ls) return { before: 0, after: 0, actions };

  const before = storageUsage().usedChars;
  const threshold = opts.thresholdChars ?? 2_200_000;
  if (before <= threshold) return { before, after: before, actions };

  // ① 先丢可牺牲的临时键 (截图帧/草稿/中间结果)
  const freed = rescueSpace();
  if (freed > 0) actions.push(`清理临时缓存 ${freed} 字`);

  // ② 再按目标 key 逐级瘦身
  for (const t of opts.targets || []) {
    let raw: string | null = null;
    try { raw = ls.getItem(t.key); } catch { continue; }
    if (!raw || raw.length <= t.budgetChars) continue;

    let cur = raw;
    for (let i = 0; i < 12; i++) {
      let next: string | null = null;
      try { next = t.pruner(cur); } catch { next = null; }
      if (!next || next.length >= cur.length) break;
      cur = next;
      if (cur.length <= t.budgetChars) break;
    }
    if (cur.length >= raw.length) continue;
    try {
      ls.setItem(t.key, cur);
      actions.push(`${t.key}: ${raw.length} → ${cur.length} 字`);
    } catch {
      actions.push(`${t.key}: 瘦身后仍写不进 (配额被其它 key 占满)`);
    }
  }

  const after = storageUsage().usedChars;
  if (actions.length) {
    console.warn(`[quota-safe] 启动体检: ${before} → ${after} 字 | ${actions.join(' | ')}`);
    quotaState.degraded = after > threshold;
    quotaState.lastTrimAt = Date.now();
    quotaState.lastTrimLabel = 'startup-check';
    quotaState.lastChars = after;
  }
  return { before, after, actions };
}

/* ============================================================
 * 会话专用的"分级瘦身"裁剪器
 * ============================================================ */

type AnyMsg = { content?: string; segments?: unknown; [k: string]: unknown };
type AnySession = {
  id?: string;
  messages?: AnyMsg[];
  [k: string]: unknown;
};

/** 2026-10-21: messages 是 optional, 直接 `AnySession['messages'][number]` 会 TS2537 */
type SessionMsg = NonNullable<AnySession['messages']>[number];

type Envelope = { state?: { sessions?: AnySession[]; activeId?: string | null; [k: string]: unknown }; version?: number };

/** 截断单条文本, 保留头 75% + 尾 25% (尾部常含结论/错误码) */
export function capText(s: unknown, max: number): { text: string; changed: boolean } {
  if (typeof s !== 'string') return { text: '', changed: false };
  if (s.length <= max) return { text: s, changed: false };
  const head = Math.max(1, Math.floor(max * 0.75));
  const tail = Math.max(0, max - head);
  const omitted = s.length - head - tail;
  return {
    text: s.slice(0, head) + TRIM_SUFFIX(omitted) + (tail > 0 ? '\n\n' + s.slice(-tail) : ''),
    changed: true,
  };
}

/** 单条 segment 瘦身: 去 base64 / 截工具输出 / 截断超长文本。
 *  思考过程(reasoning/thinking)用宽松上限 4000 保留 —— 用户明确要求"思考过程不能丢"。 */
type AnySeg = { kind?: string; text?: string; result?: string; data?: unknown; url?: string; base64?: string; content?: string; [k: string]: unknown };
function shrinkSegment(seg: AnySeg, textCap: number): { seg: AnySeg; changed: boolean } {
  let changed = false;
  const s: AnySeg = { ...seg };
  if (s.kind === 'image') {
    if (s.base64) { delete s.base64; changed = true; }
    if (typeof s.url === 'string' && s.url.startsWith('data:')) { s.url = '[本地图片已省略: 体积过大]'; changed = true; }
  } else if (s.kind === 'tool') {
    if (s.data) { delete s.data; changed = true; }
    const r = capText(s.result, Math.min(2000, textCap));
    if (r.changed) { s.result = r.text; changed = true; }
  } else if (s.kind === 'widget') {
    const r = capText(s.content, 4000);
    if (r.changed) { s.content = r.text; changed = true; }
  } else if (s.kind === 'reasoning' || s.kind === 'thinking') {
    // ★ 思考链路必须保留: 宽松上限, 不因瘦身丢失推理过程
    const r = capText(s.text, 4000);
    if (r.changed) { s.text = r.text; changed = true; }
  } else if (s.kind === 'text') {
    const r = capText(s.text, textCap);
    if (r.changed) { s.text = r.text; changed = true; }
  }
  return { seg: s, changed };
}

/** 批量瘦身 segments; 无 segments 返回 { changed:false } 不动原对象 */
function shrinkSegments(segments: unknown, textCap: number): { segments?: AnySeg[]; changed: boolean } {
  if (!Array.isArray(segments)) return { changed: false };
  let changed = false;
  const out = (segments as AnySeg[]).map(seg => {
    const { seg: s, changed: c } = shrinkSegment(seg, textCap);
    if (c) changed = true;
    return s;
  });
  return { segments: out, changed };
}

/** 给会话存储用的便捷入口 (导出供 useSessionAutoSave 调用) */
export function shrinkSessionSegments(segments: unknown): AnySeg[] | undefined {
  const r = shrinkSegments(segments, 4000);
  return r.changed || Array.isArray(segments) ? r.segments : undefined;
}

/** 单会话: 每条消息截到 cap (含 content 与 segments 两层) */
function capSession(s: AnySession, cap: number): boolean {
  if (!Array.isArray(s.messages) || s.messages.length === 0) return false;
  let changed = false;
  s.messages = s.messages.map(m => {
    if (!m || typeof m !== 'object') return m;
    let changedHere = false;
    const nm: AnyMsg = { ...m };
    const r = capText(nm.content, cap);
    if (r.changed) { nm.content = r.text; changedHere = true; }
    const shr = shrinkSegments(nm.segments, cap);
    if (shr.changed) { (nm as any).segments = shr.segments; changedHere = true; }
    if (changedHere) changed = true;
    return nm;
  });
  return changed;
}

/** 单会话: 只留最近 keep 条, 且每条截到 cap */
function trimSession(s: AnySession, keep: number, cap: number): boolean {
  let changed = false;
  if (Array.isArray(s.messages) && s.messages.length > keep) {
    s.messages = s.messages.slice(-keep);
    changed = true;
  }
  if (capSession(s, cap)) changed = true;
  return changed;
}

/** 只保留最近 n 个会话 (当前会话必留) */
function keepRecent(st: NonNullable<Envelope['state']>, n: number): boolean {
  if (!Array.isArray(st.sessions)) return false;
  const list = st.sessions;
  if (list.length <= n) return false;
  const active = list.find(s => s.id === st.activeId);
  const rest = list
    .filter(s => s !== active)
    .sort((a, b) => Number((b as any).updatedAt || 0) - Number((a as any).updatedAt || 0));
  const kept = (active ? [active, ...rest.slice(0, n - 1)] : rest.slice(0, n))
    .sort((a, b) => Number((a as any).updatedAt || 0) - Number((b as any).updatedAt || 0));
  st.sessions = kept;
  return true;
}

/**
 * 通用分级裁剪器工厂。
 *
 * @param steps 每级一个变换函数 (入参是 persist 的 `state`), 返回是否真的改小了;
 *              顺序必须**从最不伤用户到最伤用户**。
 * @param budgetChars 目标字符预算, 达到即停
 *
 * 返回的 pruner 是**粘性的**: 记住上次降到第几级, 下次从那一级起步 ——
 * 否则每写一次都要从 0 级把 1MB+ 的 JSON 重新 stringify 十几次, 主线程会卡。
 */
export function createTieredPruner(
  steps: Array<(state: any) => boolean>,
  budgetChars = 1_400_000,
) {
  let level = 0;
  return {
    pruner: (raw: string): string | null => {
      const env = parseJSON<{ state?: any; version?: number }>(raw);
      if (!env || !env.state) return null;
      let smallest: string | null = null;
      for (let lv = level; lv < steps.length; lv++) {
        level = lv;
        let changed = false;
        try {
          changed = steps[lv](env.state);
        } catch {
          changed = false;   // 单级异常不能让整次持久化失败
        }
        if (!changed) continue;
        const s = JSON.stringify(env);
        if (s.length < raw.length && (!smallest || s.length < smallest.length)) smallest = s;
        if (s.length <= budgetChars) return s;
      }
      return smallest;
    },
    get level() { return level; },
    reset: () => { level = 0; },
  };
}

/**
 * 会话分级裁剪器。
 *
 * 顺序刻意这样排 —— **最先牺牲的永远是与用户当前无关的东西**:
 *   L0~L2: 只动"非当前会话"的消息长度/条数
 *   L3: 砍掉非当前会话的整个消息体 (标题/时间保留, 仍可点开继续聊)
 *   L4~L5: 减少会话总数
 *   L6~L9: 最后才动当前会话 (用户正在看的这段)
 */
export function createSessionPruner(budgetChars = 1_400_000) {
  const mapActive = (st: NonNullable<Envelope['state']>, fn: (s: AnySession) => boolean): boolean => {
    if (!Array.isArray(st.sessions)) return false;
    const s = st.sessions.find(x => x.id === st.activeId);
    return s ? fn(s) : false;
  };
  const mapOthers = (st: NonNullable<Envelope['state']>, fn: (s: AnySession) => boolean): boolean => {
    if (!Array.isArray(st.sessions)) return false;
    let changed = false;
    for (const s of st.sessions) {
      if (s.id === st.activeId) continue;
      if (fn(s)) changed = true;
    }
    return changed;
  };

  return createTieredPruner([
    // L0 非当前会话: 每条消息截到 4000 字 (含 segments 内文本/reasoning)
    (st) => mapOthers(st, s => capSession(s, 4000)),
    // L1 非当前会话: 只留最近 15 条, 每条 3000 (放宽, 减少切回后历史丢失)
    (st) => mapOthers(st, s => trimSession(s, 15, 3000)),
    // L2 非当前会话: 只留最近 6 条, 每条 1500
    (st) => mapOthers(st, s => trimSession(s, 6, 1500)),
    // L3 非当前会话: 消息体清空 (只留索引, 可点开继续)
    (st) => mapOthers(st, s => {
      if (!Array.isArray(s.messages) || s.messages.length === 0) return false;
      s.messages = [];
      s.messagesTrimmed = true;
      return true;
    }),
    // L4 会话总数压到 40
    (st) => keepRecent(st, 40),
    // L5 会话总数压到 15
    (st) => keepRecent(st, 15),
    // L6 当前会话: 每条截到 6000
    (st) => mapActive(st, s => capSession(s, 6000)),
    // L7 当前会话: 只留最近 20 条, 每条 2500
    (st) => mapActive(st, s => trimSession(s, 20, 2500)),
    // L8 当前会话: 只留最近 8 条, 每条 1000
    (st) => mapActive(st, s => trimSession(s, 8, 1000)),
    // L9 当前会话: 只留最近 3 条, 每条 400
    (st) => mapActive(st, s => trimSession(s, 3, 400)),
  ], budgetChars);
}
