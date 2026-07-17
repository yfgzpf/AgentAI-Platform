import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KnowledgeGapDetector, KnowledgeGap, LearningPlan } from './knowledge-gap-detector.js';
import { AgentAIRouter } from './llm-router.js';

// Mock LLM Router
const mockLLMRouter = {
  chat: vi.fn(),
} as unknown as AgentAIRouter;

describe('KnowledgeGapDetector', () => {
  let detector: KnowledgeGapDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new KnowledgeGapDetector(mockLLMRouter);
  });

  describe('detectGap', () => {
    it('should detect gap from failed execution', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          isGap: true,
          type: 'skill',
          description: '缺少PDF处理知识',
          urgency: 'high',
        }),
      });

      const execution = {
        taskType: 'file-processing',
        input: '处理PDF文件',
        output: '',
        success: false,
        error: 'Unknown file format: PDF',
        toolsUsed: ['read_file'],
        durationMs: 1000,
      };

      const gap = await detector.detectGap(execution);

      expect(gap).not.toBeNull();
      expect(['skill', 'domain', 'concept']).toContain(gap?.type);
      expect(gap?.status).toBe('pending');
    });

    it('should detect efficiency gap from slow execution', async () => {
      const execution = {
        taskType: 'data-processing',
        input: '处理大数据',
        output: '完成',
        success: true,
        toolsUsed: ['process_data'],
        durationMs: 120000, // 2分钟，超过阈值
      };

      const gap = await detector.detectGap(execution);

      expect(gap).not.toBeNull();
      expect(gap?.type).toBe('pattern');
      expect(gap?.description).toContain('执行时间过长');
    });

    it('should detect process gap from too many tools', async () => {
      const execution = {
        taskType: 'complex-task',
        input: '复杂任务',
        output: '完成',
        success: true,
        toolsUsed: ['tool1', 'tool2', 'tool3', 'tool4', 'tool5', 'tool6'], // 6个工具
        durationMs: 5000,
      };

      const gap = await detector.detectGap(execution);

      expect(gap).not.toBeNull();
      expect(gap?.type).toBe('pattern');
      expect(gap?.description).toContain('流程可能可以优化');
    });

    it('should return null for successful normal execution', async () => {
      const execution = {
        taskType: 'simple-task',
        input: '简单任务',
        output: '完成',
        success: true,
        toolsUsed: ['tool1'],
        durationMs: 1000,
      };

      const gap = await detector.detectGap(execution);

      expect(gap).toBeNull();
    });

    it('should handle LLM error gracefully', async () => {
      mockLLMRouter.chat = vi.fn().mockRejectedValue(new Error('LLM Error'));

      const execution = {
        taskType: 'file-processing',
        input: '处理文件',
        output: '',
        success: false,
        error: 'Error',
        toolsUsed: [],
        durationMs: 1000,
      };

      const gap = await detector.detectGap(execution);

      expect(gap).toBeNull();
    });
  });

  describe('generateLearningPlan', () => {
    it('should generate learning plan for gap', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: `
学习计划:
1. 阅读PDF处理文档
2. 查看代码示例
3. 实践练习

预计时间: 45分钟
完成标准: 能够独立处理PDF文件
`,
      });

      const gap: KnowledgeGap = {
        id: 'gap-1',
        type: 'skill',
        description: '缺少PDF处理知识',
        relatedTasks: ['file-processing'],
        urgency: 'high',
        discoveredAt: Date.now(),
        status: 'pending',
      };

      const plan = await detector.generateLearningPlan(gap);

      expect(plan.gapId).toBe(gap.id);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.estimatedMinutes).toBeGreaterThan(0);
      expect(gap.status).toBe('learning');
    });

    it('should return default plan on LLM error', async () => {
      mockLLMRouter.chat = vi.fn().mockRejectedValue(new Error('LLM Error'));

      const gap: KnowledgeGap = {
        id: 'gap-1',
        type: 'skill',
        description: '缺少知识',
        relatedTasks: [],
        urgency: 'medium',
        discoveredAt: Date.now(),
        status: 'pending',
      };

      const plan = await detector.generateLearningPlan(gap);

      expect(plan.gapId).toBe(gap.id);
      expect(plan.steps.length).toBeGreaterThanOrEqual(2); // 至少2步
      expect(plan.estimatedMinutes).toBe(30); // 默认30分钟
    });
  });

  describe('enqueueLearning', () => {
    it('should add gap to learning queue', () => {
      const gap: KnowledgeGap = {
        id: 'gap-1',
        type: 'skill',
        description: '缺少知识',
        relatedTasks: [],
        urgency: 'high',
        discoveredAt: Date.now(),
        status: 'pending',
      };

      (detector as any).gaps.set(gap.id, gap);
      detector.enqueueLearning(gap.id);

      const pendingGaps = detector.getPendingGaps();
      expect(pendingGaps.length).toBe(1);
      expect(pendingGaps[0].id).toBe(gap.id);
    });

    it('should sort queue by urgency', () => {
      const gapLow: KnowledgeGap = {
        id: 'gap-low',
        type: 'skill',
        description: '低优先级',
        relatedTasks: [],
        urgency: 'low',
        discoveredAt: Date.now(),
        status: 'pending',
      };

      const gapHigh: KnowledgeGap = {
        id: 'gap-high',
        type: 'skill',
        description: '高优先级',
        relatedTasks: [],
        urgency: 'high',
        discoveredAt: Date.now(),
        status: 'pending',
      };

      (detector as any).gaps.set(gapLow.id, gapLow);
      (detector as any).gaps.set(gapHigh.id, gapHigh);

      detector.enqueueLearning(gapLow.id);
      detector.enqueueLearning(gapHigh.id);

      const pendingGaps = detector.getPendingGaps();
      expect(pendingGaps[0].id).toBe('gap-high');
      expect(pendingGaps[1].id).toBe('gap-low');
    });

    it('should not add duplicate gaps', () => {
      const gap: KnowledgeGap = {
        id: 'gap-1',
        type: 'skill',
        description: '缺少知识',
        relatedTasks: [],
        urgency: 'medium',
        discoveredAt: Date.now(),
        status: 'pending',
      };

      (detector as any).gaps.set(gap.id, gap);
      detector.enqueueLearning(gap.id);
      detector.enqueueLearning(gap.id);

      const pendingGaps = detector.getPendingGaps();
      expect(pendingGaps.length).toBe(1);
    });
  });

  describe('executeLearning', () => {
    it('should execute learning session', async () => {
      const gap: KnowledgeGap = {
        id: 'gap-1',
        type: 'skill',
        description: '缺少知识',
        relatedTasks: [],
        urgency: 'medium',
        discoveredAt: Date.now(),
        status: 'pending',
        learningPlan: {
          gapId: 'gap-1',
          resources: [],
          estimatedMinutes: 30,
          steps: [
            { order: 1, description: '步骤1', type: 'read', estimatedMinutes: 10 },
            { order: 2, description: '步骤2', type: 'practice', estimatedMinutes: 10 },
          ],
          completionCriteria: '完成',
        },
      };

      (detector as any).gaps.set(gap.id, gap);
      (detector as any).learningQueue.push(gap.id);

      const session = await detector.executeLearning(30);

      expect(session).not.toBeNull();
      expect(session?.gapId).toBe(gap.id);
      expect(session?.totalSteps).toBe(2);
      expect(session?.stepsCompleted).toBe(2);
      expect(session?.outcome).toBe('success');
    });

    it('should return null when already learning', async () => {
      (detector as any).isLearning = true;

      const session = await detector.executeLearning(30);

      expect(session).toBeNull();
    });

    it('should return null when queue is empty', async () => {
      const session = await detector.executeLearning(30);

      expect(session).toBeNull();
    });

    it('should handle timeout', async () => {
      const gap: KnowledgeGap = {
        id: 'gap-1',
        type: 'skill',
        description: '缺少知识',
        relatedTasks: [],
        urgency: 'medium',
        discoveredAt: Date.now(),
        status: 'pending',
        learningPlan: {
          gapId: 'gap-1',
          resources: [],
          estimatedMinutes: 60,
          steps: [
            { order: 1, description: '步骤1', type: 'read', estimatedMinutes: 20 },
            { order: 2, description: '步骤2', type: 'practice', estimatedMinutes: 20 },
            { order: 3, description: '步骤3', type: 'implement', estimatedMinutes: 20 },
          ],
          completionCriteria: '完成',
        },
      };

      (detector as any).gaps.set(gap.id, gap);
      (detector as any).learningQueue.push(gap.id);

      const session = await detector.executeLearning(1); // 1分钟超时

      expect(session).not.toBeNull();
      expect(['success', 'partial']).toContain(session?.outcome);
    });
  });

  describe('getPendingGaps', () => {
    it('should return only pending and learning gaps', () => {
      const gapPending: KnowledgeGap = {
        id: 'gap-pending',
        type: 'skill',
        description: '待处理',
        relatedTasks: [],
        urgency: 'medium',
        discoveredAt: Date.now(),
        status: 'pending',
      };

      const gapLearning: KnowledgeGap = {
        id: 'gap-learning',
        type: 'skill',
        description: '学习中',
        relatedTasks: [],
        urgency: 'high',
        discoveredAt: Date.now(),
        status: 'learning',
      };

      const gapResolved: KnowledgeGap = {
        id: 'gap-resolved',
        type: 'skill',
        description: '已解决',
        relatedTasks: [],
        urgency: 'low',
        discoveredAt: Date.now(),
        status: 'resolved',
      };

      (detector as any).gaps.set(gapPending.id, gapPending);
      (detector as any).gaps.set(gapLearning.id, gapLearning);
      (detector as any).gaps.set(gapResolved.id, gapResolved);

      const pendingGaps = detector.getPendingGaps();

      expect(pendingGaps.length).toBe(2);
      expect(pendingGaps.some(g => g.id === 'gap-pending')).toBe(true);
      expect(pendingGaps.some(g => g.id === 'gap-learning')).toBe(true);
      expect(pendingGaps.some(g => g.id === 'gap-resolved')).toBe(false);
    });

    it('should sort by urgency', () => {
      const gapLow: KnowledgeGap = {
        id: 'gap-low',
        type: 'skill',
        description: '低',
        relatedTasks: [],
        urgency: 'low',
        discoveredAt: Date.now(),
        status: 'pending',
      };

      const gapCritical: KnowledgeGap = {
        id: 'gap-critical',
        type: 'skill',
        description: '严重',
        relatedTasks: [],
        urgency: 'critical',
        discoveredAt: Date.now(),
        status: 'pending',
      };

      const gapHigh: KnowledgeGap = {
        id: 'gap-high',
        type: 'skill',
        description: '高',
        relatedTasks: [],
        urgency: 'high',
        discoveredAt: Date.now(),
        status: 'pending',
      };

      (detector as any).gaps.set(gapLow.id, gapLow);
      (detector as any).gaps.set(gapCritical.id, gapCritical);
      (detector as any).gaps.set(gapHigh.id, gapHigh);

      const pendingGaps = detector.getPendingGaps();

      expect(pendingGaps[0].urgency).toBe('critical');
      expect(pendingGaps[1].urgency).toBe('high');
      expect(pendingGaps[2].urgency).toBe('low');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const gaps: KnowledgeGap[] = [
        { id: '1', type: 'skill', description: '', relatedTasks: [], urgency: 'medium', discoveredAt: Date.now(), status: 'resolved' },
        { id: '2', type: 'skill', description: '', relatedTasks: [], urgency: 'medium', discoveredAt: Date.now(), status: 'pending' },
        { id: '3', type: 'concept', description: '', relatedTasks: [], urgency: 'high', discoveredAt: Date.now(), status: 'learning' },
        { id: '4', type: 'skill', description: '', relatedTasks: [], urgency: 'low', discoveredAt: Date.now(), status: 'dismissed' },
      ];

      for (const gap of gaps) {
        (detector as any).gaps.set(gap.id, gap);
      }

      // 添加一些学习会话
      (detector as any).sessions.set('session-1', {
        id: 'session-1',
        gapId: '1',
        startedAt: Date.now() - 3600000,
        completedAt: Date.now(),
        stepsCompleted: 3,
        totalSteps: 3,
        notes: '',
        outcome: 'success',
      });

      const stats = detector.getStats();

      expect(stats.totalGaps).toBe(4);
      expect(stats.resolved).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.learning).toBe(1);
      expect(stats.dismissed).toBe(1);
      expect(stats.totalLearningTime).toBeGreaterThan(0);
    });
  });
});
