/**
 * Discipline — 统一出口
 * ----------------------------------------------------
 * 执行纪律层（Execution Discipline Layer）
 *
 * 治未病 — 每次动手之前先立规矩，而不是等坏了再修。
 *
 * 三层纪律：
 *   1. 断言层 (assertions) —「怎么算完成」必须机器可验证
 *   2. 闸门层 (gates)     —「不可逆动作」必须先建锚点 + 预演 + 审批
 *   3. 记事层 (notebook)  —「为什么这么做」必须落盘可审计可恢复
 *
 * 这三者合起来，就是把「资深工程师的工作纪律」变成可执行的代码。
 * 它们的共同点是：都不依赖模型的自述，只依赖可验证的事实。
 */
// ===== 层 1：断言 =====
export { verifyAssert, verifyStage, formatGateResult, fromLegacyCriteria, normalizeAcceptance, } from './assertions.js';
// ===== 层 1 附：内置断言集 =====
export { typecheckClean, testGreen, buildPass, noOrphanAfterDelete, verifyNoRefsBeforeDelete, noUnstagedPollution, guardzoneUntouched, coreAssetUntouched, postDeleteStandard, refactorDefense, governanceDefense, analysisOnlyDefense, GUARDZONE_DIRS, } from './builtin.js';
// ===== 层 2：闸门 =====
export { gateActionPlan, gateAction, createAnchor, listAnchors, formatGateDecision, canDeleteFiles, DEFAULT_RULES, } from './gates.js';
// ===== 层 3：记事本 =====
export { createNotebook, newRunId, saveNotebook, loadNotebook, listNotebooks, startStage, finishStage, blockStage, getStage, upsertStage, recordDecision, addAnchor, recordGateDenial, recordHumanDecision, linkPrescription, resumeFrom, DisciplineRun, resumeRun, } from './notebook.js';
// ===== 版本信息 =====
export const DISCIPLINE_VERSION = '1.0.0';
export const DISCIPLINE_LAYERS = ['assertions', 'gates', 'notebook'];
