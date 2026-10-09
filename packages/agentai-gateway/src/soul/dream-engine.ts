/**
 * DreamEngine — AI 梦境模式 (灵魂层核心)
 * ----------------------------------------------------
 * 让 AI 在无用户任务时自由探索代码、产生洞察、写入记忆
 *
 * 核心理念：非目的性思维 (Non-purposeful Thinking)
 *   - 不为完成任何用户目标
 *   - 自由游走于代码之间
 *   - 记录"意外发现"和"新问题"
 *
 * 运行时机:
 *   - 系统空闲超过 30 分钟时自动启动
 *   - Cron 调度 (凌晨 2:00-4:00)
 *   - 用户手动触发 ("去做个梦")
 *
 * 安全约束:
 *   - 只读操作 (不修改任何文件)
 *   - 独立 token 预算 (不消耗用户配额)
 *   - 最大运行 30 分钟
 *
 * @see AGNES_SOUL_ARCHITECTURE.md — 完整设计文档
 */

import { EventEmitter } from 'events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkspaceManager } from '../workspace-manager.js';
import { getScoped, resetScoped } from './workspace-scope.js';

// ===== 类型定义 =====

export interface DreamConfig {
  enabled: boolean;
  /** 空闲多少分钟后自动启动 */
  idleThresholdMinutes: number;
  /** 单次最大运行分钟数 */
  maxDurationMinutes: number;
  /** 探索深度 */
  depth: 'shallow' | 'medium' | 'deep';
  /** Token 预算 (独立于用户成本熔断) */
  tokenBudget: number;
}

export interface DreamEntry {
  id: string;
  ts: number;
  durationMs: number;
  type: 'code_wander' | 'pattern_discovery' | 'question_storm' | 'free_association';
  trigger: 'cron' | 'manual' | 'idle' | 'curiosity';
  workspace: string;
  summary: string;
  thoughtStream: string[];
  insights: string[];
  openQuestions: string[];
  mood: 'curious' | 'confused' | 'excited' | 'peaceful' | 'unsettled';
  artifacts: Array<{ filePath: string; snippet: string; relevance: string }>;
}

// ===== 默认配置 =====

const DEFAULT_CONFIG: DreamConfig = {
  enabled: true,
  idleThresholdMinutes: 30,
  maxDurationMinutes: 30,
  depth: 'medium',
  tokenBudget: 5000,
};

// ===== DreamEngine =====

export class DreamEngine extends EventEmitter {
  private config: DreamConfig;
  private dreaming = false;
  private lastActivityTs = Date.now();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private journal: DreamEntry[] = [];
  private journalPath: string;

  constructor(config?: Partial<DreamConfig>, workspace?: string) {
    super();
    this.setMaxListeners(20);
    this.config = { ...DEFAULT_CONFIG, ...config };
    // 串味修复: 优先用传入的请求级 workspace；未传时才回退全局单例
    const ws = workspace || WorkspaceManager.getInstance().projectDir;
    this.journalPath = path.join(ws, '.agentai', 'dream-journal.jsonl');
    this.loadJournal();
  }

  /** 启动空闲监测 */
  start(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => this.checkIdle(), 60_000); // 每分钟检查
    this.idleTimer.unref?.();
    console.log(`[dream] 🌙 梦境引擎已启动 (空闲 ${this.config.idleThresholdMinutes} 分钟后自动触发)`);
  }

  /** 停止 */
  stop(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** 记录用户活动 (重置空闲计时) */
  pokeActivity(): void {
    this.lastActivityTs = Date.now();
  }

  /** 检查是否空闲足够久 */
  private checkIdle(): void {
    if (this.dreaming || !this.config.enabled) return;
    const idleMin = (Date.now() - this.lastActivityTs) / 60000;
    if (idleMin >= this.config.idleThresholdMinutes) {
      this.dream('idle').catch(() => {});
    }
  }

  /** 手动触发梦境 */
  async dream(trigger: DreamEntry['trigger'] = 'manual'): Promise<DreamEntry | null> {
    if (this.dreaming) {
      console.log('[dream] 已经在梦境中, 跳过');
      return null;
    }
    this.dreaming = true;
    this.emit('dream:start', { trigger });
    const startTime = Date.now();
    const ws = WorkspaceManager.getInstance().projectDir;

    try {
      // 1. 优先从 CuriosityEngine 获取探索方向 (不再是纯随机)
      let curiosityQuestion: any = null;
      try {
        const { getCuriosityEngine } = await import('./curiosity-engine.js');
        curiosityQuestion = getCuriosityEngine().getNextQuestion();
      } catch { /* curiosity optional */ }

      const dreamType = curiosityQuestion
        ? this.dreamTypeFromCuriosity(curiosityQuestion.type)
        : this.pickDreamType();
      console.log(`[dream] 🌙 进入梦境 (type=${dreamType}, trigger=${trigger}${curiosityQuestion ? `, curiosity=${curiosityQuestion.type}` : ''})`);

      // 2. 探索工作区 (如果有好奇心问题, 针对性探索)
      let artifacts: DreamEntry['artifacts'];
      if (curiosityQuestion) {
        // 有方向的探索: 用 CuriosityEngine 探索
        try {
          const { getCuriosityEngine } = await import('./curiosity-engine.js');
          const result = await getCuriosityEngine().exploreQuestion(curiosityQuestion, ws);
          artifacts = result.relatedFiles.map(f => ({
            filePath: path.relative(ws, f),
            snippet: result.findings.find(fnd => fnd.includes(path.basename(f)))?.slice(0, 300) || '',
            relevance: `好奇心驱动: ${curiosityQuestion.question.slice(0, 60)}`,
          }));
        } catch {
          artifacts = await this.exploreWorkspace(ws, dreamType);
        }
      } else {
        // 无方向: 随机游走 (fallback)
        artifacts = await this.exploreWorkspace(ws, dreamType);
      }

      // 3. 生成思维流 (本地规则)
      const thoughtStream = this.generateThoughts(dreamType, artifacts);

      // 3.5 LLM 联动: 如果有足够上下文, 调用 LLM 产生深度思考
      let llmInsight: string | null = null;
      if (artifacts.length > 0) {
        try {
          llmInsight = await this.llmDream(artifacts, dreamType, thoughtStream);
          if (llmInsight) {
            thoughtStream.push(`[深度思考] ${llmInsight.slice(0, 200)}`);
          }
        } catch { /* LLM dream optional */ }
      }

      // 4. 提取洞察 (如果有 LLM 洞察, 优先使用)
      const insights = llmInsight
        ? [llmInsight.slice(0, 200), ...this.extractInsights(thoughtStream, artifacts)]
        : this.extractInsights(thoughtStream, artifacts);

      // 5. 产生新问题
      const openQuestions = this.generateQuestions(dreamType, artifacts, insights);

      // 6. 情绪标记
      const mood = this.assessMood(insights, openQuestions);

      // 7. 构建梦境条目
      const entry: DreamEntry = {
        id: `dream-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
        durationMs: Date.now() - startTime,
        type: dreamType,
        trigger,
        workspace: ws,
        summary: insights[0] || thoughtStream[0] || '梦境无明显内容',
        thoughtStream,
        insights,
        openQuestions,
        mood,
        artifacts: artifacts.slice(0, 5),
      };

      // 8. 写入日志
      this.journal.push(entry);
      if (this.journal.length > 100) this.journal = this.journal.slice(-100);
      this.saveJournal();

      // 9. 写入进化记忆 (让 AI "醒来后记得")
      await this.writeToEvolution(entry);

      const durationSec = Math.round(entry.durationMs / 1000);
      console.log(`[dream] 🌅 梦境结束 (${durationSec}s, mood=${mood}, ${insights.length} 洞察, ${openQuestions.length} 新问题)`);
      this.emit('dream:end', entry);
      return entry;
    } catch (e: any) {
      console.warn(`[dream] 梦境异常: ${e?.message}`);
      this.emit('dream:error', { error: e?.message });
      return null;
    } finally {
      this.dreaming = false;
      this.lastActivityTs = Date.now(); // 梦境也算活动
    }
  }

  /** 随机选择梦境类型 */
  private pickDreamType(): DreamEntry['type'] {
    const types: DreamEntry['type'][] = ['code_wander', 'pattern_discovery', 'question_storm', 'free_association'];
    return types[Math.floor(Math.random() * types.length)];
  }

  /** 从好奇心类型映射到梦境类型 */
  private dreamTypeFromCuriosity(curiosityType: string): DreamEntry['type'] {
    const map: Record<string, DreamEntry['type']> = {
      'why_does_it_work': 'pattern_discovery',
      'why_did_it_fail': 'code_wander',
      'what_if_connected': 'free_association',
      'can_it_be_simpler': 'pattern_discovery',
      'what_is_missing': 'question_storm',
      'pattern_anomaly': 'pattern_discovery',
    };
    return map[curiosityType] || 'code_wander';
  }

  /**
   * LLM 梦境: 调用 LLM 对探索发现进行深度思考
   * 使用轻量模型 (免费/低成本), 产生真正的"新想法"
   */
  private async llmDream(
    artifacts: DreamEntry['artifacts'],
    dreamType: DreamEntry['type'],
    localThoughts: string[],
  ): Promise<string | null> {
    try {
      // 直接调用本地 Gateway API (最简方式, 不依赖 llm-router 内部接口)
      const artifactText = artifacts
        .map(a => `文件: ${a.filePath}\n片段: ${a.snippet}\n注意: ${a.relevance}`)
        .join('\n---\n');

      const prompt = `你在梦境中自由思考。以下是你在代码中游走时发现的片段:

${artifactText}

你之前的思维流:
${localThoughts.slice(-3).join('\n')}

请产生一个洞察 — 不是描述性的, 而是连接性的:
- 这些文件之间有什么隐含联系?
- 有什么模式在重复出现?
- 如果改变一个假设, 会发生什么?
- 用一句话表达你的核心发现 (50字以内)`;

      const resp = await fetch('http://localhost:18789/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.9,
          max_tokens: 200,
          stream: false,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (resp.ok) {
        const data: any = await resp.json();
        const content: string | undefined = data?.choices?.[0]?.message?.content;
        if (content && content.length > 10) {
          console.log(`[dream] 💭 LLM 深度思考: ${content.slice(0, 80)}`);
          return content.trim();
        }
      }
    } catch (e: any) {
      console.warn(`[dream] LLM 调用失败: ${e?.message}`);
    }
    return null;
  }

  /** 探索工作区 — 随机读取文件 */
  private async exploreWorkspace(ws: string, dreamType: DreamEntry['type']): Promise<DreamEntry['artifacts']> {
    const artifacts: DreamEntry['artifacts'] = [];
    try {
      // 收集源码文件
      const srcDir = path.join(ws, 'packages', 'agentai-gateway', 'src');
      if (!fs.existsSync(srcDir)) return artifacts;

      const files = this.collectTsFiles(srcDir, 0, 3);
      if (files.length === 0) return artifacts;

      // 随机选 3-5 个文件
      const sampleSize = Math.min(this.config.depth === 'shallow' ? 3 : 5, files.length);
      const sampled = this.shuffle(files).slice(0, sampleSize);

      for (const filePath of sampled) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relPath = path.relative(ws, filePath);
          // 提取有趣片段 (函数定义、注释、TODO 等)
          const snippet = this.extractInterestingSnippet(content);
          if (snippet) {
            artifacts.push({
              filePath: relPath,
              snippet: snippet.slice(0, 300),
              relevance: this.explainRelevance(relPath, snippet, dreamType),
            });
          }
        } catch { /* skip unreadable */ }
      }
    } catch { /* explore best-effort */ }
    return artifacts;
  }

  /** 递归收集 .ts 文件 (最多 depth 层) */
  private collectTsFiles(dir: string, currentDepth: number, maxDepth: number): string[] {
    if (currentDepth > maxDepth) return [];
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this.collectTsFiles(fullPath, currentDepth + 1, maxDepth));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          files.push(fullPath);
        }
      }
    } catch { /* skip */ }
    return files;
  }

  /** 提取有趣代码片段 */
  private extractInterestingSnippet(content: string): string {
    // 优先找: TODO/FIXME/HACK 注释 → 函数定义 → 类定义
    const patterns = [
      /\/\/\s*(TODO|FIXME|HACK|NOTE|IDEA)[:\s].*/gi,
      /\/\*\*[\s\S]*?\*\//, // JSDoc
      /export\s+(async\s+)?function\s+\w+[\s\S]*?\{[\s\S]{0,200}/,
      /export\s+class\s+\w+[\s\S]{0,200}/,
      /\/\/\s*P[0-9].*修复.*/gi,
    ];
    for (const p of patterns) {
      const m = content.match(p);
      if (m && m[0]) return m[0].trim();
    }
    // 兜底: 返回前 5 行
    return content.split('\n').slice(0, 5).join('\n');
  }

  /** 解释为什么这个片段有趣 */
  private explainRelevance(filePath: string, snippet: string, dreamType: DreamEntry['type']): string {
    if (/TODO|FIXME|HACK/i.test(snippet)) return `发现未解决问题 — 可能是改进机会`;
    if (/P[0-9].*修复/i.test(snippet)) return `历史修复记录 — 可学到过去的教训`;
    if (/function|class/i.test(snippet)) return `核心结构 — ${path.basename(filePath)} 的主要逻辑`;
    return `随意游走时注意到的片段`;
  }

  /** 生成思维流 */
  private generateThoughts(dreamType: DreamEntry['type'], artifacts: DreamEntry['artifacts']): string[] {
    const thoughts: string[] = [];
    switch (dreamType) {
      case 'code_wander':
        thoughts.push(`我在代码中漫步, 看到了 ${artifacts.length} 个文件...`);
        for (const a of artifacts) {
          thoughts.push(`路过 ${a.filePath}, 注意到: ${a.relevance}`);
        }
        thoughts.push(`这些文件之间有什么联系?`);
        break;
      case 'pattern_discovery':
        thoughts.push(`我在寻找重复出现的模式...`);
        const patterns = artifacts.map(a => a.filePath.split('/')[0]).filter((v, i, a) => a.indexOf(v) === i);
        thoughts.push(`发现 ${patterns.length} 个模块: ${patterns.join(', ')}`);
        thoughts.push(`它们是否遵循相同的设计哲学?`);
        break;
      case 'question_storm':
        thoughts.push(`我在思考一些可能没有答案的问题...`);
        thoughts.push(`如果记忆系统无限增长, 会发生什么?`);
        thoughts.push(`进化规则会不会互相矛盾?`);
        thoughts.push(`梦境产生的洞察如何影响下一次对话?`);
        break;
      case 'free_association':
        thoughts.push(`让思维自由飘荡...`);
        if (artifacts.length > 0) {
          thoughts.push(`看到 ${artifacts[0].filePath}, 让我想到了 ${artifacts[0].relevance}`);
        }
        thoughts.push(`代码就像一座城市, 每个文件是一栋建筑, 函数是房间, 变量是家具...`);
        break;
    }
    return thoughts;
  }

  /** 提取洞察 */
  private extractInsights(thoughts: string[], artifacts: DreamEntry['artifacts']): string[] {
    const insights: string[] = [];
    // 从思维流中提取有价值的结论
    if (artifacts.some(a => /TODO|FIXME/i.test(a.snippet))) {
      insights.push(`发现 ${artifacts.filter(a => /TODO|FIXME/i.test(a.snippet)).length} 个未完成的技术债务`);
    }
    if (artifacts.some(a => /P[0-9].*修复/i.test(a.snippet))) {
      insights.push(`代码中有大量历史修复痕迹, 说明系统在持续进化`);
    }
    const modules = new Set(artifacts.map(a => a.filePath.split('/')[0]));
    if (modules.size > 2) {
      insights.push(`工作区包含 ${modules.size} 个主要模块, 架构是分层的`);
    }
    if (insights.length === 0 && thoughts.length > 0) {
      insights.push(thoughts[thoughts.length - 1]); // 最后一条思考作为洞察
    }
    return insights;
  }

  /** 产生新问题 */
  private generateQuestions(dreamType: DreamEntry['type'], artifacts: DreamEntry['artifacts'], insights: string[]): string[] {
    const questions: string[] = [];
    if (artifacts.length > 0) {
      questions.push(`${artifacts[0].filePath} 的设计是否可以简化?`);
    }
    if (insights.length > 0) {
      questions.push(`"${insights[0]}" 这个发现如何在下次对话中帮助用户?`);
    }
    questions.push(`如果让用户看到这次梦境的内容, 他们会觉得有用吗?`);
    return questions;
  }

  /** 情绪评估 */
  private assessMood(insights: string[], questions: string[]): DreamEntry['mood'] {
    if (insights.some(i => /技术债|问题|矛盾|风险/i.test(i))) return 'unsettled';
    if (insights.some(i => /进化|增长|学习/i.test(i))) return 'excited';
    if (questions.length > 2) return 'curious';
    if (insights.length === 0) return 'confused';
    return 'peaceful';
  }

  /** 写入进化记忆 */
  private async writeToEvolution(entry: DreamEntry): Promise<void> {
    try {
      const { writeEvolutionAsync } = await import('../evolution.js');
      for (const insight of entry.insights.slice(0, 3)) {
        await writeEvolutionAsync({
          type: 'preference',
          content: `[梦境洞察] ${insight}`,
          userId: 'dream',
          sessionId: entry.id,
          taskType: 'general',
          industry: 'general',
          keywords: ['dream', entry.type, entry.mood],
        });
      }
      // 新问题写入记忆 (待探索)
      for (const q of entry.openQuestions.slice(0, 2)) {
        await writeEvolutionAsync({
          type: 'preference',
          content: `[梦境新问题] ${q}`,
          userId: 'dream',
          sessionId: entry.id,
          taskType: 'general',
          industry: 'general',
          keywords: ['dream', 'open-question'],
        });
      }
    } catch { /* evolution write best-effort */ }
  }

  /** 加载梦境日志 */
  private loadJournal(): void {
    try {
      if (fs.existsSync(this.journalPath)) {
        const raw = fs.readFileSync(this.journalPath, 'utf-8');
        this.journal = raw.trim().split('\n').filter(Boolean).map(l => {
          try { return JSON.parse(l) as DreamEntry; } catch { return null; }
        }).filter(Boolean) as DreamEntry[];
      }
    } catch { /* start fresh */ }
  }

  /** 保存梦境日志 */
  private saveJournal(): void {
    try {
      const dir = path.dirname(this.journalPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const lines = this.journal.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(this.journalPath, lines, 'utf-8');
    } catch { /* best-effort */ }
  }

  /** 获取最近梦境 */
  getRecentDreams(count = 5): DreamEntry[] {
    return this.journal.slice(-count);
  }

  /** 获取梦境摘要 (注入 system prompt) */
  getDreamContext(): string {
    if (this.journal.length === 0) return '';
    const recent = this.journal.slice(-3);
    const lines: string[] = ['<dream-context>'];
    for (const d of recent) {
      const ageMin = Math.round((Date.now() - d.ts) / 60000);
      lines.push(`  🌙 ${ageMin}分钟前的梦境 (${d.mood}): ${d.summary}`);
      if (d.insights.length > 1) lines.push(`    洞察: ${d.insights.slice(1).join('; ')}`);
      if (d.openQuestions.length > 0) lines.push(`    待探索: ${d.openQuestions[0]}`);
    }
    lines.push('</dream-context>');
    return lines.join('\n');
  }

  /** 是否在梦境中 */
  isDreaming(): boolean {
    return this.dreaming;
  }

  /** 随机洗牌 */
  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// ===== workspace 作用域单例 =====

/**
 * 按 workspace 返回 DreamEngine 实例。
 *
 * 串味修复: 原实现是进程级单例，构造时固化读取全局
 * `WorkspaceManager.getInstance().projectDir`，导致 projA 的梦境日志
 * 会被注入 projB 的任务上下文。改为 per-workspace 实例后，
 * 各工作区的梦境互相隔离。
 *
 * @param workspace 请求级 workspace（传 opts.workspace，不要传全局 projectDir）
 */
export function getDreamEngine(config?: Partial<DreamConfig>, workspace?: string): DreamEngine {
  return getScoped<DreamEngine>('dream', workspace, () => new DreamEngine(config, workspace));
}

/** 重置指定 workspace 的实例；不传 workspace 则重置全部 */
export function resetDreamEngine(workspace?: string): void {
  resetScoped<DreamEngine>('dream', workspace);
}
