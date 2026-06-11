/**
 * Sandbox 检查器
 *
 * 优先级:
 *   deny > prompt > allow > 默认 deny (白名单模式)
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

        // 1. deny 最高优先
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

        // 3. prompt 次优先
        const promptHit = matchAny(norm, rules.prompt || []);
        if (promptHit.matched) {
            return {
                verdict: 'prompt',
                reason: `Path matches prompt rule: ${promptHit.pattern} (user confirmation required)`,
                matchedRule: promptHit.pattern,
                source: 'prompt',
            };
        }

        // 4. allow 通过
        const allowHit = matchAny(norm, rules.allow || []);
        if (allowHit.matched) {
            return {
                verdict: 'allow',
                reason: `Path matches allow rule: ${allowHit.pattern}`,
                matchedRule: allowHit.pattern,
                source: 'allow',
            };
        }

        // 5. 默认 deny (白名单模式, 谨慎)
        return {
            verdict: 'deny',
            reason: `Path not in any allow rule (default-deny mode)`,
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
