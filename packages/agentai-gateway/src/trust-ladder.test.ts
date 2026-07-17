import { describe, it, expect, beforeEach } from 'vitest';
import { TrustLadder, TrustLevel, AuthorizationDecision } from './trust-ladder.js';

describe('TrustLadder', () => {
  let trustLadder: TrustLadder;

  beforeEach(() => {
    trustLadder = new TrustLadder();
  });

  describe('getEntry', () => {
    it('should create new entry for unknown entity', () => {
      const entry = trustLadder.getEntry('test-tool', 'tool');
      
      expect(entry.entityId).toBe('test-tool');
      expect(entry.entityType).toBe('tool');
      expect(entry.trustScore).toBe(50); // 初始标准信任
      expect(entry.level).toBe('standard');
    });

    it('should return existing entry for known entity', () => {
      const entry1 = trustLadder.getEntry('test-tool', 'tool');
      const entry2 = trustLadder.getEntry('test-tool', 'tool');
      
      expect(entry1).toBe(entry2);
    });
  });

  describe('recordExecution', () => {
    it('should increase trust score on success', () => {
      const entry = trustLadder.recordExecution('test-tool', 'tool', {
        success: true,
        durationMs: 100,
        userFeedback: 1,
      });

      expect(entry.trustScore).toBeGreaterThan(50);
      expect(entry.metrics.successRate).toBeGreaterThan(0.5);
    });

    it('should decrease trust score on failure', () => {
      const entry = trustLadder.recordExecution('test-tool', 'tool', {
        success: false,
        durationMs: 100,
      });

      expect(entry.trustScore).toBeLessThan(50);
    });

    it('should track consecutive successes', () => {
      trustLadder.recordExecution('test-tool', 'tool', { success: true, durationMs: 100 });
      trustLadder.recordExecution('test-tool', 'tool', { success: true, durationMs: 100 });
      trustLadder.recordExecution('test-tool', 'tool', { success: true, durationMs: 100 });

      const entry = trustLadder.getEntry('test-tool', 'tool');
      expect(entry.metrics.consecutiveSuccesses).toBe(3);
    });

    it('should track consecutive failures', () => {
      trustLadder.recordExecution('test-tool', 'tool', { success: false, durationMs: 100 });
      trustLadder.recordExecution('test-tool', 'tool', { success: false, durationMs: 100 });

      const entry = trustLadder.getEntry('test-tool', 'tool');
      expect(entry.metrics.consecutiveFailures).toBe(2);
      expect(entry.metrics.consecutiveSuccesses).toBe(0);
    });

    it('should upgrade level when trust score increases', () => {
      // 多次成功执行
      for (let i = 0; i < 10; i++) {
        trustLadder.recordExecution('test-tool', 'tool', {
          success: true,
          durationMs: 100,
          userFeedback: 1,
        });
      }

      const entry = trustLadder.getEntry('test-tool', 'tool');
      // 10次成功应该达到full级别
      expect(['elevated', 'full']).toContain(entry.level);
    });

    it('should downgrade level when trust score decreases', () => {
      // 先提升到elevated
      for (let i = 0; i < 10; i++) {
        trustLadder.recordExecution('test-tool', 'tool', {
          success: true,
          durationMs: 100,
        });
      }

      // 然后多次失败
      for (let i = 0; i < 5; i++) {
        trustLadder.recordExecution('test-tool', 'tool', {
          success: false,
          durationMs: 100,
        });
      }

      const entry = trustLadder.getEntry('test-tool', 'tool');
      expect(entry.level).toBe('limited');
    });
  });

  describe('checkAuthorization', () => {
    it('should allow read for untrusted entity', () => {
      // 先设置为低信任
      trustLadder.adjustTrust('untrusted-tool', 'tool', 10, '测试');
      
      const decision = trustLadder.checkAuthorization('untrusted-tool', 'tool', 'read');
      
      expect(decision.allowed).toBe(true);
      expect(decision.confirmationLevel).toBe('confirm');
    });

    it('should deny delete for untrusted entity', () => {
      trustLadder.adjustTrust('test-tool', 'tool', 10, '测试');
      
      const decision = trustLadder.checkAuthorization('test-tool', 'tool', 'delete');
      
      expect(decision.allowed).toBe(false);
    });

    it('should allow all actions for full trust entity', () => {
      trustLadder.adjustTrust('test-tool', 'tool', 90, '测试');
      
      const readDecision = trustLadder.checkAuthorization('test-tool', 'tool', 'read');
      const writeDecision = trustLadder.checkAuthorization('test-tool', 'tool', 'write');
      const executeDecision = trustLadder.checkAuthorization('test-tool', 'tool', 'execute');
      const deleteDecision = trustLadder.checkAuthorization('test-tool', 'tool', 'delete');
      
      expect(readDecision.allowed).toBe(true);
      expect(readDecision.confirmationLevel).toBe('none');
      expect(writeDecision.allowed).toBe(true);
      expect(executeDecision.allowed).toBe(true);
      expect(deleteDecision.allowed).toBe(true);
    });

    it('should require confirmation for delete at elevated level', () => {
      trustLadder.adjustTrust('test-tool', 'tool', 70, '测试');
      
      const decision = trustLadder.checkAuthorization('test-tool', 'tool', 'delete');
      
      expect(decision.allowed).toBe(true);
      expect(decision.confirmationLevel).toBe('inform');
    });
  });

  describe('getTrustReport', () => {
    it('should return overall statistics', () => {
      // 创建一些测试数据
      trustLadder.recordExecution('tool-1', 'tool', { success: true, durationMs: 100 });
      trustLadder.recordExecution('tool-2', 'tool', { success: false, durationMs: 100 });
      trustLadder.recordExecution('skill-1', 'skill', { success: true, durationMs: 100 });

      const report = trustLadder.getTrustReport();

      expect(report.total).toBe(3);
      expect(report.byType.tool.count).toBe(2);
      expect(report.byType.skill.count).toBe(1);
    });

    it('should return specific entity report', () => {
      trustLadder.recordExecution('test-tool', 'tool', { success: true, durationMs: 100 });

      const report = trustLadder.getTrustReport('test-tool');

      expect(report).not.toBeNull();
      expect(report?.entityId).toBe('test-tool');
    });
  });

  describe('adjustTrust', () => {
    it('should manually adjust trust score', () => {
      const entry = trustLadder.adjustTrust('test-tool', 'tool', 80, '管理员调整');

      expect(entry.trustScore).toBe(80);
      expect(entry.level).toBe('elevated');
    });

    it('should clamp trust score to 0-100 range', () => {
      const entry1 = trustLadder.adjustTrust('test-tool', 'tool', 150, '测试上限');
      const entry2 = trustLadder.adjustTrust('test-tool-2', 'tool', -50, '测试下限');

      expect(entry1.trustScore).toBe(100);
      expect(entry2.trustScore).toBe(0);
    });
  });

  describe('trust score calculation', () => {
    it('should consider user feedback in score calculation', () => {
      const entryWithFeedback = trustLadder.recordExecution('tool-with-feedback', 'tool', {
        success: true,
        durationMs: 100,
        userFeedback: 1, // 正面反馈
      });

      const entryWithoutFeedback = trustLadder.recordExecution('tool-no-feedback', 'tool', {
        success: true,
        durationMs: 100,
      });

      // 有正面反馈的应该得分更高
      expect(entryWithFeedback.trustScore).toBeGreaterThan(entryWithoutFeedback.trustScore);
    });

    it('should calculate average latency correctly', () => {
      trustLadder.recordExecution('test-tool', 'tool', { success: true, durationMs: 100 });
      trustLadder.recordExecution('test-tool', 'tool', { success: true, durationMs: 200 });
      trustLadder.recordExecution('test-tool', 'tool', { success: true, durationMs: 300 });

      const entry = trustLadder.getEntry('test-tool', 'tool');
      
      // 指数移动平均，应该接近200
      expect(entry.metrics.averageLatency).toBeGreaterThan(150);
      expect(entry.metrics.averageLatency).toBeLessThan(250);
    });
  });
});
