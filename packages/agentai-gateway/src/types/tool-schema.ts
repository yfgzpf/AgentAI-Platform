/**
 * tool-schema.ts — EXTRA_TOOLS 声明区类型 (2026-10-11 新增)
 * ----------------------------------------------------------------
 * 目标: 给 tools.ts 的 EXTRA_TOOLS (201 条工具声明) 提供编译期类型,
 * 消除 index.ts / spawner-cli.ts 里的 `spec.riskLevel as any` / `handler as any`。
 *
 * 设计约束 (verify-tool-consistency.mjs 红线):
 *  - 该脚本用 TS AST 解析 EXTRA_TOOLS, 只读每个条目的 name / riskLevel 字面量。
 *  - 因此类型标注只能"加标注", 不能改动 name/riskLevel 的字面量写法,
 *    也不能把条目改成非对象字面量 — 否则解析器会静默丢条目。
 *  - 本文件只定义类型, 不引入运行时逻辑, 对 AST 解析零影响。
 *
 * riskLevel 复用 tool-registry.ts 的 RiskLevel (单一真源, 避免二处各写一份)。
 */
import type { RiskLevel } from '../tool-registry.js';

/** 递归 JSON-Schema 参数节点 — 覆盖 EXTRA_TOOLS 里全部 type/properties/items/enum 形态 */
export type ToolParamSchema = {
  /** JSON Schema type (string/number/boolean/object/array/…) */
  type?: string;
  /** 参数说明 — 强模型据此决定怎么填参数, 强烈建议每个参数都写 */
  description?: string;
  /** 枚举约束 */
  enum?: string[];
  /** 对象子字段 */
  properties?: Record<string, ToolParamSchema>;
  /** 必填字段 */
  required?: string[];
  /** 数组元素 schema */
  items?: ToolParamSchema;
  /** 自由对象 (无固定子字段) 标记 */
  additionalProperties?: boolean;
  /** 默认值 */
  default?: unknown;
};

/**
 * 单个工具声明 — 与 llm-router.ts ToolSpec 字段对齐,
 * 但 riskLevel 收窄为 RiskLevel 联合 (而非 string), 供注册中心强类型消费。
 */
export interface ToolDecl {
  name: string;
  description: string;
  parameters: ToolParamSchema;
  parallelSafe?: boolean;
  riskLevel: RiskLevel;
}
