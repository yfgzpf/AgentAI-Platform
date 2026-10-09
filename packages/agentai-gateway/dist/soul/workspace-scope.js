/**
 * Soul 模块的 workspace 作用域注册表
 * ============================================================
 * 背景（串味根因）:
 *   soul/ 下 7 个模块（Dream / InnerVoice / PainSense / Curiosity /
 *   InternalDebate / PrivateMemory / ValueSystem）全部是模块级单例:
 *
 *     let _instance: X | null = null;
 *     export function getX() { if (!_instance) _instance = new X(); return _instance; }
 *
 *   而它们的构造函数在初始化时固化读取:
 *     const ws = WorkspaceManager.getInstance().projectDir;   // ← 全局单例
 *
 *   两个后果:
 *   1. 单例一旦创建就永久复用，即使 projectDir 后来变了也不重建
 *   2. 构造时固化=dataPath，之后 workspace 切换了它仍指向旧工作区
 *
 *   → projA 产生的梦境 / 私密记忆 / 痛感会被注入 projB 的任务上下文，
 *     模型表现为"我记得你上次在另一个任务里说过…" —— 这就是串味。
 *
 * 方案:
 *   把单例从「进程级 1 个」改成「每 workspace 1 个」，
 *   调用方显式传 workspace（取自请求级 opts.workspace，而非全局单例）。
 *
 * 为什么不直接改成"每次 new":
 *   DreamEngine 构造里会 loadJournal() 读磁盘、start() 起interval，
 *   每请求 new 会造成反复 IO + 定时器泄漏。
 *
 * 内存上限:
 *   MAX_SCOPED_INSTANCES 防止 workspace 无限增长导致内存泄漏
 *   （HTTP 场景下 workspace 来自用户输入，不可信）
 */
/** 超过此数量时销毁最早创建的实例（LRU 近似） */
const MAX_SCOPED_INSTANCES = 16;
let seqCounter = 0;
/** 各模块的注册表: moduleName -> (workspaceKey -> entry) */
const registries = new Map();
/**
 * 规范化 workspace key
 * 空/未定义一律归到 '__default__'，保证同 key 复用同一实例
 */
export function normalizeWs(workspace) {
    const w = (workspace ?? '').trim();
    return w || '__default__';
}
/**
 * 取（或懒创建）某模块在指定 workspace 下的实例
 *
 * @param moduleName 模块名（如 'dream'），用于隔离注册表命名空间
 * @param workspace  请求级 workspace（**不要传全局单例的 projectDir**）
 * @param factory    实例工厂；仅在该 workspace 首次访问时调用
 */
export function getScoped(moduleName, workspace, factory) {
    let reg = registries.get(moduleName);
    if (!reg) {
        reg = new Map();
        registries.set(moduleName, reg);
    }
    const key = normalizeWs(workspace);
    const hit = reg.get(key);
    if (hit) {
        // 刷新 LRU 顺序
        hit.seq = ++seqCounter;
        return hit.instance;
    }
    const instance = factory();
    reg.set(key, { instance, seq: ++seqCounter });
    evictIfNeeded(moduleName, reg);
    return instance;
}
/** 销毁某模块的全部实例（测试隔离 /显式重置用） */
export function resetScoped(moduleName, workspace) {
    const reg = registries.get(moduleName);
    if (!reg)
        return;
    if (workspace === undefined) {
        for (const entry of reg.values())
            disposeIfPossible(entry.instance);
        reg.clear();
        return;
    }
    const key = normalizeWs(workspace);
    const entry = reg.get(key);
    if (entry) {
        disposeIfPossible(entry.instance);
        reg.delete(key);
    }
}
/** 销毁全部模块的全部实例 */
export function resetAllScoped() {
    for (const [, reg] of registries) {
        for (const entry of reg.values())
            disposeIfPossible(entry.instance);
        reg.clear();
    }
    registries.clear();
}
/** 当前已注册的 (module, workspace) 对数量 —— 供诊断与测试断言 */
export function scopedStats() {
    const out = {};
    for (const [name, reg] of registries)
        out[name] = reg.size;
    return out;
}
// ===== 内部 =====
function evictIfNeeded(moduleName, reg) {
    if (reg.size <= MAX_SCOPED_INSTANCES)
        return;
    const entries = [...reg.entries()].sort((a, b) => a[1].seq - b[1].seq);
    const evictCount = reg.size - MAX_SCOPED_INSTANCES;
    for (let i = 0; i < evictCount; i++) {
        const oldest = entries[i];
        if (!oldest)
            break;
        disposeIfPossible(oldest[1].instance);
        reg.delete(oldest[0]);
        console.warn(`[soul-scope] ${moduleName} 实例数超上限(${MAX_SCOPED_INSTANCES}), 已淘汰最旧 workspace: ${oldest[0]}`);
    }
}
/** 实例若自带 stop()/dispose() 则调用，避免定时器泄漏 */
function disposeIfPossible(instance) {
    const obj = instance;
    if (!obj)
        return;
    try {
        if (typeof obj.stop === 'function')
            obj.stop();
        else if (typeof obj.dispose === 'function')
            obj.dispose();
        else if (typeof obj.end === 'function')
            obj.end();
    }
    catch (e) {
        console.warn(`[soul-scope] 销毁实例失败: ${e?.message}`);
    }
}
