import { describe, it, expect } from 'vitest';
import { CORE_BEHAVIOR_RULES, CONTEXT_SCOPE_DISCIPLINE, PROJECT_RED_LINES } from './agent-behavior-rules.js';

describe('CONTEXT_SCOPE_DISCIPLINE — 串味防护指令', () => {
  it('包含五大核心要求的全部关键词', () => {
    // 1. 上下文甄别
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('甄别');
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('相关性');
    // 2. 当前任务优先
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('显式请求');
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('唯一任务目标');
    // 3. 无关信息忽略
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('忽略');
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('不引用');
    // 4. 防漂移
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('漂移');
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('重新对齐');
    // 5. 引用边界
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('引用边界');
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('明确指定');
  });

  it('核心区分句存在且被强调', () => {
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('「我看到了什么」≠「用户要我做什么」');
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('证据');
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('不是**任务**');
  });

  it('IDE 上下文标签有专门的默认处理规则', () => {
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('<ide-context>');
    // 默认处理必须是"仅当用户提到该文件时才用"
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('仅当用户提到该文件时才用');
  });

  it('判定标准可操作（去留测试）', () => {
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('去掉这条上下文');
  });

  it('包含"何时向用户确认"的出口（不是一味忽略）', () => {
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('向用户确认');
    expect(CONTEXT_SCOPE_DISCIPLINE).toContain('默认按**无关**处理');
  });
});

describe('注入位置', () => {
  it('完整版与精简版都必须包含', async () => {
    const { AGENT_SYSTEM_IDENTITY } = await import('./system-prompt.js');
    expect(AGENT_SYSTEM_IDENTITY).toContain('上下文作用域纪律');
    // 完整版用完整规则文本
    expect(AGENT_SYSTEM_IDENTITY).toContain('「我看到了什么」≠「用户要我做什么」');

    const { buildLiteSystemPrompt } = await import('./system-prompt-lite.js');
    const lite = buildLiteSystemPrompt({});
    expect(lite).toContain('上下文作用域纪律');
    expect(lite).toContain('用户的显式请求是唯一任务来源');
  });

  it('项目红线同步提及串味（双重保险）', () => {
    expect(PROJECT_RED_LINES).toContain('无关上下文');
  });

  it('核心行为准则未被破坏（回归）', () => {
    expect(CORE_BEHAVIOR_RULES).toContain('先读后写');
    expect(CORE_BEHAVIOR_RULES).toContain('完成即停');
  });
});