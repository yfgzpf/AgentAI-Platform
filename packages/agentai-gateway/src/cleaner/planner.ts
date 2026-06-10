/**
 * 规划器: 把扫描结果按规则分类为 SAFE / RISKY / ALERT 三桶
 * - safe: 直接执行
 * - risky: 进入 pendingRiskyPlans,等待用户确认
 * - alerts: 触发告警
 * - planId = p_<12位sha1(ruleId|filePath)>
 */

import { createHash } from 'crypto';
import { matchRule, MatchContext } from './rule-engine.js';
import type { Rule, FileMeta, FileAction } from './types.js';

export interface PlanResult {
    safe: FileAction[];
    risky: FileAction[];
    alerts: FileAction[];
}

function planId(ruleId: string, p: string): string {
    return 'p_' + createHash('sha1').update(ruleId + '|' + p).digest('hex').slice(0, 12);
}

/**
 * 分类: 对每个文件尝试匹配规则,匹配到则按 risk 分桶
 */
export function plan(
    rules: Rule[],
    files: FileMeta[],
    ctx: Partial<MatchContext> = {},
): PlanResult {
    const safe: FileAction[] = [];
    const risky: FileAction[] = [];
    const alerts: FileAction[] = [];

    for (const f of files) {
        const r = matchRule(rules, f, ctx);
        if (!r) continue;
        const a: FileAction = {
            planId: planId(r.id, f.path),
            ruleId: r.id,
            risk: r.risk,
            action: r.action,
            file: f,
            archiveDir: r.archiveDir,
        };
        if (r.risk === 'safe') safe.push(a);
        else if (r.risk === 'risky') risky.push(a);
        else if (r.risk === 'alert') alerts.push(a);
        // 'keep' 不处理
    }
    return { safe, risky, alerts };
}
