/**
 * RPA Recorder — 操作录制与回放引擎
 * ==================================================
 * 核心能力:
 *   1. 录制: 用户在浏览器中操作 → 自动捕获 → 转为可回放步骤序列
 *   2. 回放: 按录制的步骤序列自动执行, 支持变量替换
 *   3. 持久化: 录制的脚本可保存为 JSON, 供后续复用或定时执行
 *   4. 语义转写 (BrowserBC 范式): 录制步骤 → LLM 转写 → 自然语言技能卡 → 语义执行
 *
 * 存储路径: ~/.agentai/rpa-scripts/
 *   - {scriptId}.json — 脚本定义 (元信息 + 步骤列表 + 可选技能卡)
 *
 * 与 BrowserBridge 的关系:
 *   录制: 前端捕获用户操作 → 通过 socket 推送 → rpa-recorder 记录
 *   回放: rpa-recorder 遍历步骤 → 调用 BrowserBridge.execute() → 逐步执行
 *   语义执行: rpa-recorder → BrowserEngine (Playwright) → scanElements → 语义匹配
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getBrowserBridge, type BrowserResult } from './browser-bridge.js';

// ===== 类型定义 =====

export type RpaEventType = 'navigate' | 'click' | 'type' | 'select' | 'submit' | 'scroll' | 'wait' | 'press_key' | 'hover';

export interface RpaStep {
  /** 步骤序号 */
  index: number;
  /** 操作类型 */
  action: RpaEventType;
  /** CSS selector (click/type/select/hover 等需要) */
  selector?: string;
  /** 输入文本 (type 时) */
  text?: string;
  /** 导航 URL (navigate 时) */
  url?: string;
  /** 下拉框值 (select 时) */
  value?: string;
  /** 按键 (press_key 时) */
  key?: string;
  /** 等待时间 (毫秒) */
  waitMs?: number;
  /** 等待的 selector (wait 时) */
  waitForSelector?: string;
  /** 截图标记 (该步骤是否需要截图验证) */
  screenshot?: boolean;
  /** 步骤描述 (AI 可读) */
  description?: string;
}

/** 语义技能卡 (借鉴 BrowserBC: 录制→转写→语义执行) */
export interface SkillCard {
  /** 技能名称 (英文, 如 login_website) */
  skillName: string;
  /** 技能描述 (中文) */
  description: string;
  /** 操作步骤 (自然语言描述, 非CSS selector) */
  steps: string[];
  /** 成功条件 */
  successCondition: string;
  /** 常见错误及处理方式 */
  errorHandling: string[];
  /** 可参数化的变量名列表 */
  variables: string[];
  /** 转写时间 */
  transcribedAt: number;
  /** 转写用的模型 */
  model?: string;
}

export interface RpaScript {
  id: string;
  name: string;
  description: string;
  /** 录制时的起始 URL */
  startUrl: string;
  /** 步骤列表 */
  steps: RpaStep[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 执行次数 */
  runCount: number;
  /** 最后执行时间 */
  lastRunAt?: number;
  /** 最后执行结果 */
  lastResult?: { success: boolean; error?: string; durationMs: number };
  /** 变量定义 (回放时可替换) */
  variables?: Array<{ name: string; defaultValue: string; description?: string }>;
  /** 语义技能卡 (LLM 转写后生成, 可选) */
  skillCard?: SkillCard;
}

export interface RpaReplayResult {
  success: boolean;
  totalSteps: number;
  completedSteps: number;
  failedStep?: number;
  error?: string;
  durationMs: number;
  screenshots?: string[];
}

// ===== 持久化 =====

const SCRIPTS_DIR = path.join(os.homedir(), '.agentai', 'rpa-scripts');

function ensureDir(): void {
  if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  }
}

function scriptFilePath(scriptId: string): string {
  return path.join(SCRIPTS_DIR, `${scriptId}.json`);
}

// ===== 录制状态管理 =====

class RpaRecorder {
  /** 当前录制会话 */
  private currentRecording: { name: string; startUrl: string; steps: RpaStep[]; startTime: number } | null = null;
  /** 已保存的脚本缓存 */
  private scriptCache: Map<string, RpaScript> = new Map();

  constructor() {
    this._loadAllScripts();
  }

  private _loadAllScripts(): void {
    try {
      ensureDir();
      const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const script = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf-8')) as RpaScript;
          this.scriptCache.set(script.id, script);
        } catch { /* skip bad files */ }
      }
    } catch { /* first run */ }
  }

  // ─── 录制控制 ───

  /**
   * 开始录制
   * @param name 脚本名称
   * @param startUrl 起始 URL
   */
  startRecording(name: string, startUrl: string): { success: boolean; message: string } {
    if (this.currentRecording) {
      return { success: false, message: `正在录制中: ${this.currentRecording.name}, 请先停止` };
    }
    this.currentRecording = {
      name: name || `脚本-${Date.now()}`,
      startUrl,
      steps: [],
      startTime: Date.now(),
    };
    return { success: true, message: `录制已开始: ${name}` };
  }

  /**
   * 记录一个操作步骤 (由前端 socket 推送)
   */
  recordStep(step: Omit<RpaStep, 'index'>): { success: boolean; message: string } {
    if (!this.currentRecording) {
      return { success: false, message: '未在录制中' };
    }
    const index = this.currentRecording.steps.length;
    this.currentRecording.steps.push({ index, ...step });
    return { success: true, message: `已记录步骤 ${index + 1}: ${step.action}` };
  }

  /**
   * 停止录制并保存
   */
  stopRecording(description?: string): { success: boolean; script?: RpaScript; message: string } {
    if (!this.currentRecording) {
      return { success: false, message: '未在录制中' };
    }
    const rec = this.currentRecording;
    this.currentRecording = null;

    const script: RpaScript = {
      id: `rpa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: rec.name,
      description: description || `录制于 ${new Date(rec.startTime).toLocaleString()}`,
      startUrl: rec.startUrl,
      steps: rec.steps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
    };

    this._saveScript(script);
    return { success: true, script, message: `录制完成: ${rec.name} (${rec.steps.length} 步)` };
  }

  /**
   * 取消录制 (不保存)
   */
  cancelRecording(): void {
    this.currentRecording = null;
  }

  /**
   * 是否正在录制
   */
  isRecording(): boolean {
    return this.currentRecording !== null;
  }

  /**
   * 获取当前录制状态
   */
  getRecordingStatus(): { recording: boolean; name?: string; stepCount: number; startUrl?: string } {
    if (!this.currentRecording) return { recording: false, stepCount: 0 };
    return {
      recording: true,
      name: this.currentRecording.name,
      stepCount: this.currentRecording.steps.length,
      startUrl: this.currentRecording.startUrl,
    };
  }

  // ─── 脚本管理 ───

  private _saveScript(script: RpaScript): void {
    ensureDir();
    fs.writeFileSync(scriptFilePath(script.id), JSON.stringify(script, null, 2), 'utf-8');
    this.scriptCache.set(script.id, script);
  }

  getScript(id: string): RpaScript | undefined {
    return this.scriptCache.get(id);
  }

  listScripts(): RpaScript[] {
    return Array.from(this.scriptCache.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  deleteScript(id: string): boolean {
    const existed = this.scriptCache.delete(id);
    if (existed) {
      try { fs.unlinkSync(scriptFilePath(id)); } catch { /* best effort */ }
    }
    return existed;
  }

  updateScript(id: string, updates: Partial<Omit<RpaScript, 'id' | 'createdAt'>>): RpaScript | null {
    const existing = this.scriptCache.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id, updatedAt: Date.now() };
    this._saveScript(updated);
    return updated;
  }

  /**
   * 手动创建脚本 (不通过录制, 直接编写步骤)
   */
  createScript(data: { name: string; description?: string; startUrl: string; steps: Omit<RpaStep, 'index'>[]; variables?: RpaScript['variables'] }): RpaScript {
    const script: RpaScript = {
      id: `rpa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: data.name,
      description: data.description || '',
      startUrl: data.startUrl,
      steps: data.steps.map((s, i) => ({ index: i, ...s })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
      variables: data.variables,
    };
    this._saveScript(script);
    return script;
  }

  // ─── 回放执行 ───

  /**
   * 回放脚本
   * @param scriptId 脚本 ID
   * @param variables 变量替换 (可选)
   * @param onProgress 进度回调 (可选)
   */
  async replay(
    scriptId: string,
    variables?: Record<string, string>,
    onProgress?: (step: number, total: number, result: BrowserResult) => void,
  ): Promise<RpaReplayResult> {
    const script = this.scriptCache.get(scriptId);
    if (!script) {
      return { success: false, totalSteps: 0, completedSteps: 0, error: `脚本不存在: ${scriptId}`, durationMs: 0 };
    }

    const bridge = getBrowserBridge();
    if (!bridge.isConnected()) {
      return { success: false, totalSteps: script.steps.length, completedSteps: 0, error: '前端浏览器未连接', durationMs: 0 };
    }

    const startTime = Date.now();
    const screenshots: string[] = [];
    let completed = 0;

    try {
      // 1. 先导航到起始 URL
      const startUrl = this._replaceVariables(script.startUrl, variables);
      await bridge.navigate(startUrl);
      await new Promise(r => setTimeout(r, 2000)); // 等待页面加载

      // 2. 逐步执行
      for (const step of script.steps) {
        const result = await this._executeStep(bridge, step, variables);

        if (step.screenshot && result.success) {
          const ss = await bridge.screenshot();
          if (ss.success && ss.data?.imageBase64) {
            screenshots.push(ss.data.imageBase64);
          }
        }

        if (!result.success) {
          // 更新脚本执行记录
          this._updateRunResult(scriptId, false, Date.now() - startTime, result.error);
          return {
            success: false,
            totalSteps: script.steps.length,
            completedSteps: completed,
            failedStep: step.index,
            error: `步骤 ${step.index + 1} (${step.action}) 失败: ${result.error}`,
            durationMs: Date.now() - startTime,
            screenshots,
          };
        }

        completed++;
        onProgress?.(step.index + 1, script.steps.length, result);

        // 步骤间等待 (默认 500ms, 可被 step.waitMs 覆盖)
        await new Promise(r => setTimeout(r, step.waitMs || 500));
      }

      this._updateRunResult(scriptId, true, Date.now() - startTime);
      return {
        success: true,
        totalSteps: script.steps.length,
        completedSteps: completed,
        durationMs: Date.now() - startTime,
        screenshots,
      };
    } catch (e: any) {
      this._updateRunResult(scriptId, false, Date.now() - startTime, e.message);
      return {
        success: false,
        totalSteps: script.steps.length,
        completedSteps: completed,
        error: e.message,
        durationMs: Date.now() - startTime,
        screenshots,
      };
    }
  }

  /** 执行单个步骤 */
  private async _executeStep(bridge: ReturnType<typeof getBrowserBridge>, step: RpaStep, variables?: Record<string, string>): Promise<BrowserResult> {
    const selector = step.selector ? this._replaceVariables(step.selector, variables) : undefined;
    const text = step.text ? this._replaceVariables(step.text, variables) : undefined;
    const url = step.url ? this._replaceVariables(step.url, variables) : undefined;

    switch (step.action) {
      case 'navigate':
        return bridge.navigate(url || '', 'networkidle');
      case 'click':
        return bridge.click(selector!, step.waitMs || 1000);
      case 'type':
        return bridge.type(selector!, text || '', false);
      case 'select':
        return bridge.select(selector!, step.value || '');
      case 'submit':
        return bridge.submit(selector!);
      case 'scroll':
        return bridge.scroll('down', 3);
      case 'wait':
        return bridge.waitForElement(selector!, step.waitMs || 10000);
      case 'press_key':
        return bridge.pressKey(step.key || 'Enter');
      case 'hover':
        return bridge.hover(selector!);
      default:
        return { id: '', success: false, error: `未知操作: ${step.action}` };
    }
  }

  /** 变量替换: {{varName}} → value */
  private _replaceVariables(text: string, variables?: Record<string, string>): string {
    if (!variables || !text.includes('{{')) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (_, name) => variables[name] || `{{${name}}}`);
  }

  private _updateRunResult(scriptId: string, success: boolean, durationMs: number, error?: string): void {
    const script = this.scriptCache.get(scriptId);
    if (!script) return;
    script.runCount++;
    script.lastRunAt = Date.now();
    script.lastResult = { success, error, durationMs };
    script.updatedAt = Date.now();
    this._saveScript(script);
  }

  // ─── 语义转写 (BrowserBC 范式) ───

  /**
   * 将录制的 RPA 脚本转写为语义技能卡
   * (借鉴 BrowserBC: 录制→LLM 转写→自然语言技能卡)
   *
   * 核心价值:
   *   - 机械回放 (CSS selector) → 页面变了就失效
   *   - 语义技能卡 (自然语言) → 页面变了也能匹配, 跨网站复用
   *
   * @param scriptId 脚本 ID
   * @returns 技能卡, 失败返回 null
   */
  async transcribeToSkill(scriptId: string): Promise<SkillCard | null> {
    const script = this.scriptCache.get(scriptId);
    if (!script || script.steps.length === 0) return null;

    // 构建步骤描述 (从 CSS selector 提取人类可读信息)
    const stepsDescription = script.steps.map((s, i) => {
      const target = s.selector || s.url || s.text || s.key || '';
      const detail = s.description || '';
      return `步骤${i + 1}: ${s.action} ${target} ${detail}`.trim();
    }).join('\n');

    const prompt = `你是一个浏览器操作专家。以下是人类在浏览器中完成任务的录制记录。
请将它转写为一份"操作技能卡"——用自然语言描述这类任务的操作步骤。

录制信息：
- 任务名称: ${script.name}
- 任务描述: ${script.description}
- 起始URL: ${script.startUrl}
- 录制步骤:
${stepsDescription}

请输出 JSON 格式的技能卡:
{
  "skillName": "简短英文名称(如 login_website)",
  "description": "这个技能做什么(中文)",
  "steps": ["步骤1(自然语言描述)", "步骤2", ...],
  "successCondition": "如何判断任务完成",
  "errorHandling": ["常见错误1及处理", "常见错误2及处理"],
  "variables": ["可参数化的变量名"]
}

要求:
1. 步骤用自然语言描述, 不要用 CSS selector
2. 描述要足够详细, 让另一个 AI 能据此在真实页面上操作
3. 包含关键判断条件 (如"如果出现验证码则...")
4. 识别可参数化的变量 (如用户名、密码、搜索关键词)
5. 只输出 JSON, 不要输出其他内容`;

    try {
      // 动态导入 LLM 路由器 (避免循环依赖)
      const { AgentAIRouter } = await import('./llm-router.js');
      const router = new AgentAIRouter();
      const resp = await router.chat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 2000,
      });

      // 从 LLM 回复中提取 JSON
      const jsonMatch = resp.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[rpa-recorder] transcribeToSkill: LLM 未返回有效 JSON');
        return null;
      }

      const card: SkillCard = {
        ...JSON.parse(jsonMatch[0]),
        transcribedAt: Date.now(),
        model: resp.usage ? 'agentai-router' : undefined,
      };

      // 保存技能卡到脚本
      script.skillCard = card;
      script.updatedAt = Date.now();
      this._saveScript(script);

      console.log(`[rpa-recorder] 脚本 "${script.name}" 已转写为技能卡 "${card.skillName}" (${card.steps.length} 步)`);
      return card;
    } catch (e: any) {
      console.error('[rpa-recorder] transcribeToSkill failed:', e.message);
      return null;
    }
  }

  /**
   * 按技能卡语义执行 (非机械回放)
   *
   * 与 replay() 的区别:
   *   replay()      → 逐步执行 CSS selector → 页面变了就失败
   *   executeBySkill() → 读技能卡描述 → scanElements 匹配元素 → 语义操作
   *
   * 使用 BrowserEngine (Playwright) 而非 BrowserBridge (iframe), 获得更强的页面访问能力
   *
   * @param scriptId 脚本 ID (必须已转写技能卡)
   * @param variables 变量替换
   */
  async executeBySkill(
    scriptId: string,
    variables?: Record<string, string>,
  ): Promise<RpaReplayResult> {
    const script = this.scriptCache.get(scriptId);
    if (!script?.skillCard) {
      return { success: false, totalSteps: 0, completedSteps: 0, error: '无技能卡, 请先调用 transcribeToSkill', durationMs: 0 };
    }

    // 动态导入 BrowserEngine (Playwright)
    const { getBrowserEngine } = await import('./browser-engine.js');
    const engine = getBrowserEngine();
    const ok = await engine.start();
    if (!ok) {
      return { success: false, totalSteps: 0, completedSteps: 0, error: 'BrowserEngine 不可用 (Playwright 未安装)', durationMs: 0 };
    }

    const startTime = Date.now();
    const card = script.skillCard;
    const startUrl = this._replaceVariables(script.startUrl, variables);
    let completed = 0;

    try {
      // 1. 导航到起始 URL
      await engine.navigate(startUrl, 'networkidle');
      await new Promise(r => setTimeout(r, 1500));

      // 2. 逐步按技能卡描述执行
      for (let i = 0; i < card.steps.length; i++) {
        const stepDesc = card.steps[i]!;
        const replacedDesc = this._replaceVariables(stepDesc, variables);

        // 扫描页面元素, 语义匹配步骤描述
        const elements = await engine.scanElements();
        const matched = this._matchElementByDescription(replacedDesc, elements);

        if (matched) {
          // 根据步骤描述中的动词判断操作类型
          if (/点击|按下|提交|登录|搜索|click|submit|button/i.test(replacedDesc)) {
            await engine.click(matched.selector);
            completed++;
          } else if (/输入|填写|输入|type|enter|fill/i.test(replacedDesc)) {
            // 从步骤描述或变量中提取要输入的值
            const value = this._extractValueFromStep(replacedDesc, variables);
            if (value) {
              await engine.type(matched.selector, value);
              completed++;
            }
          } else if (/选择|下拉|select|choose/i.test(replacedDesc)) {
            const value = this._extractValueFromStep(replacedDesc, variables);
            if (value) {
              await engine.select(matched.selector, value);
              completed++;
            }
          } else {
            // 默认: 尝试点击
            await engine.click(matched.selector).catch(() => {});
            completed++;
          }
        }

        // 步骤间等待页面响应
        await new Promise(r => setTimeout(r, 1000));
      }

      this._updateRunResult(scriptId, completed > 0, Date.now() - startTime);
      return {
        success: completed > 0,
        totalSteps: card.steps.length,
        completedSteps: completed,
        durationMs: Date.now() - startTime,
      };
    } catch (e: any) {
      this._updateRunResult(scriptId, false, Date.now() - startTime, e.message);
      return {
        success: false,
        totalSteps: card.steps.length,
        completedSteps: completed,
        error: e.message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 根据步骤描述语义匹配页面元素
   * (简单实现: 关键词匹配 + 交互性评分)
   */
  private _matchElementByDescription(desc: string, elements: any[]): any | null {
    if (!elements || elements.length === 0) return null;

    // 提取描述中的关键词 (中文 + 英文)
    const keywords = desc.toLowerCase()
      .replace(/[\u3000-\u303f\uff00-\uffef]/g, ' ') // 全角符号
      .split(/[\s,，。.;;:：]+/)
      .filter(w => w.length > 1);

    // 为每个元素计算匹配分
    let bestMatch: any = null;
    let bestScore = 0;

    for (const el of elements) {
      const elText = `${el.text || ''} ${el.id || ''} ${el.className || ''} ${el.placeholder || ''} ${el.tag || ''}`.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (elText.includes(kw)) score += 1;
      }
      // 加权: 交互性高的元素优先
      score = score * (1 + (el.interactivity || 50) / 200);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = el;
      }
    }

    return bestScore > 0 ? bestMatch : null;
  }

  /**
   * 从步骤描述中提取要输入的值
   * (简单实现: 查找 {{变量}} 或引号内的内容)
   */
  private _extractValueFromStep(desc: string, variables?: Record<string, string>): string | null {
    // 1. 查找 {{变量}}
    const varMatch = desc.match(/\{\{(\w+)\}\}/);
    if (varMatch && variables) {
      const key = varMatch[1];
      return (key && variables[key]) || null;
    }
    // 2. 查找引号内的内容
    const quoted = desc.match(/[""'']([^""'']{1,100})[""'']/);
    if (quoted) return quoted[1] || null;
    // 3. 查找 "输入 X" 模式
    const inputPattern = desc.match(/(?:输入|填写|填入|type|enter)\s+([\w\u4e00-\u9fff]+)/i);
    if (inputPattern) return inputPattern[1] || null;
    return null;
  }
}

// ===== 单例 =====

let _instance: RpaRecorder | null = null;

export function getRpaRecorder(): RpaRecorder {
  if (!_instance) _instance = new RpaRecorder();
  return _instance;
}
