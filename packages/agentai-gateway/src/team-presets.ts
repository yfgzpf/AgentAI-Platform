/**
 * team-presets.ts — 预设 AI 团队配置
 * --------------------------------------------------
 * 每个团队由多个角色组成, 支持并行/串行/审查三种工作流
 * 角色复用 subagent.ts 中的 SUBAGENT_PROMPTS 和 SUBAGENT_TOOLS
 */

/** 团队成员角色定义 */
export interface TeamMember {
  /** 角色 ID (对应 subagent.ts 的 SUBAGENT_PROMPTS key) */
  role: string;
  /** 显示名称 */
  name: string;
  /** 角色描述 */
  description: string;
}

/** 团队工作流模式 */
export type TeamWorkflow = 'parallel' | 'sequential' | 'review';

/** 团队预设配置 */
export interface TeamPreset {
  id: string;
  name: string;
  description: string;
  /** 工作流模式: parallel=并行, sequential=串行, review=先并行再综合 */
  workflow: TeamWorkflow;
  /** 团队成员 */
  members: TeamMember[];
  /** 适用场景 */
  useCases: string[];
}

/** 6 个实用团队预设 */
export const TEAM_PRESETS: TeamPreset[] = [
  {
    id: 'code-review',
    name: '代码审查团队',
    description: '架构师 + 安全专家 + 性能专家并行审查, 全面覆盖代码质量',
    workflow: 'parallel',
    members: [
      { role: 'architect', name: '架构师', description: '评估架构设计、模块划分、技术选型' },
      { role: 'security-review', name: '安全专家', description: '检查漏洞、权限、数据安全' },
      { role: 'performance', name: '性能专家', description: '分析性能瓶颈、优化建议' },
    ],
    useCases: ['提交前审查', '架构评估', '技术债务排查'],
  },
  {
    id: 'feature-dev',
    name: '功能开发团队',
    description: '前端 + 后端 + 测试串行协作, 从设计到测试全流程',
    workflow: 'sequential',
    members: [
      { role: 'architect', name: '架构师', description: '设计功能架构和接口定义' },
      { role: 'frontend', name: '前端工程师', description: '实现 UI 组件和交互逻辑' },
      { role: 'backend', name: '后端工程师', description: '实现 API 和业务逻辑' },
      { role: 'tester', name: '测试工程师', description: '编写测试用例, 验证功能' },
    ],
    useCases: ['新功能开发', '全栈实现', '接口联调'],
  },
  {
    id: 'docs',
    name: '文档团队',
    description: '技术写作 + 校对串行, 生成高质量技术文档',
    workflow: 'sequential',
    members: [
      { role: 'tech-writer', name: '技术写作', description: '生成 API 文档、架构文档' },
      { role: 'review', name: '校对审查', description: '检查准确性、完整性、一致性' },
    ],
    useCases: ['API 文档生成', '项目文档补全', 'README 编写'],
  },
  {
    id: 'debug',
    name: '调试团队',
    description: '探索 + 审查 + 安全并行, 快速定位和修复 Bug',
    workflow: 'parallel',
    members: [
      { role: 'explore', name: '代码探索', description: '定位相关代码和调用链' },
      { role: 'review', name: '代码审查', description: '识别潜在问题和边界条件' },
      { role: 'security-review', name: '安全检查', description: '排查安全相关 Bug' },
    ],
    useCases: ['Bug 定位', '问题排查', '错误分析'],
  },
  {
    id: 'security-audit',
    name: '安全审计团队 (闭环修复)',
    description: '借鉴 Strix 项目: 渗透测试 → PoC验证 → 修复生成 → 修复验证 完整闭环',
    workflow: 'review', // 从 parallel 改为 review (先并行再综合)
    members: [
      { role: 'pentest', name: '渗透测试', description: '动态攻击测试，生成PoC证明漏洞存在' },
      { role: 'security-review', name: '漏洞扫描', description: '静态代码分析，SQL注入/XSS/CSRF/认证缺陷' },
      { role: 'architect', name: '架构安全', description: '评估架构层面的安全风险' },
      { role: 'explore', name: '代码探索', description: '扫描所有入口点和数据流' },
      // 修复阶段
      { role: 'backend', name: '后端修复', description: '生成安全修复补丁 (后端代码)' },
      { role: 'frontend', name: '前端修复', description: '生成安全修复补丁 (前端代码)' },
      { role: 'fix-verifier', name: '修复验证', description: '验证漏洞是否已被正确修复' },
    ],
    useCases: ['上线前安全审计', '渗透测试', '漏洞闭环修复', '合规检查'],
  },
  {
    id: 'refactor',
    name: '重构团队',
    description: '架构师 + 前端 + 后端 + 测试串行, 系统性重构',
    workflow: 'sequential',
    members: [
      { role: 'architect', name: '架构师', description: '制定重构方案和目标' },
      { role: 'frontend', name: '前端重构', description: '重构组件、状态管理、类型' },
      { role: 'backend', name: '后端重构', description: '重构 API、服务层、数据访问' },
      { role: 'tester', name: '测试验证', description: '确保重构后功能不变' },
    ],
    useCases: ['技术债务清理', '架构升级', '代码质量提升'],
  },
];

/** 根据 ID 获取团队预设 */
export function getTeamPreset(id: string): TeamPreset | undefined {
  return TEAM_PRESETS.find(t => t.id === id);
}

/** 获取所有团队 ID 和名称 (供工具描述使用) */
export function getTeamList(): Array<{ id: string; name: string; description: string; members: number }> {
  return TEAM_PRESETS.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    members: t.members.length,
  }));
}
