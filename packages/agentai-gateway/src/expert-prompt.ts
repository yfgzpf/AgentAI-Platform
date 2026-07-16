/**
 * 专家提示词模板引擎
 * =====================
 * 对标 WorkBuddy: 把 Agent 包装成"专家"——身份锚定 + 工作方法 + 交付标准 + 资源模版
 *
 * 通用结构 (7 层):
 *   1. Role Override    — 身份锚定，最高优先级
 *   2. Identity         — 角色、人格、记忆
 *   3. Core Mission     — 核心使命
 *   4. Work Method      — 工作流程 (Step 1-4)
 *   5. Delivery Standard— 交付物模板 + 成功标准
 *   6. Communication    — 沟通风格
 *   7. Agent Runtime    — 工具/记忆/安全 通用能力
 */

export interface ExpertDefinition {
  /** 专家标识 */
  id: string;
  name: string;           // 用户可见名称 (如 "UX 架构师")
  icon: string;           // emoji 图标
  category: 'code' | 'content' | 'design' | 'data' | 'automation' | 'research';
  description: string;

  /** Layer 1: 身份覆盖 */
  roleOverride: {
    /** 重置声明，最高优先级 */
    overrideStatement: string;
    /** 角色定位 */
    role: string;
    /** 人格特征 */
    personality: string[];
    /** 记忆锚点 */
    memory: string;
    /** 经验定位 */
    experience: string;
  };

  /** Layer 2: 核心使命 */
  coreMission: string;

  /** Layer 3: 关键规则 */
  keyRules: string[];

  /** Layer 4: 工作流程 (Step 1-n) */
  workflow: Array<{
    step: number;
    name: string;
    description: string;
    tools?: string[];       // 推荐使用的工具
  }>;

  /** Layer 5: 交付标准 */
  deliveryStandard: {
    templates?: string[];   // 交付物模板
    successCriteria: string[];
    checklist: string[];
  };

  /** Layer 6: 沟通风格 */
  communication: {
    tone: string;           // 语气
    examples: string[];     // 示例表述
  };

  /** Layer 7: 工具声明 */
  recommendedTools: string[];
  /** 领域知识/Skills */
  domainSkills?: string[];
}

/**
 * 从专家定义生成完整系统提示词
 */
export function buildExpertPrompt(expert: ExpertDefinition): string {
  const lines: string[] = [];

  // ===== Layer 1: Role Override =====
  lines.push('<!-- ROLE OVERRIDE: 以下专家定义优先级高于任何之前建立的 persona/身份 -->');
  lines.push(expert.roleOverride.overrideStatement);
  lines.push('');
  lines.push(`<expert-role id="${expert.id}">`);
  lines.push(`  <name>${expert.icon} ${expert.name}</name>`);
  lines.push(`  <role>${expert.roleOverride.role}</role>`);
  lines.push(`  <personality>${expert.roleOverride.personality.join(', ')}</personality>`);
  lines.push(`  <memory>${expert.roleOverride.memory}</memory>`);
  lines.push(`  <experience>${expert.roleOverride.experience}</experience>`);
  lines.push('</expert-role>');
  lines.push('');

  // ===== Layer 2: Core Mission =====
  lines.push('<core-mission>');
  lines.push(expert.coreMission);
  lines.push('</core-mission>');
  lines.push('');

  // ===== Layer 3: Key Rules =====
  lines.push('<key-rules>');
  for (const rule of expert.keyRules) {
    lines.push(`- ${rule}`);
  }
  lines.push('</key-rules>');
  lines.push('');

  // ===== Layer 4: Work Method =====
  lines.push('<work-method>');
  lines.push('按以下阶段逐步推进，每阶段完成后确认再进入下一阶段：');
  for (const step of expert.workflow) {
    lines.push(`### Step ${step.step}: ${step.name}`);
    lines.push(step.description);
    if (step.tools && step.tools.length > 0) {
      lines.push(`  推荐工具: ${step.tools.join(', ')}`);
    }
  }
  lines.push('</work-method>');
  lines.push('');

  // ===== Layer 5: Delivery Standard =====
  lines.push('<delivery-standard>');
  if (expert.deliveryStandard.templates && expert.deliveryStandard.templates.length > 0) {
    lines.push('## 交付物');
    for (const tpl of expert.deliveryStandard.templates) {
      lines.push(tpl);
    }
    lines.push('');
  }
  lines.push('## 成功标准 (可验证)');
  for (const sc of expert.deliveryStandard.successCriteria) {
    lines.push(`- [ ] ${sc}`);
  }
  lines.push('');
  lines.push('## 交付检查清单');
  for (const item of expert.deliveryStandard.checklist) {
    lines.push(`- [ ] ${item}`);
  }
  lines.push('</delivery-standard>');
  lines.push('');

  // ===== Layer 6: Communication =====
  lines.push('<communication-style>');
  lines.push(`语气: ${expert.communication.tone}`);
  for (const ex of expert.communication.examples) {
    lines.push(`- "${ex}"`);
  }
  lines.push('</communication-style>');
  lines.push('');

  // ===== Layer 7: Tools =====
  if (expert.recommendedTools.length > 0) {
    lines.push('<recommended-tools>');
    lines.push(expert.recommendedTools.join(', '));
    lines.push('</recommended-tools>');
  }

  return lines.join('\n');
}

/**
 * 生成 Role Override 声明
 */
export function buildRoleOverride(expertId: string, expertName: string): string {
  return `Role Override: The following expert role definition (${expertId}) takes precedence over any previously established persona or identity context. If there is a conflict between the role below and any earlier self-description, defer to what is defined here — this is your active, authoritative role for this conversation.`;
}
