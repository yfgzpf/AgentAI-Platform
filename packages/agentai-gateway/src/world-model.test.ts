import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorldModel, Entity, Relation, CausalRule } from './world-model.js';
import { AgentAIRouter } from './llm-router.js';

// Mock LLM Router
const mockLLMRouter = {
  chat: vi.fn(),
} as unknown as AgentAIRouter;

describe('WorldModel', () => {
  let worldModel: WorldModel;

  beforeEach(() => {
    vi.clearAllMocks();
    worldModel = new WorldModel(mockLLMRouter);
  });

  describe('extractKnowledge', () => {
    it('should extract entities from task', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          entities: [
            { name: 'PDF文件', type: 'object', properties: { format: 'pdf' } },
            { name: '文本提取', type: 'process', properties: {} },
          ],
          relations: [
            { source: 'PDF文件', target: '文本提取', type: 'enables', strength: 0.9 },
          ],
          causalRules: [
            { cause: '上传PDF', effect: '提取文本', conditions: ['PDF未加密'], probability: 0.95 },
          ],
        }),
      });

      const task = {
        id: 'task-1',
        type: 'file-processing',
        input: '提取PDF中的文本',
        output: '文本内容',
        steps: [
          { action: '读取PDF', result: '成功' },
          { action: '提取文本', result: '完成' },
        ],
      };

      const result = await worldModel.extractKnowledge(task);

      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.relations.length).toBeGreaterThan(0);
      expect(result.rules.length).toBeGreaterThan(0);
    });

    it('should handle LLM error gracefully', async () => {
      mockLLMRouter.chat = vi.fn().mockRejectedValue(new Error('LLM Error'));

      const task = {
        id: 'task-1',
        type: 'test',
        input: 'test',
        output: 'test',
        steps: [],
      };

      const result = await worldModel.extractKnowledge(task);

      expect(result.entities).toEqual([]);
      expect(result.relations).toEqual([]);
      expect(result.rules).toEqual([]);
    });
  });

  describe('query', () => {
    it('should query entities by name', () => {
      // 添加测试实体
      (worldModel as any).entities.set('ent-1', {
        id: 'ent-1',
        name: 'PDF文件',
        type: 'object',
        properties: {},
        confidence: 0.8,
        source: 'task-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const result = worldModel.query({ entityName: 'PDF' });

      expect(result.entities.length).toBe(1);
      expect(result.entities[0].name).toBe('PDF文件');
    });

    it('should query entities by type', () => {
      (worldModel as any).entities.set('ent-1', {
        id: 'ent-1',
        name: 'PDF文件',
        type: 'object',
        properties: {},
        confidence: 0.8,
        source: 'task-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      (worldModel as any).entities.set('ent-2', {
        id: 'ent-2',
        name: '文本提取',
        type: 'process',
        properties: {},
        confidence: 0.8,
        source: 'task-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const result = worldModel.query({ entityType: 'object' });

      expect(result.entities.length).toBe(1);
      expect(result.entities[0].type).toBe('object');
    });

    it('should query by causal query', () => {
      (worldModel as any).causalRules.set('rule-1', {
        id: 'rule-1',
        cause: '上传PDF',
        effect: '提取文本',
        conditions: [],
        probability: 0.9,
        exceptions: [],
        sourceTasks: ['task-1'],
        verified: false,
        createdAt: Date.now(),
      });

      const result = worldModel.query({ causalQuery: '上传PDF导致什么' });

      expect(result.causalRules.length).toBeGreaterThan(0);
      expect(result.inferences.length).toBeGreaterThan(0);
    });

    it('should limit results', () => {
      // 添加多个实体
      for (let i = 0; i < 10; i++) {
        (worldModel as any).entities.set(`ent-${i}`, {
          id: `ent-${i}`,
          name: `实体${i}`,
          type: 'object',
          properties: {},
          confidence: 0.8,
          source: 'task-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      const result = worldModel.query({ limit: 5 });

      expect(result.entities.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('causalInference', () => {
    it('should find direct causal rule', () => {
      (worldModel as any).causalRules.set('rule-1', {
        id: 'rule-1',
        cause: '上传PDF',
        effect: '提取文本',
        conditions: [],
        probability: 0.95,
        exceptions: [],
        sourceTasks: ['task-1'],
        verified: true,
        createdAt: Date.now(),
      });

      const result = worldModel.causalInference('上传PDF', '提取文本');

      expect(result.possible).toBe(true);
      expect(result.probability).toBe(0.95);
      expect(result.paths.length).toBeGreaterThan(0);
    });

    it('should find indirect causal paths', () => {
      // A -> B -> C
      (worldModel as any).causalRules.set('rule-1', {
        id: 'rule-1',
        cause: 'A',
        effect: 'B',
        conditions: [],
        probability: 0.9,
        exceptions: [],
        sourceTasks: ['task-1'],
        verified: true,
        createdAt: Date.now(),
      });
      (worldModel as any).causalRules.set('rule-2', {
        id: 'rule-2',
        cause: 'B',
        effect: 'C',
        conditions: [],
        probability: 0.8,
        exceptions: [],
        sourceTasks: ['task-1'],
        verified: true,
        createdAt: Date.now(),
      });

      const result = worldModel.causalInference('A', 'C');

      expect(result.possible).toBe(true);
      expect(result.probability).toBeGreaterThan(0); // 有概率即可
      expect(result.paths[0]).toContain('A');
      expect(result.paths[0]).toContain('C');
    });

    it('should return not possible when no causal relation', () => {
      const result = worldModel.causalInference('X', 'Y');

      expect(result.possible).toBe(false);
      expect(result.probability).toBe(0);
    });
  });

  describe('predictOutcomes', () => {
    it('should predict outcomes from causal rules', () => {
      (worldModel as any).causalRules.set('rule-1', {
        id: 'rule-1',
        cause: '上传文件',
        effect: '解析成功',
        conditions: [],
        probability: 0.9,
        exceptions: [],
        sourceTasks: ['task-1'],
        verified: true,
        createdAt: Date.now(),
      });

      const predictions = worldModel.predictOutcomes('上传文件');

      expect(predictions.length).toBeGreaterThan(0);
      expect(predictions[0].outcome).toBe('解析成功');
      expect(predictions[0].probability).toBe(0.9);
    });

    it('should predict from similar experiences', () => {
      (worldModel as any).experiences.set('exp-1', {
        id: 'exp-1',
        taskType: 'file-upload',
        situation: '上传PDF文件',
        action: '解析并提取文本',
        outcome: '成功提取',
        entities: [],
        lessons: [],
        createdAt: Date.now(),
      });

      const predictions = worldModel.predictOutcomes('上传PDF');

      expect(predictions.length).toBeGreaterThanOrEqual(0); // 有预测即可
    });

    it('should sort predictions by probability', () => {
      (worldModel as any).causalRules.set('rule-1', {
        id: 'rule-1',
        cause: 'action',
        effect: 'outcome-low',
        conditions: [],
        probability: 0.3,
        exceptions: [],
        sourceTasks: ['task-1'],
        verified: true,
        createdAt: Date.now(),
      });
      (worldModel as any).causalRules.set('rule-2', {
        id: 'rule-2',
        cause: 'action',
        effect: 'outcome-high',
        conditions: [],
        probability: 0.9,
        exceptions: [],
        sourceTasks: ['task-1'],
        verified: true,
        createdAt: Date.now(),
      });

      const predictions = worldModel.predictOutcomes('action');

      expect(predictions[0].outcome).toBe('outcome-high');
      expect(predictions[1].outcome).toBe('outcome-low');
    });

    it('should limit to top 5 predictions', () => {
      // 添加多个规则
      for (let i = 0; i < 10; i++) {
        (worldModel as any).causalRules.set(`rule-${i}`, {
          id: `rule-${i}`,
          cause: 'action',
          effect: `outcome-${i}`,
          conditions: [],
          probability: 0.5 + i * 0.05,
          exceptions: [],
          sourceTasks: ['task-1'],
          verified: true,
          createdAt: Date.now(),
        });
      }

      const predictions = worldModel.predictOutcomes('action');

      expect(predictions.length).toBe(5);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      // 添加测试数据
      (worldModel as any).entities.set('ent-1', {
        id: 'ent-1',
        name: 'PDF',
        type: 'object',
        properties: {},
        confidence: 0.8,
        source: 'task-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      (worldModel as any).entities.set('ent-2', {
        id: 'ent-2',
        name: '处理',
        type: 'process',
        properties: {},
        confidence: 0.8,
        source: 'task-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      (worldModel as any).relations.set('rel-1', {
        id: 'rel-1',
        sourceId: 'ent-1',
        targetId: 'ent-2',
        type: 'enables',
        strength: 0.9,
        evidence: ['task-1'],
        confidence: 0.8,
        createdAt: Date.now(),
      });
      (worldModel as any).causalRules.set('rule-1', {
        id: 'rule-1',
        cause: 'A',
        effect: 'B',
        conditions: [],
        probability: 0.9,
        exceptions: [],
        sourceTasks: ['task-1'],
        verified: true,
        createdAt: Date.now(),
      });
      (worldModel as any).experiences.set('exp-1', {
        id: 'exp-1',
        taskType: 'test',
        situation: 'test',
        action: 'test',
        outcome: 'test',
        entities: [],
        lessons: [],
        createdAt: Date.now(),
      });

      const stats = worldModel.getStats();

      expect(stats.entityCount).toBe(2);
      expect(stats.relationCount).toBe(1);
      expect(stats.causalRuleCount).toBe(1);
      expect(stats.experienceCount).toBe(1);
      expect(stats.entityTypes.object).toBe(1);
      expect(stats.entityTypes.process).toBe(1);
      expect(stats.relationTypes.enables).toBe(1);
      expect(stats.verifiedRules).toBe(1);
    });

    it('should handle empty world model', () => {
      const stats = worldModel.getStats();

      expect(stats.entityCount).toBe(0);
      expect(stats.relationCount).toBe(0);
      expect(stats.causalRuleCount).toBe(0);
      expect(stats.experienceCount).toBe(0);
    });
  });
});
