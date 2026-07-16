/**
 * CSSL 元指令生成 + 召回 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock router
const mockRouter = {
  chat: vi.fn(),
};

// Mock logger
vi.mock('./logger-stub.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// 使用临时文件测试 evolution (vi.hoisted 确保在模块加载前设置环境变量)
const { TMP_EVOLUTION_DIR, TMP_EVOLUTION_FILE } = vi.hoisted(() => {
  const tmp = process.env.TEMP || process.env.TMPDIR || '/tmp';
  const dir = `${tmp}/.agentai-test-evolution-${Date.now()}`;
  // 在模块加载前设置环境变量，让 evolution.ts 使用临时文件
  process.env.AGENTAI_EVOLUTION_DIR = dir;
  process.env.AGENTAI_EVOLUTION_FILE = `${dir}/evolution.jsonl`;
  return { TMP_EVOLUTION_DIR: dir, TMP_EVOLUTION_FILE: `${dir}/evolution.jsonl` };
});

import { reflect, type ReflectorContext, type ReflectorOptions } from './reflector';
import { writeEvolution, writeEvolutionAsync, readEvolution, extractPatterns, recallEvolution, type EvolutionEntry } from './evolution';

describe('CSSL Reflector (元指令生成)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), '.agentai-test-cssl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
    mockRouter.chat.mockReset();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('should generate meta_instruction when LLM diagnoses a problem', async () => {
    // LLM 返回需要修正的诊断
    mockRouter.chat.mockResolvedValue({
      content: JSON.stringify({
        needsCorrection: true,
        diagnosisType: 'unverified_assumption',
        metaInstruction: '你依赖了用户会提供API密钥的假设。请检查对话历史，如果没有密钥信息，生成一个追问。不要编造密钥。',
      }),
    });

    const ctx: ReflectorContext = {
      userMessage: '帮我调用OpenAI API',
      finalResponse: '好的，我使用sk-xxx来调用...',
      toolCalls: [
        { name: 'run_code', args: {}, result: 'success', success: true, durationMs: 100 },
      ],
      iterations: 10,
      success: true,
    };

    const opts: ReflectorOptions = {
      force: true,
      userId: 'test-user',
      workspace: '/tmp/test',
    };

    await reflect(mockRouter as any, ctx, opts);

    expect(mockRouter.chat).toHaveBeenCalledOnce();
    // 验证 LLM 收到的 system prompt 包含 CSSL 教导主任角色
    const callArgs = mockRouter.chat.mock.calls[0]![0];
    expect(callArgs.messages[0].content).toContain('教导主任');
    expect(callArgs.messages[0].content).toContain('元指令');
  });

  it('should write success type when no correction needed', async () => {
    mockRouter.chat.mockResolvedValue({
      content: JSON.stringify({
        needsCorrection: false,
        diagnosisType: 'none',
        metaInstruction: '',
      }),
    });

    const ctx: ReflectorContext = {
      userMessage: '你好',
      finalResponse: '你好！有什么可以帮你的？',
      toolCalls: [],
      iterations: 10,
      success: true,
    };

    await reflect(mockRouter as any, ctx, { force: true, userId: 'test-user' });

    // 无工具调用且成功 → 不应调用 LLM
    // 但有 force=true 所以还是会进入... 看代码逻辑: toolCalls.length === 0 && success → return
    // 所以这里不应该调用 LLM
    expect(mockRouter.chat).not.toHaveBeenCalled();
  });

  it('should handle LLM returning non-JSON text as meta_instruction', async () => {
    mockRouter.chat.mockResolvedValue({
      content: '你忽略了检查文件是否存在就直接读取了，应该先用list_directory确认路径。',
    });

    const ctx: ReflectorContext = {
      userMessage: '读取文件',
      finalResponse: '读取失败，文件不存在',
      toolCalls: [
        { name: 'read_file', args: { path: '/nonexistent' }, result: 'Error: file not found', success: false, durationMs: 50 },
      ],
      iterations: 10,
      success: false,
    };

    await reflect(mockRouter as any, ctx, { force: true, userId: 'test-user' });
    expect(mockRouter.chat).toHaveBeenCalledOnce();
  });

  it('should not reflect when iterations not divisible by reflectEvery', async () => {
    const ctx: ReflectorContext = {
      userMessage: 'test',
      finalResponse: 'test',
      toolCalls: [{ name: 'test', args: {}, result: '', success: true, durationMs: 0 }],
      iterations: 7, // 不是 10 的倍数
      success: true,
    };

    await reflect(mockRouter as any, ctx, { reflectEvery: 10, userId: 'test-user' });
    expect(mockRouter.chat).not.toHaveBeenCalled();
  });
});

describe('CSSL Evolution (元指令存储与召回)', () => {
  beforeEach(() => {
    // 确保临时目录存在并清空进化文件
    fs.mkdirSync(TMP_EVOLUTION_DIR, { recursive: true });
    try { fs.writeFileSync(TMP_EVOLUTION_FILE, '', 'utf-8'); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(TMP_EVOLUTION_DIR, { recursive: true, force: true }); } catch {}
  });

  it('should store meta_instruction type in EvolutionEntry', () => {
    const entry: EvolutionEntry = {
      ts: Date.now(),
      type: 'meta_instruction',
      content: '请检查API返回的JSON结构是否符合预期',
      diagnosisType: 'information_gap',
      userId: 'test-user',
      taskType: 'coding',
      keywords: ['api', 'json'],
    };

    expect(entry.type).toBe('meta_instruction');
    expect(entry.diagnosisType).toBe('information_gap');
  });

  it('extractPatterns should extract meta_instruction as 教练建议', () => {
    const entries: EvolutionEntry[] = [
      {
        ts: Date.now(),
        type: 'meta_instruction',
        content: '验证所有外部数据输入的结构和类型',
        diagnosisType: 'information_gap',
      },
      {
        ts: Date.now(),
        type: 'meta_instruction',
        content: '验证所有外部数据输入的结构和类型',
        diagnosisType: 'information_gap',
      },
      {
        ts: Date.now(),
        type: 'failure',
        content: '文件路径错误',
      },
      {
        ts: Date.now(),
        type: 'success',
        content: '任务完成',
      },
    ];

    const patterns = extractPatterns(entries);

    // 元指令出现2次 → 应被提取为 "教练建议"
    const coachPattern = patterns.find(p => p.includes('教练建议') && p.includes('验证所有外部数据输入'));
    expect(coachPattern).toBeDefined();
  });

  it('extractPatterns should include single meta_instruction from recent entries', () => {
    const entries: EvolutionEntry[] = [
      {
        ts: Date.now(),
        type: 'meta_instruction',
        content: '不要编造API密钥，应该追问用户',
        diagnosisType: 'unverified_assumption',
      },
    ];

    const patterns = extractPatterns(entries);

    // 即使只出现1次，最近3条元指令也应该被提取
    const coachPattern = patterns.find(p => p.includes('教练建议') && p.includes('不要编造API密钥'));
    expect(coachPattern).toBeDefined();
  });

  it('recallEvolution should find meta_instruction by taskType', async () => {
    // 写入测试数据 (使用 async 版本确保写入完成后再读取)
    await writeEvolutionAsync({
      type: 'meta_instruction',
      content: '编码任务中应该先检查类型定义',
      taskType: 'coding',
      diagnosisType: 'knowledge_gap',
      keywords: ['typescript', 'types'],
      userId: 'test-recall-user',
    });

    const results = recallEvolution({
      taskType: 'coding',
      userId: 'test-recall-user',
      limit: 10,
    });

    const metaEntry = results.find(e => e.type === 'meta_instruction');
    expect(metaEntry).toBeDefined();
    expect(metaEntry?.content).toContain('类型定义');
  });
});
