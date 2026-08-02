/**
 * automation-tools — AI 可调用的自动化管理工具
 * ----------------------------------------------------
 * AI 通过以下工具主动创建/管理自动化工作流:
 *   - create_cron_job
 *   - list_cron_jobs
 *   - delete_cron_job
 *   - create_automation_rule
 *   - list_automation_rules
 *   - toggle_automation
 *
 * 使用示例 (AI 自动生成):
 *   create_cron_job({ name: "每日代码备份",
 *     expression: "0 2 * * *",
 *     action: "run_command",
 *     params: { command: "git push --all" }
 *   })
 */
import { ToolRegistry, type ToolEntry } from '../tool-registry.js';
import { getAutomationEngine, AutomationEngine, AUTOMATION_PRESETS } from '../automation-engine.js';

type ToolContext = { userId: string; workspace: string };

export function registerAutomationTools(registry: ToolRegistry, workspace: string): void {
  const engine = getAutomationEngine(workspace, registry);

  const tools: ToolEntry[] = [
    // ===== 1. create_cron_job =====
    {
      name: 'create_cron_job',
      description: '创建定时任务 (Cron Job)。AI 自主管理后台定时操作，如每日报告、定期备份、定时检查。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '任务名称，如"每日代码备份"' },
          expression: { type: 'string', description: 'Cron 表达式，如 "0 2 * * *" (每天凌晨2点), "*/30 * * * *" (每30分钟)' },
          action: { type: 'string', description: '要调用的工具名，如 "run_command", "web_search", "run_code"' },
          params: { type: 'object', description: '工具参数，如 { "command": "git push" }', additionalProperties: true },
        },
        required: ['name', 'expression', 'action'],
      },
      handler: async (args: any, _ctx: any) => {
        try {
          const job = engine.createCronJob(args.name, args.expression, args.action, args.params || {});
          return { success: true, output: `✅ 定时任务 "${args.name}" 已创建 (ID: ${job.id})\n表达式: ${args.expression}\n动作: ${args.action}\n状态: 活跃中` };
        } catch (e: any) {
          return { success: false, output: `创建失败: ${e.message}` };
        }
      },
      parallelSafe: false,
      riskLevel: 'medium',
    },

    // ===== 2. list_cron_jobs =====
    {
      name: 'list_cron_jobs',
      description: '列出所有定时任务及运行状态。查看 AI 创建的自动化任务列表。',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_args: any, _ctx: any) => {
        const jobs = engine.listCronJobs();
        if (jobs.length === 0) return { success: true, output: '暂无定时任务。使用 create_cron_job 创建。' };
        const lines = jobs.map(j =>
          `- [${j.status === 'active' ? '🟢' : '⏸'}] ${j.name}\n  ID: ${j.id}\n  表达式: ${j.expression}\n  动作: ${j.action}\n  创建: ${new Date(j.createdAt).toLocaleString()}\n  上次运行: ${j.lastRun ? new Date(j.lastRun).toLocaleString() : '尚未运行'}`
        );
        return { success: true, output: `📋 定时任务 (${jobs.length}):\n\n${lines.join('\n\n')}` };
      },
      parallelSafe: true,
      riskLevel: 'low',
    },

    // ===== 3. delete_cron_job =====
    {
      name: 'delete_cron_job',
      description: '删除指定的定时任务。需提供任务 ID (从 list_cron_jobs 获取)。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '定时任务 ID' },
        },
        required: ['id'],
      },
      handler: async (args: any, _ctx: any) => {
        const ok = engine.deleteCronJob(args.id);
        return ok
          ? { success: true, output: `✅ 定时任务 ${args.id} 已删除` }
          : { success: false, output: `❌ 未找到定时任务: ${args.id}` };
      },
      parallelSafe: false,
      riskLevel: 'medium',
    },

    // ===== 4. create_automation_rule =====
    {
      name: 'create_automation_rule',
      description: '创建自动化规则：当某个条件满足时自动触发操作。如文件变化时自动格式化、Git提交时自动检查等。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '规则名称，如"保存时自动格式化"' },
          description: { type: 'string', description: '规则描述，说明触发条件和执行动作' },
          triggerType: { type: 'string', enum: ['file_change', 'git_commit', 'time_interval', 'system_event'], description: '触发类型: file_change(文件变化) / git_commit(Git提交) / time_interval(定时) / system_event(系统事件)' },
          triggerPattern: { type: 'string', description: '触发模式: file_change 时为 glob 模式如 "src/**/*.ts"; time_interval 时为毫秒间隔如 "3600000"' },
          actionTool: { type: 'string', description: '触发时要调用的工具名' },
          actionParams: { type: 'object', description: '工具参数', additionalProperties: true },
        },
        required: ['name', 'description', 'triggerType', 'actionTool'],
      },
      handler: async (args: any, _ctx: any) => {
        const trigger: any = { type: args.triggerType };
        if (args.triggerType === 'file_change') trigger.pattern = args.triggerPattern || '**/*';
        if (args.triggerType === 'time_interval') trigger.intervalMs = parseInt(args.triggerPattern || '3600000');
        const rule = engine.createRule(args.name, args.description, trigger, {
          tool: args.actionTool,
          params: args.actionParams || {},
        });
        return { success: true, output: `✅ 自动化规则 "${args.name}" 已创建 (ID: ${rule.id})\n触发: ${args.triggerType}\n动作: ${args.actionTool}\n状态: 活跃中` };
      },
      parallelSafe: false,
      riskLevel: 'medium',
    },

    // ===== 5. list_automation_rules =====
    {
      name: 'list_automation_rules',
      description: '列出所有自动化规则及状态。查看 AI 创建的条件触发规则。',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_args: any, _ctx: any) => {
        const rules = engine.listRules();
        if (rules.length === 0) return { success: true, output: '暂无自动化规则。使用 create_automation_rule 创建。' };
        const lines = rules.map(r =>
          `- [${r.status === 'active' ? '🟢' : '⏸'}] ${r.name}\n  ID: ${r.id}\n  描述: ${r.description}\n  触发: ${r.trigger.type}${r.trigger.pattern ? ` (${r.trigger.pattern})` : ''}\n  动作: ${r.action.tool}\n  创建: ${new Date(r.createdAt).toLocaleString()}`
        );
        return { success: true, output: `📋 自动化规则 (${rules.length}):\n\n${lines.join('\n\n')}` };
      },
      parallelSafe: true,
      riskLevel: 'low',
    },

    // ===== 6. toggle_automation =====
    {
      name: 'toggle_automation',
      description: '暂停或恢复指定的定时任务或自动化规则。需提供 ID 和类型。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '任务或规则的 ID' },
          type: { type: 'string', enum: ['cron', 'rule'], description: '类型: cron(定时任务) / rule(自动化规则)' },
          enable: { type: 'boolean', description: 'true=启用, false=暂停' },
        },
        required: ['id', 'type', 'enable'],
      },
      handler: async (args: any, _ctx: any) => {
        if (args.type === 'cron') {
          const job = engine.toggleCronJob(args.id);
          if (!job) return { success: false, output: `❌ 未找到定时任务: ${args.id}` };
          return { success: true, output: `✅ 定时任务 ${job.name} 已${args.enable ? '启用' : '暂停'}` };
        } else if (args.type === 'rule') {
          const rule = engine.toggleRule(args.id);
          if (!rule) return { success: false, output: `❌ 未找到规则: ${args.id}` };
          return { success: true, output: `✅ 规则 ${rule.name} 已${args.enable ? '启用' : '暂停'}` };
        }
        return { success: false, output: '❌ 未知类型' };
      },
      parallelSafe: false,
      riskLevel: 'medium',
    },

    // ===== 7. create_background_task (后台任务) =====
    {
      name: 'create_background_task',
      description: '创建后台常驻任务，AI 会按固定间隔自动执行指定操作。可用于持续监控、定时同步、自动巡检等场景。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '任务名称，如 "持续监控磁盘"' },
          description: { type: 'string', description: '任务描述' },
          prompt: { type: 'string', description: 'AI 自主执行的 prompt 描述，如 "每5分钟检查一次 /tmp 目录大小"' },
          intervalMs: { type: 'number', description: '执行间隔（毫秒），如 300000 = 5分钟' },
        },
        required: ['name', 'prompt', 'intervalMs'],
      },
      handler: async (args: any, _ctx: any) => {
        try {
          const task = engine.createBackgroundTask(args.name, args.description || '', args.prompt, args.intervalMs);
          return { success: true, output: `✅ 后台任务 "${args.name}" 已创建 (ID: ${task.id})\n间隔: ${(args.intervalMs / 1000).toFixed(0)} 秒\n状态: 运行中` };
        } catch (e: any) {
          return { success: false, output: `创建失败: ${e.message}` };
        }
      },
      parallelSafe: false,
      riskLevel: 'medium',
    },

    // ===== 8. list_automation_presets (蒸馏预设) =====
    {
      name: 'list_automation_presets',
      description: '列出所有预置的自动化方案（蒸馏模板）。每个方案都有中文名称和白话说明，用户直接说"我要这个"即可部署。',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['backup', 'cleanup', 'report', 'monitor', 'quality', 'sync', ''], description: '按分类筛选（可选）' },
        },
      },
      handler: async (args: any, _ctx: any) => {
        let presets = AUTOMATION_PRESETS;
        if (args.category) presets = presets.filter(p => p.category === args.category);
        if (presets.length === 0) return { success: true, output: '暂无匹配的预设方案。' };
        const lines = presets.map(p =>
          `- ${p.name}\n  ${p.description}\n  周期: ${p.defaultExpression} | 操作: ${p.defaultAction}\n  指引: ${p.guide}\n  安装: install_automation_preset({ id: "${p.id}" })`
        );
        return { success: true, output: `🎯 自动化预设方案 (${presets.length}):\n\n${lines.join('\n\n')}\n\n💡 说"帮我安装每日备份"或者直接调用 install_automation_preset 即可部署。` };
      },
      parallelSafe: true,
      riskLevel: 'low',
    },

    // ===== 8. install_automation_preset (一键安装预设) =====
    {
      name: 'install_automation_preset',
      description: '一键安装预置的自动化方案。用户只需说"我要每日备份"，AI 调用此工具即可自动部署。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '预设 ID，从 list_automation_presets 获取' },
          params: { type: 'object', description: '可选的自定义参数，覆盖预设默认值。如 { command: "git push origin main" }', additionalProperties: true },
        },
        required: ['id'],
      },
      handler: async (args: any, _ctx: any) => {
        const preset = AUTOMATION_PRESETS.find(p => p.id === args.id);
        if (!preset) return { success: false, output: `❌ 未找到预设 "${args.id}"。用 list_automation_presets 查看所有预设。` };
        const customParams = args.params || {};
        const job = engine.createCronJob(
          preset.name,
          preset.defaultExpression,
          preset.defaultAction,
          { ...preset.defaultParams, ...customParams },
        );
        // 在 description 中注入白话说明
        return {
          success: true,
          output: `✅ 已安装: ${preset.name}\n\n📖 ${preset.description}\n\n⏱ 执行周期: ${preset.defaultExpression}\n🛠 操作: ${preset.defaultAction}\n📌 指引: ${preset.guide}\n\n已自动创建定时任务 (ID: ${job.id})，24 小时内生效。你可以随时在自动化面板中查看和管理。`,
        };
      },
      parallelSafe: false,
      riskLevel: 'medium',
    },
  ];

  for (const t of tools) registry.register(t);
  console.log(`[automation-tools] ✅ 已注册 ${tools.length} 个自动化管理工具 (含蒸馏预设)`);
}
