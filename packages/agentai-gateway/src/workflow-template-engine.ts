/**
 * WorkflowTemplateEngine — 行业工作流模板引擎
 * ==================================================
 * 核心理念: 不硬编码行业逻辑, 用 "模板 + DAG + 变量管道" 驱动任意自动化场景
 *
 * 架构:
 *   WorkflowTemplate (DAG)
 *     └─ WorkflowStep (节点)
 *          ├─ type: rpa | ai_task | notification | condition | extract | transform | delay | http
 *          ├─ dependsOn: [前置步骤ID] (DAG 依赖)
 *          ├─ retryCount + timeout (自愈能力)
 *          └─ config: 类型特定配置 (含 {{variable}} 模板变量)
 *
 * 执行流程:
 *   1. 拓扑排序 DAG
 *   2. 并行执行无依赖的步骤
 *   3. 每步输出 → 注入全局变量池 (下游步骤可引用 {{step_id.output}})
 *   4. 失败 → 重试 N 次 → 仍失败 → 标记整个工作流失败 + 通知
 *   5. 条件步骤 → 决定是否执行下游分支
 *
 * 深度洞察:
 *   - 传统 RPA 是线性的, 真实业务是 DAG (有向无环图)
 *   - 变量在步骤间流转, 形成数据管道 (不是硬编码)
 *   - 模板可导出/导入/分享, 形成行业模板市场
 *   - 自愈: 失败步骤自动重试, 不中断整个流程
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Server as IOServer } from 'socket.io';
import { getRpaRecorder } from './rpa-recorder.js';
import { getNotificationEngine } from './notification-engine.js';

// ===== 类型定义 =====

export type WorkflowStepType =
  | 'rpa'          // 回放 RPA 脚本
  | 'ai_task'      // 发送 AI 消息执行任务
  | 'notification' // 发送通知
  | 'condition'    // 条件判断 (if/else 分支)
  | 'extract'      // 从上一步结果中提取数据
  | 'transform'    // 数据转换 (JSONPath / 模板)
  | 'delay'        // 延时
  | 'http';        // HTTP 请求

export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  defaultValue: any;
  description?: string;
  required?: boolean;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: WorkflowStepType;
  /** DAG 依赖: 此步骤需等这些步骤完成后才执行 */
  dependsOn: string[];
  /** 类型特定配置 */
  config: Record<string, any>;
  /** 失败重试次数 */
  retryCount?: number;
  /** 超时 (毫秒) */
  timeout?: number;
  /** 条件表达式 (condition 类型用, 也用于其他类型的执行前提) */
  condition?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  industry: string;
  description: string;
  variables: WorkflowVariable[];
  steps: WorkflowStep[];
  /** 完成时通知 */
  notifyOnComplete?: boolean;
  /** 失败时通知 */
  notifyOnFailure?: boolean;
  /** 通知渠道 */
  notifyChannel?: string;
  /** 内置模板标记 */
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StepResult {
  stepId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  output?: any;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  retryAttempts?: number;
}

export interface WorkflowExecution {
  id: string;
  templateId: string;
  templateName: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  startedAt: number;
  completedAt?: number;
  variables: Record<string, any>;
  stepResults: Map<string, StepResult>;
  error?: string;
}

// ===== 持久化 =====

const TEMPLATES_FILE = path.join(os.homedir(), '.agentai', 'workflow-templates.json');
const EXECUTIONS_FILE = path.join(os.homedir(), '.agentai', 'workflow-executions.json');
const MAX_EXECUTION_HISTORY = 100;

function ensureDir(): void {
  const dir = path.dirname(TEMPLATES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ===== 内置行业模板 =====

const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  // ─── 装修行业: CAD 解析 → 材料匹配 → 报价单生成 → 通知 ───
  {
    id: 'builtin-decoration-quotation',
    name: '装修报价自动化',
    industry: 'decoration',
    description: '从 CAD 图纸解析房间信息, 匹配材料库, 生成报价单, 推送通知给客户',
    builtin: true,
    variables: [
      { name: 'cad_file_path', type: 'string', defaultValue: '', description: 'CAD 图纸文件路径', required: true },
      { name: 'customer_name', type: 'string', defaultValue: '', description: '客户姓名', required: true },
      { name: 'customer_phone', type: 'string', defaultValue: '', description: '客户手机号' },
      { name: 'material_grade', type: 'string', defaultValue: 'standard', description: '材料档次: economy/standard/premium' },
    ],
    steps: [
      {
        id: 'parse_cad',
        name: '解析 CAD 图纸',
        type: 'ai_task',
        dependsOn: [],
        config: {
          message: '请解析 CAD 图纸文件 {{cad_file_path}}, 提取以下信息: 1.所有房间名称和面积 2.墙面面积 3.地面面积 4.天花板面积 5.门窗位置和尺寸。输出 JSON 格式: {"rooms":[{"name":"客厅","area":25,"wall_area":60,"floor_area":25,"ceiling_area":25}]}',
          output_format: 'json',
        },
        retryCount: 2,
        timeout: 60000,
      },
      {
        id: 'match_materials',
        name: '匹配材料库',
        type: 'ai_task',
        dependsOn: ['parse_cad'],
        config: {
          message: '根据解析的房间信息 {{parse_cad.output}}, 为每个房间匹配 {{material_grade}} 档次的材料。参考标准材料库, 输出 JSON: {"items":[{"room":"客厅","category":"地板","material":"圣象强化地板","unit_price":128,"quantity":25,"total":3200}]}',
          output_format: 'json',
        },
        retryCount: 2,
        timeout: 60000,
      },
      {
        id: 'generate_quote',
        name: '生成报价单',
        type: 'ai_task',
        dependsOn: ['match_materials'],
        config: {
          message: '根据材料匹配结果 {{match_materials.output}}, 生成完整报价单。包含: 1.封面(客户:{{customer_name}} 日期:今天) 2.分项报价表 3.合计金额 4.施工周期 5.保修条款。格式为 Markdown 表格。',
          output_format: 'markdown',
        },
        retryCount: 1,
        timeout: 60000,
      },
      {
        id: 'notify_customer',
        name: '推送报价单通知',
        type: 'notification',
        dependsOn: ['generate_quote'],
        config: {
          title: '装修报价单 - {{customer_name}}',
          body: '{{generate_quote.output}}',
          level: 'info',
          channel: 'sse',
        },
        retryCount: 1,
        timeout: 10000,
      },
    ],
    notifyOnComplete: true,
    notifyOnFailure: true,
    notifyChannel: 'sse',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },

  // ─── 电商监控: 竞品价格抓取 → 比价 → 降价告警 ───
  {
    id: 'builtin-ecommerce-price-monitor',
    name: '竞品价格监控',
    industry: 'ecommerce',
    description: '定时抓取竞品商品页面, 提取价格信息, 与历史价格对比, 降价时自动告警',
    builtin: true,
    variables: [
      { name: 'product_url', type: 'string', defaultValue: '', description: '竞品商品页面 URL', required: true },
      { name: 'product_name', type: 'string', defaultValue: '未知商品', description: '商品名称' },
      { name: 'target_price', type: 'number', defaultValue: 0, description: '目标价格 (低于此价告警)' },
      { name: 'rpa_script_id', type: 'string', defaultValue: '', description: '已录制的商品页面抓取脚本 ID' },
    ],
    steps: [
      {
        id: 'replay_scrape',
        name: '回放抓取脚本',
        type: 'rpa',
        dependsOn: [],
        config: {
          script_id: '{{rpa_script_id}}',
          variables: { url: '{{product_url}}' },
        },
        retryCount: 3,
        timeout: 30000,
      },
      {
        id: 'extract_price',
        name: '提取价格信息',
        type: 'extract',
        dependsOn: ['replay_scrape'],
        config: {
          source: '{{replay_scrape.output}}',
          extract_type: 'regex',
          pattern: '￥(\\d+\\.?\\d*)',
          output_key: 'current_price',
        },
        retryCount: 1,
        timeout: 5000,
      },
      {
        id: 'check_price_drop',
        name: '检查是否低于目标价',
        type: 'condition',
        dependsOn: ['extract_price'],
        config: {
          expression: '{{extract_price.output.current_price}} < {{target_price}}',
          true_branch: 'notify_price_drop',
          false_branch: null,
        },
      },
      {
        id: 'notify_price_drop',
        name: '降价告警',
        type: 'notification',
        dependsOn: ['check_price_drop'],
        condition: '{{check_price_drop.output}} == true',
        config: {
          title: '⚡ 降价告警: {{product_name}}',
          body: '检测到竞品降价!\n\n商品: {{product_name}}\n当前价格: ¥{{extract_price.output.current_price}}\n目标价格: ¥{{target_price}}\n商品链接: {{product_url}}\n\n建议立即跟进调价。',
          level: 'warning',
          channel: 'sse',
        },
        retryCount: 1,
        timeout: 10000,
      },
    ],
    notifyOnComplete: false,
    notifyOnFailure: true,
    notifyChannel: 'sse',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },

  // ─── 网站健康监控: HTTP 探活 → 状态检查 → 异常通知 ───
  {
    id: 'builtin-website-health-check',
    name: '网站健康巡检',
    industry: 'monitoring',
    description: '定时 HTTP 探活, 检查响应码和延迟, 异常时通过 Webhook 推送告警',
    builtin: true,
    variables: [
      { name: 'check_url', type: 'string', defaultValue: '', description: '要监控的 URL', required: true },
      { name: 'site_name', type: 'string', defaultValue: '生产站点', description: '站点名称' },
      { name: 'expected_status', type: 'number', defaultValue: 200, description: '期望 HTTP 状态码' },
      { name: 'max_latency_ms', type: 'number', defaultValue: 3000, description: '最大允许延迟 (毫秒)' },
    ],
    steps: [
      {
        id: 'http_probe',
        name: 'HTTP 探活',
        type: 'http',
        dependsOn: [],
        config: {
          url: '{{check_url}}',
          method: 'GET',
          timeout: 10000,
          extract: { status_code: 'status', latency_ms: 'latency' },
        },
        retryCount: 2,
        timeout: 15000,
      },
      {
        id: 'check_health',
        name: '健康状态判断',
        type: 'condition',
        dependsOn: ['http_probe'],
        config: {
          expression: '{{http_probe.output.status_code}} == {{expected_status}} && {{http_probe.output.latency_ms}} <= {{max_latency_ms}}',
          true_branch: 'notify_healthy',
          false_branch: 'notify_unhealthy',
        },
      },
      {
        id: 'notify_unhealthy',
        name: '异常告警',
        type: 'notification',
        dependsOn: ['check_health'],
        condition: '{{check_health.output}} == false',
        config: {
          title: '🚨 站点异常: {{site_name}}',
          body: '站点健康检查失败!\n\nURL: {{check_url}}\n期望状态码: {{expected_status}}\n实际状态码: {{http_probe.output.status_code}}\n响应延迟: {{http_probe.output.latency_ms}}ms\n阈值: {{max_latency_ms}}ms\n\n请立即检查!',
          level: 'error',
          channel: 'sse',
        },
        retryCount: 1,
        timeout: 10000,
      },
      {
        id: 'notify_healthy',
        name: '正常记录',
        type: 'notification',
        dependsOn: ['check_health'],
        condition: '{{check_health.output}} == true',
        config: {
          title: '✅ 站点正常: {{site_name}}',
          body: '站点健康检查通过\nURL: {{check_url}}\n状态码: {{http_probe.output.status_code}}\n延迟: {{http_probe.output.latency_ms}}ms',
          level: 'success',
          channel: 'sse',
        },
        retryCount: 0,
        timeout: 10000,
      },
    ],
    notifyOnFailure: true,
    notifyChannel: 'sse',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

// ===== 模板引擎 =====

class WorkflowTemplateEngine {
  private templates: Map<string, WorkflowTemplate> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private gatewayUrl: string = 'http://127.0.0.1:18789';
  private io: IOServer | null = null;

  constructor() {
    this._load();
  }

  setGatewayUrl(url: string): void {
    this.gatewayUrl = url;
  }

  init(io: IOServer): void {
    this.io = io;
  }

  /** 推送实时进度到前端 */
  private _emit(event: string, data: any): void {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  // ===== 模板管理 =====

  listTemplates(industry?: string): WorkflowTemplate[] {
    const all = Array.from(this.templates.values());
    return industry ? all.filter(t => t.industry === industry) : all;
  }

  getTemplate(id: string): WorkflowTemplate | null {
    return this.templates.get(id) || null;
  }

  createTemplate(template: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>): WorkflowTemplate {
    const id = `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const full: WorkflowTemplate = {
      ...template,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.templates.set(id, full);
    this._saveTemplates();
    return full;
  }

  updateTemplate(id: string, updates: Partial<WorkflowTemplate>): WorkflowTemplate | null {
    const existing = this.templates.get(id);
    if (!existing || existing.builtin) return null;
    const updated = { ...existing, ...updates, id, updatedAt: Date.now() };
    this.templates.set(id, updated);
    this._saveTemplates();
    return updated;
  }

  deleteTemplate(id: string): boolean {
    const t = this.templates.get(id);
    if (!t || t.builtin) return false;
    this.templates.delete(id);
    this._saveTemplates();
    return true;
  }

  // ===== 执行 =====

  async execute(templateId: string, variables?: Record<string, any>): Promise<WorkflowExecution> {
    const template = this.templates.get(templateId);
    if (!template) throw new Error(`模板不存在: ${templateId}`);

    // 合并变量: 默认值 < 传入值
    const mergedVars: Record<string, any> = {};
    for (const v of template.variables) {
      mergedVars[v.name] = variables?.[v.name] ?? v.defaultValue;
    }

    const execution: WorkflowExecution = {
      id: `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      templateId,
      templateName: template.name,
      status: 'running',
      startedAt: Date.now(),
      variables: mergedVars,
      stepResults: new Map(),
    };

    this.executions.set(execution.id, execution);

    // 推送: 工作流开始
    this._emit('workflow:started', { executionId: execution.id, templateName: template.name, variables: mergedVars, totalSteps: template.steps.length });

    try {
      // 分层并行执行: 按 DAG 层级分组, 同层无依赖步骤并行
      const layers = this._groupByLayers(template.steps);

      for (const layer of layers) {
        // 并行执行同一层的所有步骤
        const results = await Promise.allSettled(
          layer.map(step => this._executeStep(step, execution))
        );

        for (let i = 0; i < layer.length; i++) {
          const step = layer[i];
          if (!step) continue;
          const settle = results[i];
          if (!settle) continue;
          const result: StepResult = settle.status === 'fulfilled'
            ? settle.value
            : { stepId: step.id, status: 'failed' as const, error: (settle as any).reason?.message || '未知错误', completedAt: Date.now() };
          execution.stepResults.set(step.id, result);

          // 推送: 单步完成
          this._emit('workflow:step', { executionId: execution.id, stepId: step.id, stepName: step.name, status: result.status, error: result.error, output: result.output ? JSON.stringify(result.output).slice(0, 500) : undefined });

          if (result.status === 'failed') {
            execution.status = 'partial';
            execution.error = `步骤 "${step.name}" 执行失败: ${result.error}`;
          }
        }

        // 如果整层都失败了 (且不是 skipped), 后续层无意义, 终止
        const layerFailed = layer.every(s => {
          const r = execution.stepResults.get(s.id);
          return r && r.status === 'failed';
        });
        if (layerFailed) {
          execution.status = 'failed';
          break;
        }
      }

      // 判断整体状态
      const failedSteps = Array.from(execution.stepResults.values()).filter(r => r.status === 'failed');
      if (failedSteps.length === 0) {
        execution.status = 'completed';
      } else if (failedSteps.length === execution.stepResults.size) {
        execution.status = 'failed';
      } else {
        execution.status = 'partial';
      }
    } catch (e: any) {
      execution.status = 'failed';
      execution.error = e.message;
    }

    execution.completedAt = Date.now();

    // 推送: 工作流完成
    this._emit('workflow:completed', {
      executionId: execution.id,
      templateName: template.name,
      status: execution.status,
      duration: execution.completedAt - execution.startedAt,
      error: execution.error,
      stepCount: execution.stepResults.size,
      successCount: Array.from(execution.stepResults.values()).filter(r => r.status === 'success').length,
      failedCount: Array.from(execution.stepResults.values()).filter(r => r.status === 'failed').length,
    });

    // 推送统一 execution:result 事件 (ChatView 统一处理)
    this._emit('execution:result', {
      source: 'workflow',
      event: 'done',
      id: execution.id,
      name: template.name,
      success: execution.status === 'completed',
      status: execution.status,
      durationMs: execution.completedAt - execution.startedAt,
      error: execution.error,
    });

    // 发送通知
    if (execution.status === 'completed' && template.notifyOnComplete) {
      await this._sendNotification(template.notifyChannel || 'sse', {
        title: `✅ 工作流完成: ${template.name}`,
        body: `模板 "${template.name}" 已成功完成所有步骤。\n执行ID: ${execution.id}\n耗时: ${((execution.completedAt - execution.startedAt) / 1000).toFixed(1)}s`,
        level: 'success',
      });
    }
    if (execution.status !== 'completed' && template.notifyOnFailure) {
      await this._sendNotification(template.notifyChannel || 'sse', {
        title: `❌ 工作流异常: ${template.name}`,
        body: `模板 "${template.name}" 执行状态: ${execution.status}\n执行ID: ${execution.id}\n错误: ${execution.error || '部分步骤失败'}`,
        level: 'error',
      });
    }

    this._saveExecutions();
    return execution;
  }

  getExecution(executionId: string): WorkflowExecution | null {
    return this.executions.get(executionId) || null;
  }

  listExecutions(templateId?: string, limit = 20): WorkflowExecution[] {
    let all = Array.from(this.executions.values());
    if (templateId) all = all.filter(e => e.templateId === templateId);
    return all.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }

  // ===== 内部: 拓扑排序 =====

  private _topologicalSort(steps: WorkflowStep[]): WorkflowStep[] {
    const visited = new Set<string>();
    const result: WorkflowStep[] = [];
    const stepMap = new Map(steps.map(s => [s.id, s]));

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const step = stepMap.get(id);
      if (!step) return;
      for (const dep of step.dependsOn) {
        visit(dep);
      }
      result.push(step);
    };

    for (const s of steps) visit(s.id);
    return result;
  }

  // ===== 内部: 按 DAG 层级分组 (同层可并行) =====

  private _groupByLayers(steps: WorkflowStep[]): WorkflowStep[][] {
    const stepMap = new Map(steps.map(s => [s.id, s]));
    const layers: WorkflowStep[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(steps.map(s => s.id));

    while (remaining.size > 0) {
      // 找出所有依赖已完成的步骤 → 当前层
      const currentLayer: WorkflowStep[] = [];
      for (const id of remaining) {
        const step = stepMap.get(id)!;
        const depsReady = step.dependsOn.every(dep =>
          completed.has(dep) || !stepMap.has(dep) // 外部依赖视为已满足
        );
        if (depsReady) currentLayer.push(step);
      }

      if (currentLayer.length === 0) {
        // 环检测: 剩余步骤无法执行
        console.warn(`[workflow] 检测到循环依赖, 跳过: ${Array.from(remaining).join(', ')}`);
        break;
      }

      layers.push(currentLayer);
      for (const s of currentLayer) {
        completed.add(s.id);
        remaining.delete(s.id);
      }
    }

    return layers;
  }

  // ===== 内部: 执行单步 =====

  private async _executeStep(step: WorkflowStep, execution: WorkflowExecution): Promise<StepResult> {
    const result: StepResult = {
      stepId: step.id,
      status: 'running',
      startedAt: Date.now(),
      retryAttempts: 0,
    };

    // 检查条件
    if (step.condition) {
      const met = this._evaluateCondition(step.condition, execution);
      if (!met) {
        result.status = 'skipped';
        result.completedAt = Date.now();
        return result;
      }
    }

    const maxRetries = step.retryCount || 0;
    const timeout = step.timeout || 30000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const output = await this._runStepByType(step, execution, timeout);
        result.output = output;
        result.status = 'success';
        result.completedAt = Date.now();

        // 注入到变量池: {{step_id.output}}
        execution.variables[`${step.id}.output`] = output;

        return result;
      } catch (e: any) {
        result.retryAttempts = attempt;
        result.error = e.message;
        if (attempt < maxRetries) {
          console.log(`[workflow] 步骤 "${step.name}" 第 ${attempt + 1} 次失败, 重试中...`);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // 指数退避
        }
      }
    }

    result.status = 'failed';
    result.completedAt = Date.now();
    return result;
  }

  // ===== 内部: 按类型执行 =====

  private async _runStepByType(step: WorkflowStep, execution: WorkflowExecution, timeout: number): Promise<any> {
    const config = this._resolveVariables(step.config, execution.variables);

    switch (step.type) {
      case 'rpa': {
        const recorder = getRpaRecorder();
        const scriptId = config.script_id;
        if (!scriptId) throw new Error('RPA 步骤缺少 script_id');
        const result = await recorder.replay(scriptId, config.variables || {});
        if (!result.success) throw new Error(result.error || 'RPA 回放失败');
        return { steps: result.totalSteps, result: 'replayed' };
      }

      case 'ai_task': {
        const message = this._resolveString(config.message, execution.variables);
        const resp = await fetch(`${this.gatewayUrl}/v1/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, stream: false }),
          signal: AbortSignal.timeout(timeout),
        });
        if (!resp.ok) throw new Error(`AI 任务 HTTP ${resp.status}`);
        const data: any = await resp.json();
        return data.reply || data.output || data;
      }

      case 'notification': {
        const engine = getNotificationEngine();
        const notif = await engine.send({
          title: this._resolveString(config.title, execution.variables),
          body: this._resolveString(config.body, execution.variables),
          level: config.level || 'info',
          channel: config.channel || 'sse',
          target: config.target,
          source: `工作流: ${execution.templateName}`,
        });
        return { notificationId: notif.id, sent: true };
      }

      case 'condition': {
        const met = this._evaluateCondition(config.expression, execution);
        return met;
      }

      case 'extract': {
        const source = this._resolveString(config.source, execution.variables);
        if (config.extract_type === 'regex') {
          const match = new RegExp(config.pattern).exec(source);
          if (!match) return { found: false };
          return { found: true, value: match[0], groups: match.slice(1) };
        }
        if (config.extract_type === 'jsonpath') {
          // 简易 JSONPath: a.b.c
          const parts = config.path.split('.');
          let val: any = source;
          try { val = typeof source === 'string' ? JSON.parse(source) : source; } catch { /* not json */ }
          for (const p of parts) { val = val?.[p]; }
          return { value: val };
        }
        return source;
      }

      case 'transform': {
        // 数据转换: 模板渲染
        return this._resolveString(config.template, execution.variables);
      }

      case 'delay': {
        const ms = config.ms || 1000;
        await new Promise(r => setTimeout(r, ms));
        return { delayed: ms };
      }

      case 'http': {
        const httpStart = Date.now();
        const resp = await fetch(config.url, {
          method: config.method || 'GET',
          headers: config.headers,
          body: config.body ? JSON.stringify(config.body) : undefined,
          signal: AbortSignal.timeout(timeout),
        });
        const latency = Date.now() - httpStart;
        const text = await resp.text();
        return {
          status_code: resp.status,
          latency_ms: latency,
          body: text.slice(0, 2000),
          headers: Object.fromEntries(resp.headers.entries()),
        };
      }

      default:
        throw new Error(`未知步骤类型: ${step.type}`);
    }
  }

  // ===== 内部: 变量解析 =====

  private _resolveString(str: string, vars: Record<string, any>): string {
    if (!str) return '';
    return str.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const trimmed = key.trim();
      // 支持 {{step_id.output.field}} 嵌套
      const parts = trimmed.split('.');
      let val: any = vars[trimmed];
      if (val === undefined) {
        // 尝试逐步解析
        val = vars;
        for (const p of parts) { val = val?.[p]; }
      }
      return val !== undefined ? String(val) : `{{${trimmed}}}`;
    });
  }

  private _resolveVariables(config: Record<string, any>, vars: Record<string, any>): Record<string, any> {
    const resolved: Record<string, any> = {};
    for (const [key, val] of Object.entries(config)) {
      if (typeof val === 'string') {
        resolved[key] = this._resolveString(val, vars);
      } else if (typeof val === 'object' && val !== null) {
        resolved[key] = this._resolveVariables(val, vars);
      } else {
        resolved[key] = val;
      }
    }
    return resolved;
  }

  // ===== 内部: 条件求值 =====

  private _evaluateCondition(expr: string, execution: WorkflowExecution): boolean {
    const resolved = this._resolveString(expr, execution.variables);
    try {
      const cleaned = resolved.replace(/"/g, "'");
      // 支持 || 和 && 组合: 先拆 || (OR), 再拆 && (AND)
      const orParts = cleaned.split('||').map(s => s.trim()).filter(Boolean);
      for (const orPart of orParts) {
        const andParts = orPart.split('&&').map(s => s.trim()).filter(Boolean);
        let allTrue = true;
        for (const part of andParts) {
          if (!this._evalSingleComparison(part)) { allTrue = false; break; }
        }
        if (allTrue) return true; // 任一 OR 分支为 true → 整体 true
      }
      return false;
    } catch {
      return false;
    }
  }

  /** 求值单个比较表达式 (不含 && ||) */
  private _evalSingleComparison(expr: string): boolean {
    const s = expr.trim();
    if (!s) return true;
    // === 优先于 == (避免 == 先匹配到 === 的一半)
    if (s.includes('===')) {
      const [left = '', right = ''] = s.split('===').map(x => x.trim());
      return this._compareValues(left, right);
    }
    if (s.includes('==')) {
      const [left = '', right = ''] = s.split('==').map(x => x.trim());
      return this._compareValues(left, right);
    }
    if (s.includes('!=')) {
      const [left = '', right = ''] = s.split('!=').map(x => x.trim());
      return !this._compareValues(left, right);
    }
    if (s.includes('>=')) {
      const [lStr = '0', rStr = '0'] = s.split('>=').map(x => x.trim());
      return parseFloat(lStr) >= parseFloat(rStr);
    }
    if (s.includes('<=')) {
      const [lStr = '0', rStr = '0'] = s.split('<=').map(x => x.trim());
      return parseFloat(lStr) <= parseFloat(rStr);
    }
    if (s.includes('>')) {
      const [lStr = '0', rStr = '0'] = s.split('>').map(x => x.trim());
      return parseFloat(lStr) > parseFloat(rStr);
    }
    if (s.includes('<')) {
      const [lStr = '0', rStr = '0'] = s.split('<').map(x => x.trim());
      return parseFloat(lStr) < parseFloat(rStr);
    }
    return s === 'true' || s === '1';
  }

  private _compareValues(left: string, right: string): boolean {
    const ln = parseFloat(left);
    const rn = parseFloat(right);
    if (!isNaN(ln) && !isNaN(rn)) return ln === rn;
    return left === right;
  }

  // ===== 内部: 通知 =====

  private async _sendNotification(channel: string, params: { title: string; body: string; level: string }): Promise<void> {
    try {
      const engine = getNotificationEngine();
      await engine.send({ ...params, level: params.level as any, channel: channel as any, source: '工作流引擎' });
    } catch (e) {
      console.error(`[workflow] 通知发送失败:`, e);
    }
  }

  // ===== 导出 / 导入 =====

  /** 导出模板为 JSON 字符串 (可分享) */
  exportTemplate(id: string): string {
    const t = this.templates.get(id);
    if (!t) throw new Error(`模板不存在: ${id}`);
    const exportable = {
      type: 'agentai-workflow-template',
      version: 1,
      exportedAt: Date.now(),
      template: {
        name: t.name,
        industry: t.industry,
        description: t.description,
        variables: t.variables,
        steps: t.steps,
        notifyOnComplete: t.notifyOnComplete,
        notifyOnFailure: t.notifyOnFailure,
        notifyChannel: t.notifyChannel,
      },
    };
    return JSON.stringify(exportable, null, 2);
  }

  /** 从 JSON 字符串导入模板 */
  importTemplate(jsonStr: string): WorkflowTemplate {
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error('无效的 JSON 格式');
    }
    // 兼容两种格式: 直接是 template 对象, 或包装在 {template: ...} 中
    const tmplData = parsed.template || parsed;
    if (!tmplData.name || !tmplData.steps || !Array.isArray(tmplData.steps)) {
      throw new Error('JSON 缺少必要字段: name, steps');
    }
    return this.createTemplate({
      name: tmplData.name,
      industry: tmplData.industry || 'custom',
      description: tmplData.description || '',
      variables: tmplData.variables || [],
      steps: tmplData.steps,
      notifyOnComplete: tmplData.notifyOnComplete ?? false,
      notifyOnFailure: tmplData.notifyOnFailure ?? true,
      notifyChannel: tmplData.notifyChannel || 'sse',
    });
  }

  // ===== 持久化 =====

  private _load(): void {
    // 加载内置模板
    for (const t of BUILTIN_TEMPLATES) {
      this.templates.set(t.id, t);
    }

    // 加载自定义模板
    try {
      ensureDir();
      if (fs.existsSync(TEMPLATES_FILE)) {
        const data = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf-8')) as WorkflowTemplate[];
        for (const t of data) {
          if (!t.builtin) this.templates.set(t.id, t);
        }
        console.log(`[workflow-engine] 加载 ${data.length} 个自定义模板`);
      }
    } catch { /* first run */ }

    // 加载执行历史
    try {
      if (fs.existsSync(EXECUTIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(EXECUTIONS_FILE, 'utf-8'));
        for (const e of data) {
          // 反序列化 stepResults
          const exec: WorkflowExecution = { ...e, stepResults: new Map(Object.entries(e.stepResults || {})) };
          this.executions.set(exec.id, exec);
        }
      }
    } catch { /* first run */ }
  }

  private _saveTemplates(): void {
    try {
      ensureDir();
      const custom = Array.from(this.templates.values()).filter(t => !t.builtin);
      fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(custom, null, 2), 'utf-8');
    } catch (e) {
      console.error('[workflow-engine] 保存模板失败:', e);
    }
  }

  private _saveExecutions(): void {
    try {
      ensureDir();
      // 只保留最近 MAX_EXECUTION_HISTORY 条
      const all = Array.from(this.executions.values()).sort((a, b) => b.startedAt - a.startedAt);
      const toSave = all.slice(0, MAX_EXECUTION_HISTORY);
      // 序列化 stepResults (Map → Object)
      const serializable = toSave.map(e => ({
        ...e,
        stepResults: Object.fromEntries(e.stepResults),
      }));
      fs.writeFileSync(EXECUTIONS_FILE, JSON.stringify(serializable, null, 2), 'utf-8');
    } catch (e) {
      console.error('[workflow-engine] 保存执行历史失败:', e);
    }
  }
}

// ===== 单例 =====

let engineInstance: WorkflowTemplateEngine | null = null;

export function getWorkflowEngine(): WorkflowTemplateEngine {
  if (!engineInstance) {
    engineInstance = new WorkflowTemplateEngine();
  }
  return engineInstance;
}
