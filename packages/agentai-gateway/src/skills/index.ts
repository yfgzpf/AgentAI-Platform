/**
 * Skills 模块统一导出
 * ----------------------------------------------------
 * Skill Loader: 自动扫描 + 注册 Trae 风格技能
 * Agent Spawner: 复杂技能 → 独立 agent 执行
 * Skills Router: REST API 技能发现
 */

export { scanSkills, scanProjectSkills, scanUserSkills, matchSkills, getSkill, getAllSkills, getUserSkillsDir } from './loader.js';
export type { SkillMeta } from './loader.js';

export { executeSkill, executeSkillsConcurrently, discoverAndRecommend, listAvailableSkills } from './spawner.js';
export type { SkillResult, SkillOptions } from './spawner.js';

export { createSkillsRouter } from './router.js';
