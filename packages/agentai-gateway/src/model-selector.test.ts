/**
 * 模型选择器单元测试 + 与旧逻辑一致性验证
 * --------------------------------------------------
 * 确保新模型选择器与 chat.ts 原有逻辑行为一致
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as modelSelector from './model-selector.js';

// 模拟环境变量
const originalEnv = process.env;

beforeAll(() => {
  // 设置测试用的 API Keys
  process.env.AGENTAI_API_KEY = 'test-agentai-key';
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
  process.env.ZHIPU_API_KEY = 'test-zhipu-key';
  process.env.SUPERAPI_API_KEY = 'test-superapi-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
});

afterAll(() => {
  process.env = originalEnv;
});

describe('model-selector', () => {
  describe('getModelConfig', () => {
    it('应返回内置模型配置', () => {
      const config = modelSelector.getModelConfig('agentai');
      expect(config).toBeDefined();
      expect(config?.provider).toBe('agnes'); // agentai 映射到 agnes provider
      expect(config?.label).toBe('Agnes AI');
    });

    it('应返回 deepseek 配置', () => {
      const config = modelSelector.getModelConfig('deepseek');
      expect(config?.provider).toBe('deepseek');
      expect(config?.subModel).toBe('deepseek-v4-flash');
    });

    it('无效模型应返回 undefined', () => {
      const config = modelSelector.getModelConfig('invalid-model');
      expect(config).toBeUndefined();
    });
  });

  describe('isValidModel', () => {
    it('应识别有效模型', () => {
      expect(modelSelector.isValidModel('agentai')).toBe(true);
      expect(modelSelector.isValidModel('deepseek')).toBe(true);
      expect(modelSelector.isValidModel('openai')).toBe(true);
    });

    it('应识别无效模型', () => {
      expect(modelSelector.isValidModel('unknown')).toBe(false);
      expect(modelSelector.isValidModel('')).toBe(false);
    });
  });

  describe('selectAvailableModel', () => {
    it('有效模型应直接返回', () => {
      const result = modelSelector.selectAvailableModel('agentai');
      expect(result.provider).toBe('agnes'); // agentai 映射到 agnes provider
      expect(result.fallback).toBe(false);
      expect(result.requested).toBe('agentai');
    });

    it('未指定模型应默认 agentai', () => {
      const result = modelSelector.selectAvailableModel(undefined);
      expect(result.provider).toBe('agnes'); // agentai 映射到 agnes provider
      expect(result.requested).toBe('agentai');
    });

    it('应支持 SuperAPI 模型', () => {
      const result = modelSelector.selectAvailableModel('superapi-deepseek-v4-flash');
      expect(result.provider).toBe('superapi');
      expect(result.subModel).toBe('deepseek-v4-flash');
    });
  });

  describe('自定义模型', () => {
    it('应支持动态注册', () => {
      modelSelector.registerCustomModel('custom-gpt4', {
        provider: 'openai',
        subModel: 'gpt-4',
        label: 'Custom GPT-4',
        baseURL: 'https://custom.api.com',
      });

      const config = modelSelector.getModelConfig('custom-gpt4');
      expect(config?.provider).toBe('openai');
      expect(config?.subModel).toBe('gpt-4');
      expect(modelSelector.isValidModel('custom-gpt4')).toBe(true);
    });
  });
});

/**
 * 一致性测试: 验证新选择器与 chat.ts 原有逻辑等价
 */
describe('一致性验证 (与 chat.ts 原有逻辑)', () => {
  describe('模型映射一致性', () => {
    const expectedModels = [
      { id: 'agentai', provider: 'agnes', subModel: 'agnes-2.5-flash' }, // agentai 映射到 agnes，有 subModel
      { id: 'deepseek', provider: 'deepseek', subModel: 'deepseek-v4-flash' },
      { id: 'deepseek-pro', provider: 'deepseek', subModel: 'deepseek-v4-pro' },
      { id: 'openai', provider: 'openai', hasSubModel: false },
      { id: 'zhipu', provider: 'zhipu', subModel: 'glm-4.7-flash' },
    ];

    it.each(expectedModels)('$id 配置应与 chat.ts 一致', ({ id, provider, subModel, hasSubModel }) => {
      const config = modelSelector.getModelConfig(id);
      expect(config).toBeDefined();
      expect(config?.provider).toBe(provider);
      if (subModel) {
        expect(config?.subModel).toBe(subModel);
      } else if (hasSubModel === false) {
        expect(config?.subModel).toBeUndefined();
      }
    });
  });

  describe('降级顺序一致性', () => {
    it('降级顺序应为 agentai → zhipu → deepseek', () => {
      // 模拟 deepseek 不可用（无 key）
      const originalDeepseekKey = process.env.DEEPSEEK_API_KEY;
      delete process.env.DEEPSEEK_API_KEY;

      const result = modelSelector.selectAvailableModel('deepseek');
      // 由于 agentai 有 key，应该降级到 agnes (agentai 的 provider)
      expect(result.provider).toBe('agnes');
      expect(result.fallback).toBe(true);

      process.env.DEEPSEEK_API_KEY = originalDeepseekKey;
    });
  });
});
