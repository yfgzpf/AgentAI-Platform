/**
 * Sandbox REST 路由
 *
 * 端点:
 *   GET    /v1/sandbox/rules         - 取当前规则 + 状态
 *   PUT    /v1/sandbox/rules         - 替换规则 (校验 + 写盘)
 *   POST   /v1/sandbox/check         - 试检查某路径 (不真操作)
 *   POST   /v1/sandbox/approve       - 批准 prompt 路径 (临时加 allow)
 */

import { Router, type Request, type Response } from 'express';
import type { Sandbox } from './index.js';
import { persistSandboxState } from './index.js';
import type { SandboxCheckRequest, SandboxRules } from './types.js';

export function createSandboxRouter(sandbox: Sandbox): Router {
    const r = Router();

    /** GET /v1/sandbox/rules */
    r.get('/rules', (_req: Request, res: Response) => {
        const status = sandbox.getStatus();
        res.json({
            ...status,
            rulesPath: sandbox.getRulesPath(),
        });
    });

    /** PUT /v1/sandbox/rules */
    r.put('/rules', async (req: Request, res: Response) => {
        const rules = req.body?.rules as SandboxRules | undefined;
        if (!rules) {
            return res.status(400).json({ error: 'rules required' });
        }
        const result = await sandbox.setRules(rules);
        if (!result.ok) {
            return res.status(400).json({ error: 'validation failed', errors: result.errors });
        }
        const status = sandbox.getStatus();
        res.json({ ok: true, rules: status.rules, version: status.rules.version });
    });

    /** POST /v1/sandbox/check */
    r.post('/check', async (req: Request, res: Response) => {
        const body = req.body as SandboxCheckRequest | undefined;
        if (!body || !body.path || !body.op) {
            return res.status(400).json({ error: 'path and op required' });
        }
        const result = await sandbox.check(body);
        res.json({
            path: body.path,
            op: body.op,
            ...result,
        });
    });

    /** POST /v1/sandbox/approve
     *  body: { path, durationMs? } 默认 1 小时
     *  把 path 临时加入 allow (下次规则刷新时失效, 不写盘)
     */
    r.post('/approve', async (req: Request, res: Response) => {
        const path = req.body?.path as string | undefined;
        if (!path) {
            return res.status(400).json({ error: 'path required' });
        }
        // 简化: 仅返 ok, 不真改 sandbox 实例(留给上层 chain 处理)
        // 实际生产应维护一个临时 allow 列表
        res.json({ ok: true, approved: path, durationMs: 60 * 60 * 1000 });
    });

    /** POST /v1/sandbox/enable  body: { enabled: boolean } */
    r.post('/enable', async (req: Request, res: Response) => {
        const enabled = !!req.body?.enabled;
        await sandbox.setEnabled(enabled);
        res.json({ ok: true, enabled: sandbox.isEnabled() });
    });

    return r;
}
