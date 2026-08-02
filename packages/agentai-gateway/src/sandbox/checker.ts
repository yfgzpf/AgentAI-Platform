/**
 * Sandbox 检查器 v3.2
 * =====================================================
 * 优先级: deny > size > prompt > default-allow
 *
 * 核心理念 (2026-07-19): "只要不动操作系统权限全放行"
 *   1. deny 规则保护系统路径 (C:/Windows, ~/.ssh 等) — 永不放开
 *   2. 大小检查: maxFileSize / maxTotalSize
 *   3. prompt 规则标记敏感文件 (.env, .pem 等) — 审计但不阻止
 *   4. 其余所有路径默认放行 — 用户不需要手动配置白名单
 *
 * 大小检查:
 *   - write/delete 时检查 maxFileSize (单文件)
 *   - write 时累加 maxTotalSize (调用方负责传 currentTotal)
 */

import { matchAny, normalizePath } from './rules.js';
import type { SandboxCheckResult, SandboxCheckRequest, SandboxOp, SandboxRules } from './types.js';

export interface CheckContext {
    /** 单次操作累计字节数 (write 用) */
    currentTotal?: number;
}

export function check(
    req: SandboxCheckRequest,
    rules: SandboxRules,
    ctx: CheckContext = {},
): SandboxCheckResult {
    try {
        const norm = normalizePath(req.path);
        const op: SandboxOp = req.op;

        // 1. deny 最高优先 — 系统目录/凭证永不放开
        const denyHit = matchAny(norm, rules.deny || []);
        if (denyHit.matched) {
            return {
                verdict: 'deny',
                reason: `Path matches deny rule: ${denyHit.pattern}`,
                matchedRule: denyHit.pattern,
                source: 'deny',
            };
        }

        // 2. 大小检查 (仅 write/delete)
        if ((op === 'write' || op === 'delete') && rules.maxFileSize && rules.maxFileSize > 0) {
            if (req.size !== undefined && req.size > rules.maxFileSize) {
                return {
                    verdict: 'deny',
                    reason: `File size ${req.size} exceeds maxFileSize ${rules.maxFileSize}`,
                    source: 'size',
                };
            }
        }
        if (op === 'write' && rules.maxTotalSize && rules.maxTotalSize > 0) {
            const total = (ctx.currentTotal || 0) + (req.size || 0);
            if (total > rules.maxTotalSize) {
                return {
                    verdict: 'deny',
                    reason: `Total ${total} exceeds maxTotalSize ${rules.maxTotalSize}`,
                    source: 'size',
                };
            }
        }

        // 3. prompt — 敏感文件标记 (审计但放行)
        const promptHit = matchAny(norm, rules.prompt || []);
        if (promptHit.matched) {
            return {
                verdict: 'prompt',
                reason: `Path matches prompt rule: ${promptHit.pattern} (user confirmation required)`,
                matchedRule: promptHit.pattern,
                source: 'prompt',
            };
        }

        // 4. 默认放行 — "只要不动操作系统权限全放行"
        return {
            verdict: 'allow',
            reason: `Default allow (deny & prompt rules not matched)`,
            source: 'default',
        };
    } catch (e: any) {
        // fail-closed: 检查器抛错 → deny
        return {
            verdict: 'deny',
            reason: `Sandbox check error: ${String(e?.message || e)}`,
            source: 'error',
        };
    }
}
