/**
 * Sandbox 类型定义
 *
 * 三类路径规则:
 *   - allow: 白名单 (在 allow 内的路径可任意操作)
 *   - deny:  黑名单 (直接拒绝,优先级最高)
 *   - prompt: 灰名单 (需用户确认,优先级次于 deny)
 *
 * 操作类型:
 *   - 'read' | 'write' | 'delete'
 *
 * Verdict 优先级 (高到低):
 *   deny > prompt > allow > 默认 deny (白名单模式,谨慎)
 */

export type SandboxVerdict = 'allow' | 'deny' | 'prompt';

export type SandboxOp = 'read' | 'write' | 'delete' | 'execute';

export interface SandboxRules {
    /** 白名单 glob 数组 */
    allow: string[];
    /** 黑名单 glob 数组 (优先级最高) */
    deny: string[];
    /** 灰名单 glob 数组 (需用户确认) */
    prompt: string[];
    /** 单文件最大字节数 (write/delete 时检查, 0 = 不限) */
    maxFileSize?: number;
    /** 单次操作累计最大字节数 (0 = 不限) */
    maxTotalSize?: number;
    /** 排除列表 (永远跳过,deny 仍优先) */
    exclude?: string[];
    /** 规则版本号 (写盘时自动 +1) */
    version?: number;
    /** 最后修改时间 ms */
    updatedAt?: number;
}

export interface SandboxCheckResult {
    verdict: SandboxVerdict;
    reason: string;
    matchedRule?: string;
    source: 'deny' | 'prompt' | 'allow' | 'default' | 'size' | 'error';
}

export interface SandboxCheckRequest {
    path: string;
    op: SandboxOp;
    size?: number;
}

export interface SandboxRulesResponse {
    rules: SandboxRules;
    source: 'file' | 'default' | 'invalid';
    valid: boolean;
    errors?: string[];
}
