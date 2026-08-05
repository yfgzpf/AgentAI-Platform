/**
 * self-memory-updater 单元测试
 * ==============================
 * 覆盖:
 *   - shouldRemember: 重要性/会话上限/entityId 去重/内容长度
 *   - rememberThis: 写入成功/重复拒绝/失败容错
 *   - 5 类场景化快捷方法
 *   - 会话级管理 (getSessionStats/resetSession)
 *
 * 运行: npx vitest run src/self-memory-updater.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// ═══════════════════════════════════════════════════════════
// 测试隔离: 每个用例使用独立临时 workspace
// ═══════════════════════════════════════════════════════════

let tmpWorkspace: string;

beforeEach(async () => {
  // 创建临时工作目录
  tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentai-test-'));
  // 动态导入被测模块 (每个测试重置模块状态)
  vi.resetModules();
});

afterEach(async () => {
  // 清理临时目录
  try {
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
});

describe('shouldRemember', () => {
  it('重要性 < 3 应拒绝', async () => {
    const { shouldRemember } = await import('./self-memory-updater.js');
    const result = shouldRemember({
      category: 'bug_fix',
      title: '测试',
      content: '这是一个测试用的内容字符串',
      entityId: 'test:1',
      importance: 2,
    });
    expect(result.should).toBe(false);
    expect(result.reason).toContain('重要性');
  });

  it('重要性 = 3 应通过', async () => {
    const { shouldRemember } = await import('./self-memory-updater.js');
    const result = shouldRemember({
      category: 'bug_fix',
      title: '测试',
      content: '这是一个测试用的内容字符串',
      entityId: 'test:2',
      importance: 3,
    });
    expect(result.should).toBe(true);
  });

  it('内容过短 (<10 字符) 应拒绝', async () => {
    const { shouldRemember } = await import('./self-memory-updater.js');
    const result = shouldRemember({
      category: 'bug_fix',
      title: '短',
      content: '短',
      entityId: 'test:3',
      importance: 5,
    });
    expect(result.should).toBe(false);
    expect(result.reason).toContain('过短');
  });

  it('5 类分类都应支持', async () => {
    const { shouldRemember } = await import('./self-memory-updater.js');
    const categories = ['bug_fix', 'decision', 'pattern', 'user_preference', 'project_fact'] as const;
    for (const category of categories) {
      const result = shouldRemember({
        category,
        title: `测试 ${category}`,
        content: `这是 ${category} 类型的测试内容字符串`,
        entityId: `test:cat:${category}`,
        importance: 4,
      });
      expect(result.should).toBe(true);
    }
  });
});

describe('rememberThis - 写入与去重', () => {
  it('首次写入应成功', async () => {
    const { rememberThis, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    const result = await rememberThis(tmpWorkspace, {
      category: 'decision',
      title: '使用 BM25 检索',
      content: '决定使用 BM25 而非向量检索, 因为项目规模小且需要精确匹配',
      entityId: 'decision:bm25',
      importance: 5,
      tags: ['retrieval', 'decision'],
    });
    expect(result.written).toBe(true);
    expect(result.entry).toBeDefined();
    expect(result.entry?.entityId).toBe('decision:bm25');
  });

  it('相同 entityId 应去重拒绝', async () => {
    const { rememberThis, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    const candidate = {
      category: 'bug_fix' as const,
      title: 'PowerShell 不支持 &&',
      content: 'PowerShell 使用 ; 作为分隔符, 不支持 && 语法, 需要改用分号',
      entityId: 'bug:ps:ampersand',
      importance: 4,
    };
    // 第一次写入
    const r1 = await rememberThis(tmpWorkspace, candidate);
    expect(r1.written).toBe(true);
    // 第二次应被去重 (内存集合优先拦截)
    const r2 = await rememberThis(tmpWorkspace, candidate);
    expect(r2.written).toBe(false);
    // 内存去重返回 "已写入", 持久化去重返回 "已存在"
    expect(r2.reason).toMatch(/已写入|已存在/);
  });

  it('低重要性应拒绝写入', async () => {
    const { rememberThis, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    const result = await rememberThis(tmpWorkspace, {
      category: 'project_fact',
      title: '无关紧要的事实',
      content: '这是一个不重要的事实内容字符串',
      entityId: 'fact:trivial',
      importance: 1,
    });
    expect(result.written).toBe(false);
    expect(result.reason).toContain('重要性');
  });
});

describe('场景化快捷方法', () => {
  it('rememberBugFix 应写入 bug_fix 类', async () => {
    const { rememberBugFix, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    const result = await rememberBugFix(tmpWorkspace, {
      symptom: '编译失败',
      rootCause: 'PowerShell 不支持 &&',
      solution: '改用 ; 分隔',
      file: 'tools.ts',
    });
    expect(result.written).toBe(true);
    expect(result.entry?.metadata?.category).toBe('bug_fix');
  });

  it('rememberDecision 应写入 decision 类', async () => {
    const { rememberDecision, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    const result = await rememberDecision(tmpWorkspace, {
      decision: '使用 BM25 检索',
      rationale: '项目规模小, 精确匹配优先',
      alternatives: '向量检索 (成本高)',
    });
    expect(result.written).toBe(true);
    expect(result.entry?.metadata?.category).toBe('decision');
  });

  it('rememberUserPreference 应写入 user_preference 类', async () => {
    const { rememberUserPreference, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    const result = await rememberUserPreference(tmpWorkspace, {
      preference: '中文沟通',
      evidence: '用户所有消息都是中文',
    });
    expect(result.written).toBe(true);
    expect(result.entry?.metadata?.category).toBe('user_preference');
  });

  it('rememberPattern 应写入 pattern 类', async () => {
    const { rememberPattern, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    const result = await rememberPattern(tmpWorkspace, {
      pattern: '三层架构',
      description: 'gui → gateway → core 单向依赖',
    });
    expect(result.written).toBe(true);
    expect(result.entry?.metadata?.category).toBe('pattern');
  });

  it('rememberProjectFact 应写入 project_fact 类', async () => {
    const { rememberProjectFact, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    const result = await rememberProjectFact(tmpWorkspace, {
      fact: '项目使用 pnpm monorepo',
      category: 'tooling',
    });
    expect(result.written).toBe(true);
    expect(result.entry?.metadata?.category).toBe('project_fact');
  });
});

describe('会话级管理', () => {
  it('getSessionStats 应返回写入计数', async () => {
    const { rememberDecision, getSessionStats, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    expect(getSessionStats().written).toBe(0);
    await rememberDecision(tmpWorkspace, {
      decision: '决策 A',
      rationale: '理由 A',
    });
    await rememberDecision(tmpWorkspace, {
      decision: '决策 B',
      rationale: '理由 B',
    });
    const stats = getSessionStats();
    expect(stats.written).toBe(2);
    expect(stats.remaining).toBe(18); // MAX_SESSION_WRITES = 20
    expect(stats.writtenEntityIds.length).toBe(2);
  }, 60000);

  it('resetSession 应清空计数', async () => {
    const { rememberDecision, getSessionStats, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    await rememberDecision(tmpWorkspace, { decision: '决策', rationale: '理由' });
    expect(getSessionStats().written).toBe(1);
    resetSession();
    expect(getSessionStats().written).toBe(0);
    expect(getSessionStats().writtenEntityIds.length).toBe(0);
  });

  it('单次会话上限 20 条应触发拒绝', async () => {
    const { rememberThis, resetSession, shouldRemember } = await import('./self-memory-updater.js');
    resetSession();
    // 写入 20 条
    for (let i = 0; i < 20; i++) {
      await rememberThis(tmpWorkspace, {
        category: 'project_fact',
        title: `事实 ${i}`,
        content: `这是第 ${i} 条事实内容`,
        entityId: `fact:limit:${i}`,
        importance: 3,
      });
    }
    // 第 21 条应被拒绝
    const result = shouldRemember({
      category: 'project_fact',
      title: '超额事实',
      content: '这是超额的内容',
      entityId: 'fact:over:limit',
      importance: 5,
    });
    expect(result.should).toBe(false);
    expect(result.reason).toContain('上限');
  }, 180000);
});

describe('rememberBatch - 批量写入', () => {
  it('应批量写入多个候选', async () => {
    const { rememberBatch, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    const result = await rememberBatch(tmpWorkspace, [
      {
        category: 'bug_fix',
        title: 'Bug 1',
        content: 'Bug 1 的详细内容描述字符串',
        entityId: 'bug:batch:1',
        importance: 4,
      },
      {
        category: 'decision',
        title: '决策 1',
        content: '决策 1 的详细内容描述字符串',
        entityId: 'decision:batch:1',
        importance: 5,
      },
      {
        category: 'bug_fix',
        title: 'Bug 2',
        content: 'Bug 2 内容',
        entityId: 'bug:batch:2',
        importance: 2, // 低重要性, 应跳过
      },
    ]);
    expect(result.written).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.details.length).toBe(3);
  });
});

describe('emergencyPersist - 紧急持久化', () => {
  it('应成功写入工作日志 (不抛错)', async () => {
    const { emergencyPersist, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    // 应不抛出异常
    await expect(emergencyPersist(tmpWorkspace, [
      {
        category: 'bug_fix',
        title: '紧急 Bug',
        content: '紧急内容',
        entityId: 'bug:emergency:1',
        importance: 5,
      },
    ])).resolves.toBeUndefined();
  });
});
