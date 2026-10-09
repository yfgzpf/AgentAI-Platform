/**
 * AgentAI 工具注册中心
 * ----------------------------------------------------
 * 整合多框架机制:
 *   - tools/registry.py  (统一注册, schema/handler/dispatch)
 *   - parallelSafe 声明 (并发安全)
 *   - Pillar 2 修复     (call storm 防护)
 *
 * 特性:
 *   - **风险等级 + 安全门** (riskLevel: low/medium/high/critical)
 *   - **Skills 索引** (AGENTS.md 提到的 skills/ + 注入到系统提示)
 *   - **chokidar 热加载** (skill_commands)
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md 第 3.1 节
 */
import chokidar from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import { parseToolError, formatStructuredError, isFixSafe } from './error-parser.js';
import { hookCapture } from './hook-capture.js';
import { runWithWorkspace } from './request-scope.js';
/**
 * _CONTEXT_THREAT_PATTERNS: 工具名/参数也要扫
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
    tools = new Map();
    watcher;
    skillsDir;
    /** 拦截器链: 工具执行前按序检查, 返回 string=拒绝, null/undefined=放行 */
    _interceptors = [];
    constructor(skillsDir = path.join(process.env.HOME || '~', '.agentai', 'skills')) {
        super();
        this.skillsDir = skillsDir;
    }
    /**
     * 注册工具
     * tools/registry.py register()  (但加入 parallelSafe + riskLevel)
     */
    register(entry) {
        // 1. 验证工具名不在黑名单
        for (const pattern of TOOL_NAME_BLACKLIST) {
            if (pattern.test(entry.name)) {
                throw new Error(`Tool name "${entry.name}" matches blacklist pattern`);
            }
        }
        // 2. 验证参数 schema 不含危险 key (使用词边界匹配，避免误杀如 "code-executor")
        const paramStr = JSON.stringify(entry.parameters);
        for (const k of PARAM_KEY_BLACKLIST) {
            // 精确匹配键名（JSON 路径格式），而非字符串片段
            const keyRegex = new RegExp('"' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[\\s:]', 'g');
            if (keyRegex.test(paramStr)) {
                throw new Error(`Tool "${entry.name}" parameter has blacklisted key: ${k}`);
            }
        }
        // 3. >10 leaf params 自动 flatten 提示
        const leafCount = this.countLeaves(entry.parameters);
        if (leafCount > 10) {
            console.warn(`[tool-registry] ${entry.name} has ${leafCount} leaf params, consider flattening`);
        }
        // 4. DeepSeek 兼容: 确保 parameters 是有效的 JSON Schema，type 必须是 "object"
        if (!entry.parameters || typeof entry.parameters !== 'object') {
            console.warn(`[tool-registry] ${entry.name} has invalid parameters, fixing to { type: 'object', properties: {} }`);
            entry.parameters = { type: 'object', properties: {} };
        }
        if (entry.parameters.type !== 'object') {
            console.warn(`[tool-registry] ${entry.name} parameters.type is "${entry.parameters.type}", forcing to "object"`);
            entry.parameters.type = 'object';
        }
        if (!entry.parameters.properties) {
            entry.parameters.properties = {};
        }
        this.tools.set(entry.name, entry);
        this.emit('tool:registered', entry);
    }
    unregister(name) {
        this.tools.delete(name);
        this.emit('tool:unregistered', { name });
    }
    get(name) {
        return this.tools.get(name);
    }
    list() {
        return [...this.tools.values()];
    }
    /**
     * 注册拦截器: 工具执行前按序检查
     * 返回 string → 拒绝执行, 该字符串作为拒绝原因返回给 AI
     * 返回 null/undefined → 放行
     */
    addInterceptor(id, fn) {
        this._interceptors.push({ id, fn });
    }
    removeInterceptor(id) {
        this._interceptors = this._interceptors.filter(i => i.id !== id);
    }
    getInterceptors() {
        return this._interceptors;
    }
    /**
     * 转换为 OpenAI/Anthropic 兼容格式 tools 数组
     * 注: 返回内部 ToolSpec 格式 (扁平), llm-router.ts 的 toolSpecsToOpenAI 负责
     * 包装为 { type: 'function', function: {...} } 格式发给 API
     */
    toLLMTools() {
        return this.list().map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        }));
    }
    /**
     * 转换为 Skills 索引 (XML 格式, 学自 ZhiY.AI skills-system.ts)
     * 注入到 system prompt
     */
    toSkillsXML() {
        const skills = this.list();
        // P1-1.4: 精简 XML — 只发名称 + 描述 (节省 ~2000 token, parameters 已在 tools API 中)
        const lines = skills.map(t => {
            const risk = t.riskLevel !== 'low' ? ` [${t.riskLevel}]` : '';
            return `- ${t.name}${risk}: ${this.escapeXml(t.description.slice(0, 100))}`;
        });
        return `# Available Skills\n${lines.join('\n')}`;
    }
    /**
     * parallelSafe + Promise.allSettled 串行屏障
     * 关键: 连续 parallelSafe 调用并发, 遇到非 parallelSafe 串行
     */
    async dispatch(calls, ctx) {
        // ═══ 2026-10-06 P0: 建立请求级工作区作用域（跨请求串扰修复）═══
        // 之前 38 个工具 handler 直接读全局 WorkspaceManager.projectDir，
        // 而 routes/chat.ts:252 会用请求体改写它 → A 请求的工具可能作用在B 的目录上。
        //
        // 这里在 dispatch 入口开一个 ALS 作用域：作用域内任意深度的代码都能读到
        // 本次请求的 workspace，且请求之间天然隔离。
        // 不传 ctx 的 handler（git_* 等 20 个）无需改签名即可受益。
        //
        // 传空 workspace 时 runWithWorkspace 直接透传（保持后台任务零行为变化）。
        return runWithWorkspace(ctx.workspace, () => this.dispatchInternal(calls, ctx), { userId: ctx.userId });
    }
    /** dispatch 的真实实现（由 dispatch 包在请求作用域内调用） */
    async dispatchInternal(calls, ctx) {
        // 1. 验证所有工具已注册
        for (const call of calls) {
            if (!this.tools.has(call.name)) {
                throw new Error(`Unknown tool: ${call.name}`);
            }
        }
        // 2. 检测 call storm
        const stormSignatures = new Map();
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
        const chunks = [];
        let current = [];
        for (const c of calls) {
            const tool = this.tools.get(c.name);
            if (tool.parallelSafe) {
                current.push(c);
            }
            else {
                if (current.length > 0)
                    chunks.push(current);
                chunks.push([c]); // 串行屏障
                current = [];
            }
        }
        if (current.length > 0)
            chunks.push(current);
        // 4. 执行: parallelSafe chunks 并发, 其余顺序
        const results = [];
        for (const chunk of chunks) {
            if (chunk.length === 1) {
                // 串行
                const call = chunk[0];
                const r = await this.executeOne(call, ctx);
                results.push({ id: call.id, result: r });
            }
            else {
                // 并发
                const chunkResults = await Promise.allSettled(chunk.map(c => this.executeOne(c, ctx)));
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
    async executeOne(call, ctx) {
        // 修复问题12: 递归深度限制，防止无限递归
        const currentDepth = ctx.callDepth || 0;
        const maxDepth = ctx.maxDepth || 10; // 默认最大深度10
        if (currentDepth > maxDepth) {
            return {
                success: false,
                output: '',
                error: `Tool call depth limit exceeded (${maxDepth}). Possible infinite recursion detected.`
            };
        }
        // 更新上下文深度
        const newCtx = { ...ctx, callDepth: currentDepth + 1 };
        const tool = this.tools.get(call.name);
        if (!tool) {
            return { success: false, output: '', error: `Unknown tool: ${call.name}` };
        }
        // 修复问题1: 执行时检查参数值，防止黑名单绕过
        const argsStr = JSON.stringify(call.args);
        for (const k of PARAM_KEY_BLACKLIST) {
            const keyRegex = new RegExp('"' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g');
            if (keyRegex.test(argsStr)) {
                return { success: false, output: '', error: `Tool call blocked: dangerous keyword "${k}" in args` };
            }
        }
        // 额外检查：参数值中是否包含危险代码模式
        const dangerousPatterns = [
            /eval\s*\(/i,
            /Function\s*\(/i,
            /child_process/i,
            /require\s*\(\s*['"]fs['"]\s*\)/i,
            /require\s*\(\s*['"]child_process['"]\s*\)/i,
        ];
        for (const pattern of dangerousPatterns) {
            if (pattern.test(argsStr)) {
                return { success: false, output: '', error: `Tool call blocked: dangerous code pattern detected` };
            }
        }
        // ═══ 拦截器链: 按序执行, 任一返回 string 则拒绝 ═══
        // ToolRegistry interceptor chain
        if (this._interceptors.length > 0) {
            for (const interceptor of this._interceptors) {
                try {
                    const reason = await interceptor.fn(call.name, call.args, ctx);
                    if (typeof reason === 'string' && reason.length > 0) {
                        return {
                            success: false,
                            output: reason,
                            error: `[拦截器: ${interceptor.id}] ${reason}`,
                            durationMs: 0,
                            data: { rejectedBy: interceptor.id },
                        };
                    }
                }
                catch (e) {
                    console.warn(`[tool-registry] Interceptor "${interceptor.id}" error:`, e?.message);
                    // 拦截器异常不阻断工具执行, 只记日志
                }
            }
        }
        // Hook: PreToolUse - 执行前检查
        let canProceed = true;
        try {
            // 从上下文获取会话ID（如果在上下文中可用）
            const sessionId = ctx._sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            canProceed = await hookCapture.onPreToolUse(sessionId, call.name, call.args, ctx);
        }
        catch (error) {
            console.warn(`[tool-registry:hook] PreToolUse failed for ${call.name}:`, error);
            canProceed = false;
        }
        if (!canProceed) {
            return {
                success: false,
                output: '[BLOCKED BY HOOK]',
                error: 'Tool call blocked by lifecycle hooks',
                durationMs: 0
            };
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
        let result;
        try {
            result = await tool.handler(call.args, newCtx);
            result.durationMs = Date.now() - t0;
        }
        catch (err) {
            // 2026-06-24: 结构化错误处理
            const structuredError = parseToolError(err, 'tool_execution', call.name, call.args);
            // 检查修复建议是否安全
            if (structuredError.suggestedFix && !isFixSafe(structuredError.suggestedFix)) {
                structuredError.suggestedFix = '修复建议包含危险操作，请人工检查';
                structuredError.riskLevel = 'high';
            }
            result = {
                success: false,
                output: '',
                error: formatStructuredError(structuredError),
                structuredError,
                durationMs: Date.now() - t0,
            };
        }
        // Hook: PostToolUse - 执行后通知
        try {
            const sessionId = ctx._sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await hookCapture.onPostToolUse(sessionId, call.name, call.args, result, ctx);
        }
        catch (error) {
            console.warn(`[tool-registry:hook] PostToolUse failed for ${call.name}:`, error);
        }
        // 【P0-2】工具使用率统计记录
        try {
            const { recordToolCall } = await import('./tool-usage-stats.js');
            recordToolCall(call.name, result.success, result.durationMs || 0);
        }
        catch (_e) {
            // 统计模块异常不影响工具执行
        }
        return result;
    }
    waitForConfirmation(call, ctx, timeoutMs) {
        // 高风险操作审批: 通过 SSE 事件通知前端, 等待用户确认
        // 前端通过 POST /v1/approve/:callId 提交审批结果
        return new Promise((resolve) => {
            // 1. 发出审批请求事件 (前端监听 SSE)
            this.emit('tool:approval_needed', {
                callId: call.id,
                name: call.name,
                args: call.args,
                riskLevel: this.tools.get(call.name)?.riskLevel || 'high',
                summary: `${call.name}: ${JSON.stringify(call.args).slice(0, 200)}`,
            });
            // 2. 注册一次性审批回调
            const approvalKey = `approval:${call.id}`;
            const onApproved = (data) => {
                // ALWAYS remove listener to prevent leak (even if callId doesn't match)
                this.off('tool:approval_result', onApproved);
                if (data.callId === call.id) {
                    clearTimeout(timer);
                    resolve(data.approved);
                }
            };
            this.on('tool:approval_result', onApproved);
            // 3. 超时自动拒绝
            const timer = setTimeout(() => {
                this.off('tool:approval_result', onApproved);
                resolve(false);
            }, timeoutMs);
        });
    }
    // ===== Skills 热加载 =====
    async startWatcher() {
        await fs.mkdir(this.skillsDir, { recursive: true });
        this.watcher = chokidar.watch(this.skillsDir, {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            ignoreInitial: false,
        });
        this.watcher.on('addDir', dir => this.tryLoadSkillDir(dir));
        this.watcher.on('change', file => {
            if (file.endsWith('SKILL.md'))
                this.tryLoadSkillFile(file);
        });
    }
    async tryLoadSkillDir(dir) {
        const skillFile = path.join(dir, 'SKILL.md');
        try {
            await this.tryLoadSkillFile(skillFile);
        }
        catch {
            // 目录还没 SKILL.md, 忽略
        }
    }
    async tryLoadSkillFile(file) {
        const content = await fs.readFile(file, 'utf-8');
        const { meta, body } = this.parseFrontmatter(content);
        if (!meta?.name)
            return;
        // 技能质量验证: 检查 version/dependencies/testCommand
        const warnings = [];
        if (!meta.version) {
            warnings.push('missing version, defaulting to 0.0.0');
        }
        if (!meta.testCommand) {
            warnings.push('no testCommand defined, skill quality unverified');
        }
        if (meta.dependencies) {
            // 验证依赖是否可用
            const deps = Array.isArray(meta.dependencies) ? meta.dependencies : String(meta.dependencies).split(',').map((d) => d.trim());
            for (const dep of deps) {
                try {
                    await import(dep);
                }
                catch {
                    warnings.push(`dependency "${dep}" may not be available`);
                }
            }
        }
        if (warnings.length > 0) {
            console.warn(`[skill] ${meta.name}: ${warnings.join('; ')}`);
        }
        // 动态 require handler
        const handlerPath = path.join(path.dirname(file), 'handler.js');
        let handler;
        try {
            const mod = await import(handlerPath);
            handler = mod.default || mod.handler;
        }
        catch {
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
    parseFrontmatter(content) {
        if (!content.startsWith('---'))
            return { meta: {}, body: content };
        const end = content.indexOf('\n---', 3);
        if (end === -1)
            return { meta: {}, body: content };
        const yaml = content.slice(3, end);
        const body = content.slice(end + 4).trim();
        // 增强解析: 支持简单数组值 ([item1, item2]) 和嵌套字段
        const meta = {};
        for (const line of yaml.split('\n')) {
            const m = line.match(/^(\w+):\s*(.+)$/);
            if (m && m[1] !== undefined && m[2] !== undefined) {
                let val = m[2].replace(/^["']|["']$/g, '');
                // 解析数组值: [item1, item2]
                if (val.startsWith('[') && val.endsWith(']')) {
                    val = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
                }
                // 解析布尔值
                if (val === 'true')
                    val = true;
                else if (val === 'false')
                    val = false;
                // 解析数字
                else if (/^\d+(\.\d+)?$/.test(val))
                    val = parseFloat(val);
                meta[m[1]] = val;
            }
        }
        return { meta, body };
    }
    countLeaves(schema) {
        if (!schema || typeof schema !== 'object')
            return 0;
        if (schema.type !== 'object' || !schema.properties)
            return 1;
        return Object.values(schema.properties).reduce((s, v) => s + (this.countLeaves(v)), 0);
    }
    escapeXml(s) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    async stop() {
        if (this.watcher)
            await this.watcher.close();
    }
}
