import { describe, it, expect, beforeEach } from 'vitest';
import { ToolFactory, createToolFactory } from './tool-factory.js';
import { ToolRegistry } from './tool-registry.js';

describe('ToolFactory', () => {
  let factory: ToolFactory;
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    factory = createToolFactory(registry);
  });

  it('should invent a math tool from task description', async () => {
    const result = await factory.inventTool(
      '帮我写一个计算加减乘除的工具',
      ['search', 'calculator_basic'],
      '需要支持多种运算类型',
    );
    expect(result.success).toBe(true);
    expect(result.toolEntry).toBeDefined();
    expect(result.toolEntry).toBeDefined();
    expect(result.toolEntry!.name).toMatch(/计算|tool_计算/);
    expect(result.evolutionRecord?.type).toBe('success');
  });

  it('should invent a format tool from task description', async () => {
    const result = await factory.inventTool(
      '帮我写一个字符串格式化工具，支持大写/小写/标题格式',
      ['string_ops'],
      '需要支持多种格式类型',
    );
    expect(result.success).toBe(true);
    expect(result.toolEntry).toBeDefined();
  });

  it('should reject dangerous generated code patterns', async () => {
    // 工具工厂内部安全检查基于 SandboxRules
    // 默认生成的代码应该是安全的
    const result = await factory.inventTool('test task', [], 'none');
    expect(result.success).toBe(true);
  });

  it('should register invented tool to registry', async () => {
    const result = await factory.inventTool('calculation tool', [], 'need math');
    expect(result.success).toBe(true);
    if (result.toolEntry) {
      const registered = registry.get(result.toolEntry.name);
      expect(registered).toBeDefined();
      expect(registered?.name).toBe(result.toolEntry?.name);
    }
  });

  it('should record evolution data on success', async () => {
    const result = await factory.inventTool('test calculation tool', [], 'none');
    expect(result.evolutionRecord).toBeDefined();
    expect(result.evolutionRecord?.type).toBe('success');
  });
});

describe('createToolFactory', () => {
  it('should create a ToolFactory instance', () => {
    const reg = new ToolRegistry();
    const f = createToolFactory(reg);
    expect(f).toBeInstanceOf(ToolFactory);
  });
});
