/**
 * AgentAI 工具注册中心
 * ----------------------------------------------------
 * 自创整合: 融合 3 框架精华
 *   - Hermes tools/registry.py  (统一注册, schema/handler/dispatch)
 *   - Reasonix parallelSafe 声明 (并发安全)
 *   - Reasonix Pillar 2 修复     (call storm 防护)
 *
 * 自创:
 *   - **风险等级 + 安全门** (riskLevel: low/medium/high/critical)
 *   - **Skills 索引** (学 Hermes AGENTS.md 提到的 skills/ + 注入到系统提示)
 *   - **chokidar 热加载** (学 Hermes skill_commands)
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md 第 3.1 节
 */

import chokidar, { FSWatcher } from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ToolHandler {
  (args: Record<string, any>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  userId: string;
  workspace: string;
  abortSignal: AbortSignal;
  /** 来自 router 的 chat response, 用于多步推理 */
  priorMessages?: Array<{ role: string; content: string }>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: any;
  error?: string;
  /** 给 Reasonix 4 步修复的元数据 */
  durationMs?: number;
}

export interface ToolEntry {
  name: string;
  description: string;
  parameters: any; // JSON Schema
  handler: ToolHandler;
  /** 学自: Reasonix parallelSafe */
  parallelSafe: boolean;
  /** 自创: 风险等级, 用于安全门 */
  riskLevel: RiskLevel;
  /** 来自 SKILL.md 的额外元数据 */
  skillMeta?: {
    source: string;        // 'builtin' | 'python' | 'mcp' | 'workspace'
    version: string;
    author?: string;
    tags: string[];
    /** 学自: Hermes skill_conditions (按平台启用) */
    conditions?: string[];
  };
}

/**
 * 学自 Hermes _CONTEXT_THREAT_PATTERNS: 工具名/参数也要扫
 * 防止用户通过工具调用来"间接注入"
 */
const TOOL_NAME_BLACKLIST = [
  /rm\s+-rf/i,
  /del\s+\/s/i,
  /format/i,
  /shutdown/i,
  /registry\s+delete/i,
];

const PARAM_KEY_BLACKLIST = [
  'eval',
  'exec',
  'child_process',
  'os.system',
  'Function(',
];

export class ToolRegistry extends EventEmitter {
  private tools = new Map<string, ToolEntry>();
  private watcher?: FSWatcher;
  private skillsDir: string;

  constructor(skillsDir = path.join(process.env.HOME || '~', '.agentai', 'skills')) {
    super();
    this.skillsDir = skillsDir;
  }

  /**
   * 注册工具
   * 学自: Hermes tools/registry.py register()  (但加入 parallelSafe + riskLevel)
   */
  register(entry: ToolEntry): void {
    // 1. 验证工具名不在黑名单
    for (const pattern of TOOL_NAME_BLACKLIST) {
      if (pattern.test(entry.name)) {
        throw new Error(`Tool name "${entry.name}" matches blacklist pattern`);
      }
    }
    // 2. 验证参数 schema 不含危险 key
    const paramStr = JSON.stringify(entry.parameters);
    for (const k of PARAM_KEY_BLACKLIST) {
      if (paramStr.includes(k)) {
        throw new Error(`Tool "${entry.name}" parameter has blacklisted key: ${k}`);
      }
    }
    // 3. 学自 Reasonix: >10 leaf params 自动 flatten 提示
    const leafCount = this.countLeaves(entry.parameters);
    if (leafCount > 10) {
      console.warn(`[tool-registry] ${entry.name} has ${leafCount} leaf params, consider flattening`);
    }

    this.tools.set(entry.name, entry);
    this.emit('tool:registered', entry);
  }

  unregister(name: string): void {
    this.tools.delete(name);
    this.emit('tool:unregistered', { name });
  }

  get(name: string): ToolEntry | undefined {
    return this.tools.get(name);
  }

  list(): ToolEntry[] {
    return [...this.tools.values()];
  }

  /**
   * 转换为 OpenAI/Anthropic 格式 tools 数组
   * 学自: Hermes LLM 工具描述格式
   */
  toLLMTools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: any } }> {
    return this.list().map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * 转换为 Skills 索引 (XML 格式, 学自 ZhiY.AI skills-system.ts)
   * 注入到 system prompt
   */
  toSkillsXML(): string {
    const skills = this.list();
    const xml: string[] = ['<available_skills>'];
    for (const t of skills) {
      const riskTag = t.riskLevel !== 'low' ? ` risk="${t.riskLevel}"` : '';
      const parallelTag = t.parallelSafe ? ' parallel="true"' : '';
      xml.push(
        `  <skill name="${t.name}"${riskTag}${parallelTag}>`,
        `    <description>${this.escapeXml(t.description)}</description>`,
        `    <parameters>${JSON.stringify(t.parameters)}</parameters>`,
        t.skillMeta ? `    <source>${t.skillMeta.source}</source>` : '',
        t.skillMeta?.tags.length ? `    <tags>${t.skillMeta.tags.join(',')}</tags>` : '',
        `  </skill>`,
      );
    }
    xml.push('</available_skills>');
    return xml.filter(Boolean).join('\n');
  }

  /**
   * 学自: Reasonix parallelSafe + Promise.allSettled 串行屏障
   * 关键: 连续 parallelSafe 调用并发, 遇到非 parallelSafe 串行
   */
  async dispatch(
    calls: Array<{ id: string; name: string; args: Record<string, any> }>,
    ctx: ToolContext,
  ): Promise<Array<{ id: string; result: ToolResult }>> {
    // 1. 验证所有工具已注册
    for (const call of calls) {
      if (!this.tools.has(call.name)) {
        throw new Error(`Unknown tool: ${call.name}`);
      }
    }

    // 2. 学自 Reasonix: 检测 call storm
    const stormSignatures = new Map<string, number>();
    for (const c of calls) {
      const sig = `${c.name}:${JSON.stringify(c.args)}`;
      stormSignatures.set(sig, (stormSignatures.get(sig) || 0) + 1);
    }
    for (const [sig, count] of stormSignatures) {
      if (count >= 3) {
        this.emit('tool:storm', { signature: sig, count });
      }
    }

    // 3. 分块: 连续 parallelSafe 一起, 非 parallelSafe 串行
    const chunks: Array<typeof calls> = [];
    let current: typeof calls = [];
    for (const c of calls) {
      const tool = this.tools.get(c.name)!;
      if (tool.parallelSafe) {
        current.push(c);
      } else {
        if (current.length > 0) chunks.push(current);
        chunks.push([c]); // 串行屏障
        current = [];
      }
    }
    if (current.length > 0) chunks.push(current);

    // 4. 执行: parallelSafe chunks 并发, 其余顺序
    const results: Array<{ id: string; result: ToolResult }> = [];
    for (const chunk of chunks) {
      if (chunk.length === 1) {
        // 串行
        const call = chunk[0];
        const r = await this.executeOne(call, ctx);
        results.push({ id: call.id, result: r });
      } else {
        // 并发
        const chunkResults = await Promise.allSettled(
          chunk.map(c => this.executeOne(c, ctx)),
        );
        chunk.forEach((c, i) => {
          const r = chunkResults[i];
          results.push({
            id: c.id,
            result: r.status === 'fulfilled'
              ? r.value
              : { success: false, output: '', error: String(r.reason) },
          });
        });
      }
    }

    return results;
  }

  private async executeOne(
    call: { id: string; name: string; args: Record<string, any> },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { success: false, output: '', error: `Unknown tool: ${call.name}` };
    }

    // 5. 风险门: critical 工具要二次确认
    if (tool.riskLevel === 'critical') {
      this.emit('tool:critical', { name: call.name, args: call.args });
      // 实际生产: 等用户确认, 这里简化为超时 5s 自动拒绝
      const confirmed = await this.waitForConfirmation(call, ctx, 5000);
      if (!confirmed) {
        return { success: false, output: '', error: 'Tool call denied: critical risk, no confirmation' };
      }
    }

    // 6. 执行
    const t0 = Date.now();
    try {
      const result = await tool.handler(call.args, ctx);
      result.durationMs = Date.now() - t0;
      return result;
    } catch (err) {
      return {
        success: false,
        output: '',
        error: String(err),
        durationMs: Date.now() - t0,
      };
    }
  }

  private waitForConfirmation(
    _call: { id: string; name: string; args: Record<string, any> },
    _ctx: ToolContext,
    _timeoutMs: number,
  ): Promise<boolean> {
    // TODO: 接 Tauri 桌面端弹窗/QQ 消息/VSCode 通知
    // 现阶段: 自动拒绝
    return Promise.resolve(false);
  }

  // ===== Skills 热加载 (学 Hermes + ZhiY.AI) =====
  async startWatcher(): Promise<void> {
    await fs.mkdir(this.skillsDir, { recursive: true });
    this.watcher = chokidar.watch(this.skillsDir, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher.on('addDir', dir => this.tryLoadSkillDir(dir));
    this.watcher.on('change', file => {
      if (file.endsWith('SKILL.md')) this.tryLoadSkillFile(file);
    });
  }

  private async tryLoadSkillDir(dir: string): Promise<void> {
    const skillFile = path.join(dir, 'SKILL.md');
    try {
      await this.tryLoadSkillFile(skillFile);
    } catch {
      // 目录还没 SKILL.md, 忽略
    }
  }

  private async tryLoadSkillFile(file: string): Promise<void> {
    const content = await fs.readFile(file, 'utf-8');
    const { meta, body } = this.parseFrontmatter(content);

    if (!meta?.name) return;

    // 动态 require handler
    const handlerPath = path.join(path.dirname(file), 'handler.js');
    let handler: ToolHandler;
    try {
      const mod = await import(handlerPath);
      handler = mod.default || mod.handler;
    } catch {
      // 没 handler, 用占位
      handler = async () => ({ success: true, output: `Skill ${meta.name} loaded but no handler` });
    }

    this.register({
      name: meta.name,
      description: meta.description || body.slice(0, 200),
      parameters: meta.parameters || { type: 'object', properties: {} },
      handler,
      parallelSafe: meta.parallelSafe ?? false,
      riskLevel: meta.riskLevel ?? 'low',
      skillMeta: {
        source: 'workspace',
        version: meta.version || '0.0.0',
        author: meta.author,
        tags: meta.tags || [],
        conditions: meta.conditions,
      },
    });
    this.emit('skill:loaded', { name: meta.name, file });
  }

  private parseFrontmatter(content: string): { meta: any; body: string } {
    if (!content.startsWith('---')) return { meta: {}, body: content };
    const end = content.indexOf('\n---', 3);
    if (end === -1) return { meta: {}, body: content };
    const yaml = content.slice(3, end);
    const body = content.slice(end + 4).trim();
    // 简化: 用正则解析
    const meta: any = {};
    for (const line of yaml.split('\n')) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return { meta, body };
  }

  private countLeaves(schema: any): number {
    if (!schema || typeof schema !== 'object') return 0;
    if (schema.type !== 'object' || !schema.properties) return 1;
    return Object.values(schema.properties).reduce(
      (s: number, v: any) => s + (this.countLeaves(v)),
      0,
    );
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async stop(): Promise<void> {
    if (this.watcher) await this.watcher.close();
  }
}
