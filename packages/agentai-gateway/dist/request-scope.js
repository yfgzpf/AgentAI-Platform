/**
 * 请求级工作区上下文（Request-Scoped Workspace）
 * ========================================================================
 * 立项原因: 跨请求工作区串扰（审查报告 P0-9）
 *
 * 问题链
 * ──────────────────────────────────────────────────────────────────────
 * routes/chat.ts:252   wm.setProjectDir(req.body.projectDir)
 *                ↓ 改写**进程级单例**
 * tools.ts             38 个 handler 用 wm().projectDir 作路径基准（46 处）
 * git_* 的handler      签名是 (args) —— **根本不收 ctx**
 *
 * 时序:
 *   请求A (projA) → setProjectDir(projA) → A 的工具在 projA 上跑 ✅
 *   请求B (projB) → setProjectDir(projB) → B 的工具在 projB 上跑 ✅
 *   请求A 的下一轮工具调用 → 读到的 projectDir 已是 projB → **A 在 B 的项目上读写并 git commit**
 *
 * 为什么不用「逐个给 handler 加 ctx 参数」
 * ──────────────────────────────────────────────────────────────────────
 * 实测 tools.ts 里38 个 handler 引用 wm().projectDir，其中**20 个签名不含 ctx**
 * （git_* 全家、remember_this、evolve_prompt、create_tool、forget、session_manage、
 *   find_references、run_tests、typecheck、validate_and_fix、remember_project、
 *   recall_project）。逐个改签名会破坏所有外部调用方（工具市场、skill、
 *   子智能体、自动化任务都在调它们），风险远大于收益。
 *
 * 采用方案: AsyncLocalStorage
 * ──────────────────────────────────────────────────────────────────────
 * Node 原生的异步上下文传播机制。在 dispatch 入口开一个作用域，
 * 作用域内所有代码（包括不收 ctx 的 handler、通过 await 链调用的深层函数）
 * 都能读到本次请求的 workspace，且**请求之间天然隔离**。
 *
 * 这是 Node 官方为"请求级上下文不传遍所有函数签名"设计的标准方案
 * （Express/Koa/Prisma 都用它做 requestId 传递）。
 *
 * 用法
 * ──────────────────────────────────────────────────────────────────────
 *   // 入口（tool-registry.dispatch）
 *   return runWithWorkspace(ctx.workspace, () => this.dispatchInternal(calls, ctx));
 *
 *   // 任意深处（tools.ts 的任何 handler，无需改签名）
 *   const ws = requestWorkspace();   // 请求级；不在请求内则回退全局单例
 *
 * 兼容性
 * ──────────────────────────────────────────────────────────────────────
 * · 不在请求上下文中（如后台任务、启动钩子）→ 回退到 WorkspaceManager.projectDir，
 *   行为与今天完全一致，零破坏。
 * · 单测直接调handler 时不在 ALS 内 → 同样回退，现有测试全部不受影响。
 */
import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'node:fs';
const storage = new AsyncLocalStorage();
/**
 * 在指定工作区上下文中执行 fn
 *
 * ★ 注意: 必须把整个异步调用链包在回调里，不能只包同步部分 ——
 *   AsyncLocalStorage 的上下文跟随 Promise 传播。
 */
export function runWithWorkspace(workspace, fn, meta) {
    if (!workspace)
        return fn();
    return storage.run({ workspace, userId: meta?.userId, sessionId: meta?.sessionId }, fn);
}
/**
 * 读取当前请求的工作区
 * @returns 请求级 workspace；不在请求上下文中返回 null
 */
export function currentRequestWorkspace() {
    const scope = storage.getStore();
    return scope?.workspace ?? null;
}
/** 读取当前完整作用域（诊断用） */
export function currentRequestScope() {
    return storage.getStore() ?? null;
}
/** 当前是否在请求上下文中 */
export function inRequestScope() {
    return storage.getStore() !== undefined;
}
/**
 * 从 Express 请求中解析工作区
 * -----------------------------------------------------------------
 * 优先级: x-workspace-path 头 > x-workspace 头 > ?workspace= 查询参数
 *      > body.workspace > body.projectDir
 *
 * body 为什么能读: app.ts 里本中间件挂在 express.json() **之后**
 * （顺序是 auth → json → 本中间件），所以 req.body 已解析。
 * 这点很重要 —— POST /v1/chat 的 workspace 只在 body 里。
 *
 * 安全: 一律要求 fs.existsSync 通过才采用，
 * 否则一个不存在的路径会成为整个请求的作用域基准。
 */
export function workspaceFromRequest(req) {
    const h = req.headers || {};
    const cand = h['x-workspace-path'] ||
        h['x-workspace'] ||
        (typeof req.query?.workspace === 'string' ? req.query.workspace : '') ||
        (typeof req.body?.workspace === 'string' ? req.body.workspace : '') ||
        (typeof req.body?.projectDir === 'string' ? req.body.projectDir : '');
    const trimmed = String(cand || '').trim();
    if (!trimmed)
        return null;
    try {
        // 必须是真实存在的目录 —— 否则不建作用域（回退全局单例）
        return fs.statSync(trimmed).isDirectory() ? trimmed : null;
    }
    catch {
        return null;
    }
}
/**
 * 诊断信息：当前 workspace 与全局单例是否不一致
 *
 * 不一致说明存在串扰风险（某处在请求上下文之外改了全局单例，
 * 或反过来请求上下文没建起来）。测试用它做断言。
 */
export function workspaceDriftWarning(globalDir) {
    const scope = storage.getStore();
    if (!scope)
        return null;
    if (scope.workspace !== globalDir) {
        return (`[workspace-drift] 请求工作区 "${scope.workspace}" 与全局单例 "${globalDir}" 不一致。`
            + '若代码读取了 wm().projectDir 而非 requestWorkspace()，会操作错误的目录。');
    }
    return null;
}
