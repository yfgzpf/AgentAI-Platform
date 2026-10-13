/**
 * 模型工厂链路回归测试 (2026-10-13)
 * ==================================================================
 * 这个文件锁住一个真实链路断裂的修复, 不是为了凑覆盖率。
 *
 * 断裂症状 (用户实机):
 *   在设置页「模型工厂」填了密钥 → 验证成功 → 启用模型 → 选择该模型对话,
 *   实际却在用免费档 (agentai)。全程无报错。
 *
 * 两个独立根因:
 *   ① ID 前缀分裂: GUI 模型工厂发的 id 是 `factory-glm-5`, 而 gateway 的
 *      MODEL_MAP / BUILTIN_MODELS 只认 `alrc-glm-5` ⇒ 查不到 ⇒ 静默落免费档。
 *   ② 密钥写到了没人读的地方: Settings.tsx 调 saveApiKeyToGateway('factory', key),
 *      而 settings.ts 的 ENV_KEY_MAP 没有 'factory' 键 ⇒ 回落成 FACTORY_API_KEY,
 *      但全项目没有任何一处读 FACTORY_API_KEY。router 读的是 FACTORY_CHAT_KEY 等
 *      6 个分组变量 ⇒ hasKey 恒false ⇒ 就算 ID 修对了也会降级。
 *
 * 所以测试必须同时覆盖: 别名存在 + 分组密钥被认作有效凭据。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as modelSelector from './model-selector.js';

const FACTORY_GROUP_ENVS = [
  'FACTORY_CHAT_KEY', 'FACTORY_GPT_KEY', 'FACTORY_CLAUDE_KEY',
  'FACTORY_GROK_KEY', 'FACTORY_IMAGE_KEY', 'FACTORY_VIDEO_KEY',
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  // 每个用例前清干净: 只要 ALRC_API_KEY 或任一 FACTORY_*_KEY 存在就会让 alrc 判定有 key,
  // 不清会互相污染, 导致"无 key 时应降级"的用例被上一个用例喂成true。
  savedEnv['ALRC_API_KEY'] = process.env.ALRC_API_KEY;
  delete process.env.ALRC_API_KEY;
  for (const k of FACTORY_GROUP_ENVS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('模型工厂 factory-* → alrc-* 别名', () => {
  it('factory-glm-5 应能解析成 alrc provider (而非落回 agentai)', () => {
    const config = modelSelector.getModelConfig('factory-glm-5');
    expect(config).toBeDefined();
    // 这是核心断言: 若别名不存在, getModelConfig 返回 undefined,
    // selectAvailableModel 就会回落到 BUILTIN_MODELS['agentai'] = 免费档。
    expect(config!.provider).toBe('alrc');
    expect(config!.subModel).toBe('glm-5');
  });

  it('GUI modelStore 里每个 factory-* 对话模型都应有对应别名', () => {
    // 逐条抄自 packages/agentai-gui/src/store/modelStore.ts FACTORY_CHAT_MODELS
    const guiFactoryIds = [
      'factory-deepseek-v4-flash', 'factory-glm-4.7', 'factory-glm-5',
      'factory-glm-5.1', 'factory-glm-5.2', 'factory-kimi-k2.5',
      'factory-kimi-k2.6', 'factory-kimi-k2.7-code', 'factory-kimi-k3',
      'factory-minimax-m2.5', 'factory-minimax-m2.7', 'factory-minimax-m3',
      'factory-hy3',
    ];
    const missing = guiFactoryIds.filter((id) => !modelSelector.getModelConfig(id));
    expect(missing, `这些 GUI 模型在 gateway 侧无别名: ${missing.join(', ')}`).toEqual([]);
  });

  it('别名不应污染 alrc-* 原条目 (两者都必须可用)', () => {
    expect(modelSelector.getModelConfig('alrc-glm-5')?.provider).toBe('alrc');
    expect(modelSelector.getModelConfig('factory-glm-5')?.provider).toBe('alrc');
  });
});

describe('只配分组密钥时不得降级 (根因②)', () => {
  it('仅有 FACTORY_CHAT_KEY、ALRC_API_KEY 为空时, factory-glm-5 不应降级到免费档', () => {
    process.env.FACTORY_CHAT_KEY = 'group-only-key';
    // 不设AGENTAI_API_KEY, 若真发生降级, 回落目标 agentai 也没有 key,
    // 那么结果会是 agentai —— 用"provider 仍是 alrc"来判定是否被降级。
    const sel = modelSelector.selectAvailableModel('factory-glm-5');
    expect(sel.provider).toBe('alrc');
    expect(sel.subModel).toBe('glm-5');
    expect(sel.fallback).toBe(false);
  });

  it('六个分组密钥每一个都能单独让 alrc 生效', () => {
    for (const envName of FACTORY_GROUP_ENVS) {
      for (const other of FACTORY_GROUP_ENVS) delete process.env[other];
      process.env[envName] = `key-from-${envName}`;
      const sel = modelSelector.selectAvailableModel('factory-glm-5');
      expect(sel.provider, `${envName} 未被认作有效凭据`).toBe('alrc');
      expect(sel.fallback, `${envName} 存在时仍被降级`).toBe(false);
    }
  });

  it('一个工厂密钥都没有时, 才允许降级 (对照组: 别把兜底逻辑一起删了)', () => {
    const sel = modelSelector.selectAvailableModel('factory-glm-5');
    // 此时 provider 会走回落链; 断言它不再是 alrc 即可, 不锁死具体回落到谁
    expect(sel.provider).not.toBe('alrc');
  });
});