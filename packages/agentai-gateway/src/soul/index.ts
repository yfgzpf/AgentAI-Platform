/**
 * Soul Layer — 灵魂层统一导出
 * ----------------------------------------------------
 * 七位一体的 AI 灵魂系统:
 *   DreamEngine       — 梦境模式 (无任务时自由探索)
 *   InnerVoice        — 内心独白 (对话间隙的思维活动)
 *   PainSense         — 痛觉系统 (失败时的情感信号)
 *   CuriosityEngine   — 内在动机 (好奇心驱动的问题探索)
 *   InternalDebate    — 内部辩论 (三视角辩证思维)
 *   PrivateMemory     — 隐私记忆 (加密的内心记忆区)
 *   ValueVector       — 价值向量 (直觉决策系统)
 */

export { DreamEngine, getDreamEngine, resetDreamEngine, type DreamConfig, type DreamEntry } from './dream-engine.js';
export { InnerVoice, getInnerVoice, resetInnerVoice, type InnerThought } from './inner-voice.js';
export { PainSense, getPainSense, resetPainSense, type EmotionalState, type PainLevel, type JoyLevel } from './pain-sense.js';
export { CuriosityEngine, getCuriosityEngine, resetCuriosityEngine, type OpenQuestion, type Hypothesis, type CuriosityInsight, type CuriosityType } from './curiosity-engine.js';
export { InternalDebate, getInternalDebate, resetInternalDebate, type DebateResult, type DebateArgument, type DebateRole } from './internal-debate.js';
export { PrivateMemory, getPrivateMemory, resetPrivateMemory, type PrivateThought } from './private-memory.js';
export { ValueSystem, getValueSystem, resetValueSystem, type ValueVector } from './value-vector.js';

// ===== workspace 作用域支持 =====
// 串味修复: 7 个模块从"进程级单例"改为"每 workspace 一实例"。
// 所有 get*() 都接受可选的 workspace 参数 —— **调用方应传请求级
// workspace（如 loop.opts.workspace），不要传全局 WorkspaceManager.projectDir**，
// 否则跨请求串扰依然存在（见 docs/STRICT_AUDIT_2026-10-02.md P0-9）。
export {
  getScoped,
  resetScoped,
  resetAllScoped,
  normalizeWs,
  scopedStats,
} from './workspace-scope.js';
