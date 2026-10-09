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
export {};
