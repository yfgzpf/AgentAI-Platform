/**
 * cognitive-frontier.ts — 认知前沿引擎
 * ============================================================
 * 突破性能力探索 — 超越当前 AI 框架的边界
 *
 * 33. 自我编程引擎 — AI 能分析自己的源码并提出改进
 * 34. 认知全景图 — 构建项目的完整心智模型
 * 35. 意图预测引擎 — 预测用户下一步需求
 * 36. 思维链可视化 — 把 AI 的思考过程结构化展示
 * 37. 自适应工具链 — 根据反馈自动优化工具调用顺序
 * 38. 深度因果推理 — 不只分析"是什么"，分析"为什么"
 */
import * as fs from 'fs';
import * as path from 'path';
/**
 * 自我分析 — AI 分析自己的源码
 */
export function analyzeOwnSource(filepath) {
    const issues = [];
    const suggestions = [];
    const optimizations = [];
    let content = '';
    let lineCount = 0;
    try {
        content = fs.readFileSync(filepath, 'utf-8');
        lineCount = content.split('\n').length;
    }
    catch {
        return { file: filepath, issues: [], suggestions: [], complexityScore: 0, optimizations: [] };
    }
    // 检测 1: 函数过长
    const funcRe = /(?:export\s+)?(?:async\s+)?(?:function|class)\s+(\w+)/g;
    let m;
    while ((m = funcRe.exec(content)) !== null) {
        const funcName = m[1];
        const startLine = content.slice(0, m.index).split('\n').length;
        // 找函数结束 (简单: 下一个 export/function/class 或文件尾)
        const rest = content.slice(m.index);
        const endMatch = rest.slice(1).match(/(?:export\s+)?(?:async\s+)?(?:function|class)\s+\w+/);
        const endLine = endMatch ? startLine + rest.slice(1).indexOf(endMatch[0]).toString().split('\n').length : lineCount;
        const funcLines = endLine - startLine;
        if (funcLines > 100) {
            issues.push({ type: 'long_function', severity: 'medium', description: `${funcName} 有 ${funcLines} 行, 超过 100 行建议拆分`, line: startLine });
            suggestions.push({ description: `拆分 ${funcName} 为多个小函数`, impact: '可维护性提升', effort: 'medium' });
        }
    }
    // 检测 2: 重复代码模式
    const lines = content.split('\n');
    const lineMap = {};
    lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.length > 30 && !trimmed.startsWith('//') && !trimmed.startsWith('import')) {
            if (!lineMap[trimmed])
                lineMap[trimmed] = [];
            lineMap[trimmed].push(i + 1);
        }
    });
    for (const [line, occurrences] of Object.entries(lineMap)) {
        if (occurrences.length >= 3) {
            issues.push({ type: 'code_duplication', severity: 'low', description: `重复代码 (${occurrences.length}次): "${line.slice(0, 60)}..."` });
            suggestions.push({ description: '提取为公共函数', impact: '减少重复', effort: 'low' });
        }
    }
    // 检测 3: TODO/FIXME/HACK
    const todos = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi);
    if (todos && todos.length > 0) {
        issues.push({ type: 'technical_debt', severity: 'low', description: `${todos.length} 个 TODO/FIXME/HACK 标记` });
        suggestions.push({ description: '清理技术债务标记', impact: '代码质量', effort: 'low' });
        todos.forEach(() => optimizations.push('解决 TODO/FIXME 标记'));
    }
    // 检测 4: 嵌套深度
    let maxDepth = 0;
    let currentDepth = 0;
    for (const line of lines) {
        const opens = (line.match(/[{(]/g) || []).length;
        const closes = (line.match(/[})]/g) || []).length;
        currentDepth += opens - closes;
        if (currentDepth > maxDepth)
            maxDepth = currentDepth;
    }
    if (maxDepth > 5) {
        issues.push({ type: 'deep_nesting', severity: 'medium', description: `最大嵌套深度 ${maxDepth} 层, 超过 5 层` });
        suggestions.push({ description: '用提前 return 或提取子函数减少嵌套', impact: '可读性', effort: 'medium' });
    }
    // 检测 5: 圈复杂度 (if/for/while 数量)
    const ifCount = (content.match(/\bif\s*\(/g) || []).length;
    const forCount = (content.match(/\bfor\s*\(/g) || []).length;
    const whileCount = (content.match(/\bwhile\s*\(/g) || []).length;
    const complexityScore = ifCount + forCount + whileCount;
    if (complexityScore > 50) {
        issues.push({ type: 'high_complexity', severity: 'high', description: `圈复杂度 ${complexityScore}, 超过 50` });
        suggestions.push({ description: '拆分为多个模块或用策略模式', impact: '可维护性大幅提升', effort: 'high' });
    }
    // 检测 6: 无注释的大文件
    const comments = content.match(/\/\/.*$/gm) || [];
    const commentRatio = lineCount > 0 ? comments.length / lineCount : 0;
    if (lineCount > 200 && commentRatio < 0.05) {
        issues.push({ type: 'low_comments', severity: 'low', description: `注释率 ${(commentRatio * 100).toFixed(1)}%, 低于 5%` });
        suggestions.push({ description: '添加关键函数的注释', impact: '可维护性', effort: 'low' });
    }
    // 检测 7: 性能反模式
    if (content.match(/JSON\.parse\(JSON\.stringify/) && !filepath.includes('test')) {
        issues.push({ type: 'perf_antipattern', severity: 'medium', description: '使用 JSON.parse(JSON.stringify()) 深拷贝, 性能差' });
        suggestions.push({ description: '用 structuredClone 或手动深拷贝', impact: '性能提升', effort: 'low' });
        optimizations.push('替换 JSON.parse(JSON.stringify) 为 structuredClone');
    }
    if (content.match(/\.forEach\(async/)) {
        issues.push({ type: 'perf_antipattern', severity: 'high', description: 'forEach 内使用 async, 不会等待' });
        suggestions.push({ description: '用 for...of 替代 forEach+async', impact: '修复并发 bug', effort: 'low' });
        optimizations.push('修复 forEach+async 为 for...of');
    }
    return { file: filepath, issues, suggestions, complexityScore, optimizations };
}
/**
 * 构建自我分析注入
 */
export function buildSelfAnalysisContext(workspace) {
    // 分析 gateway 核心文件
    const coreFiles = [
        'src/agentai-loop.ts',
        'src/tools.ts',
        'src/routes/chat.ts',
        'src/intelligent-core.ts',
    ];
    const parts = ['[自我编程] AI 源码自检:'];
    let totalIssues = 0;
    for (const relPath of coreFiles) {
        const fullPath = path.join(workspace, relPath);
        if (fs.existsSync(fullPath)) {
            const result = analyzeOwnSource(fullPath);
            if (result.issues.length > 0) {
                parts.push(`  ${path.basename(relPath)}: ${result.issues.length} 个问题 (复杂度${result.complexityScore})`);
                const highIssues = result.issues.filter(i => i.severity === 'high');
                if (highIssues.length > 0) {
                    parts.push(`    ⚠️ ${highIssues.map(i => i.description.slice(0, 50)).join('; ')}`);
                }
                totalIssues += result.issues.length;
            }
        }
    }
    if (totalIssues === 0)
        return '';
    parts.push(`总计: ${totalIssues} 个问题待优化`);
    return parts.join('\n');
}
/**
 * 构建认知全景图 — 让 AI 有"全局视角"
 */
export function buildCognitiveMap(workspace) {
    const coreModules = [];
    const dataFlows = [];
    const decisionPoints = [];
    const riskZones = [];
    const patterns = [];
    // 扫描核心目录
    const coreDirs = ['src', 'src/routes', 'src/meta', 'src/skills', 'src/sandbox'];
    for (const dir of coreDirs) {
        const fullPath = path.join(workspace, dir);
        if (!fs.existsSync(fullPath))
            continue;
        try {
            const entries = fs.readdirSync(fullPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.name.endsWith('.ts') || entry.name.includes('test'))
                    continue;
                const filePath = path.join(fullPath, entry.name);
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n').length;
                // 提取模块职责 (从注释或导出)
                let responsibility = '通用模块';
                const firstComment = content.match(/\/\*\*([\s\S]*?)\*\//);
                if (firstComment) {
                    responsibility = firstComment[1].trim().split('\n')[0].replace(/^\s*\*\s*/, '').slice(0, 60);
                }
                // 提取依赖
                const imports = [];
                const importRe = /import\s+.*from\s+['"]\.\/([^'"]+)['"]/g;
                let m;
                while ((m = importRe.exec(content)) !== null) {
                    imports.push(m[1]);
                }
                coreModules.push({
                    name: `${dir}/${entry.name}`,
                    responsibility,
                    dependencies: imports.slice(0, 5),
                });
                // 风险评估
                if (lines > 1000) {
                    riskZones.push({ area: `${dir}/${entry.name}`, reason: `${lines} 行, 过大`, severity: 'high' });
                }
                else if (lines > 500) {
                    riskZones.push({ area: `${dir}/${entry.name}`, reason: `${lines} 行, 较大`, severity: 'medium' });
                }
            }
        }
        catch { }
    }
    // 检测架构模式
    if (fs.existsSync(path.join(workspace, 'src/routes')))
        patterns.push('路由分层');
    if (fs.existsSync(path.join(workspace, 'src/middleware')))
        patterns.push('中间件链');
    if (fs.existsSync(path.join(workspace, 'src/sandbox')))
        patterns.push('沙箱隔离');
    if (fs.existsSync(path.join(workspace, 'src/meta')))
        patterns.push('元认知');
    if (fs.existsSync(path.join(workspace, 'src/skills')))
        patterns.push('技能系统');
    if (fs.existsSync(path.join(workspace, 'src/diagnosis')))
        patterns.push('诊断引擎');
    return {
        projectType: patterns.length > 3 ? '认知架构系统' : '通用服务',
        coreModules: coreModules.slice(0, 15),
        dataFlows,
        decisionPoints,
        riskZones,
        patterns,
    };
}
/**
 * 注入认知全景图
 */
export function buildCognitiveMapContext(workspace) {
    const map = buildCognitiveMap(workspace);
    const parts = [`[认知全景图] ${map.projectType}`];
    if (map.patterns.length > 0) {
        parts.push(`架构模式: ${map.patterns.join(', ')}`);
    }
    if (map.riskZones.length > 0) {
        const highRisks = map.riskZones.filter(r => r.severity === 'high');
        if (highRisks.length > 0) {
            parts.push(`高风险区域: ${highRisks.map(r => `${r.area}(${r.reason})`).slice(0, 3).join(', ')}`);
        }
    }
    if (map.coreModules.length > 0) {
        parts.push(`核心模块: ${map.coreModules.length} 个 (${map.coreModules.slice(0, 5).map(m => path.basename(m.name)).join(', ')}...)`);
    }
    return parts.length > 1 ? parts.join('\n') : '';
}
/**
 * 预测用户下一步可能的需求
 * 基于当前对话模式和常见工作流
 */
export function predictNextIntent(currentMessage, conversationHistory, filesChanged) {
    const predictions = [];
    const msg = currentMessage.toLowerCase();
    // 模式 1: 用户刚创建了文件 → 可能要测试/运行
    if (filesChanged.length > 0 && msg.match(/创建|生成|新建|写|write/i)) {
        predictions.push({
            predictedIntent: '测试或运行刚创建的代码',
            confidence: 0.7,
            suggestedAction: '准备 run_code 或 build 命令',
            reason: '用户刚创建了文件, 下一步通常是想看效果',
        });
    }
    // 模式 2: 用户修复了 bug → 可能要验证
    if (msg.match(/修复|fix|bug/i)) {
        predictions.push({
            predictedIntent: '验证修复是否生效',
            confidence: 0.8,
            suggestedAction: '准备运行测试或编译检查',
            reason: '修复后通常需要验证',
        });
    }
    // 模式 3: 用户在搜索 → 可能要修改搜到的文件
    if (msg.match(/搜索|查找|找|search/i)) {
        predictions.push({
            predictedIntent: '修改搜到的文件',
            confidence: 0.6,
            suggestedAction: '预备 write_file 或 edit_file',
            reason: '搜索后通常要修改',
        });
    }
    // 模式 4: 用户问了"为什么" → 可能要解决方案
    if (msg.match(/为什么|什么原因|怎么回事/i)) {
        predictions.push({
            predictedIntent: '请求解决方案',
            confidence: 0.65,
            suggestedAction: '准备提供修复建议',
            reason: '问原因后通常要解决方案',
        });
    }
    // 模式 5: 基于历史对话 — 如果之前在做前端, 可能继续前端
    const recentMessages = conversationHistory.slice(-5);
    const frontendMentions = recentMessages.filter(m => m.content.match(/react|组件|css|样式|前端|页面/i)).length;
    if (frontendMentions >= 2 && !msg.match(/后端|server|api/i)) {
        predictions.push({
            predictedIntent: '继续前端开发',
            confidence: 0.55,
            suggestedAction: '预备前端工具链',
            reason: '最近对话集中在前端, 可能继续',
        });
    }
    return predictions.slice(0, 3);
}
/**
 * 注入意图预测
 */
export function buildIntentPredictionContext(currentMessage, conversationHistory, filesChanged) {
    const predictions = predictNextIntent(currentMessage, conversationHistory, filesChanged);
    if (predictions.length === 0)
        return '';
    const parts = ['[意图预测] 用户可能下一步:'];
    for (const p of predictions) {
        parts.push(`  → ${p.predictedIntent} (${(p.confidence * 100).toFixed(0)}%) — ${p.reason}`);
    }
    return parts.join('\n');
}
/**
 * 构建思维链 — 记录 AI 的每一步思考
 */
export class ThoughtChain {
    steps = [];
    currentStepStart = 0;
    add(type, description, result) {
        const step = {
            step: this.steps.length + 1,
            type,
            description,
            result: result?.slice(0, 100),
            duration: Date.now() - this.currentStepStart,
        };
        this.steps.push(step);
        this.currentStepStart = Date.now();
    }
    toMarkdown() {
        if (this.steps.length === 0)
            return '';
        const typeEmoji = {
            understand: '🧠', plan: '📋', search: '🔍',
            execute: '⚡', verify: '✅', reflect: '🤔',
        };
        const lines = this.steps.map(s => `${typeEmoji[s.type] || '•'} ${s.step}. ${s.description}${s.result ? ` → ${s.result}` : ''}`);
        return lines.join('\n');
    }
    clear() {
        this.steps = [];
        this.currentStepStart = Date.now();
    }
}
/**
 * 优化工具调用顺序
 * 原则: 读操作可以并行, 写操作必须串行, 搜索在最前
 */
export function optimizeToolChain(toolCalls) {
    if (toolCalls.length < 3) {
        return { currentChain: toolCalls.map(t => t.name), optimizedChain: toolCalls.map(t => t.name), reason: '工具调用太少, 无需优化', estimatedSavingMs: 0 };
    }
    const currentChain = toolCalls.map(t => t.name);
    // 分类: 读操作 vs 写操作 vs 搜索
    const reads = toolCalls.filter(t => /read|cat|view|list/i.test(t.name));
    const writes = toolCalls.filter(t => /write|edit|str_replace|delete/i.test(t.name));
    const searches = toolCalls.filter(t => /search|grep|find/i.test(t.name));
    const others = toolCalls.filter(t => !reads.includes(t) && !writes.includes(t) && !searches.includes(t));
    // 优化: 搜索 → 并行读 → 串行写 → 其他
    const optimizedChain = [
        ...searches.map(t => t.name),
        ...reads.map(t => t.name),
        ...writes.map(t => t.name),
        ...others.map(t => t.name),
    ];
    // 估算节省: 读操作如果并行, 节省 (N-1) * avgReadTime
    const avgReadTime = reads.length > 0 ? reads.reduce((s, t) => s + t.duration, 0) / reads.length : 0;
    const estimatedSavingMs = reads.length > 1 ? Math.floor(avgReadTime * (reads.length - 1) * 0.7) : 0;
    const reason = reads.length > 1
        ? `${reads.length} 个读操作可以并行, 节省约 ${(estimatedSavingMs / 1000).toFixed(1)}s`
        : '工具顺序已优化: 搜索→读取→写入';
    return { currentChain, optimizedChain, reason, estimatedSavingMs };
}
/**
 * 深度因果推理 — 从现象追溯到根本原因
 */
export function analyzeCausality(phenomenon, context) {
    const causalChain = [phenomenon];
    const prevention = [];
    // 现象 → 直接原因
    let directCause = '未知';
    let rootCause = '未知';
    if (phenomenon.match(/编译失败|compile error|tsc error/i)) {
        directCause = '代码变更引入了类型错误或语法错误';
        causalChain.push(`→ 直接原因: ${directCause}`);
        // 追溯到具体变更
        if (context.filesChanged && context.filesChanged.length > 0) {
            rootCause = `最近的文件变更 (${context.filesChanged.slice(0, 3).join(', ')}) 引入了不一致的类型`;
            causalChain.push(`→ 根本原因: ${rootCause}`);
        }
        // 更深: 为什么会引入不一致?
        rootCause += ' — 可能是修改了接口/类型定义但没同步更新引用方';
        causalChain.push(`→ 深层原因: 修改了类型定义但没有检查所有引用`);
        prevention.push('修改类型定义后运行 tsc 检查');
        prevention.push('使用 analyzeImpact 工具检查影响范围');
    }
    else if (phenomenon.match(/重复输出|重复内容|loop.*same/i)) {
        directCause = 'AI 在任务完成后被触发额外一轮 LLM 调用';
        causalChain.push(`→ 直接原因: ${directCause}`);
        rootCause = 'deferred 指令优先级过高, 触发 extra round';
        causalChain.push(`→ 根本原因: ${rootCause}`);
        causalChain.push(`→ 深层原因: op_awareness 被标记为 high 优先级 + deferred`);
        prevention.push('deferred 指令不应标记为 high 优先级');
        prevention.push('任务完成后不触发 extra round');
    }
    else if (phenomenon.match(/掉线|断连|disconnect|timeout/i)) {
        directCause = 'SSE 连接被关闭或超时';
        causalChain.push(`→ 直接原因: ${directCause}`);
        rootCause = '连接资源泄漏或网络不稳定';
        causalChain.push(`→ 根本原因: ${rootCause}`);
        if (context.errorMsg && context.errorMsg.match(/timed out/i)) {
            causalChain.push(`→ 深层原因: 上游服务超时导致 SSE 无数据, 心跳未能维持`);
        }
        prevention.push('确保 reader.cancel() 在中断时调用');
        prevention.push('SSE 心跳间隔不超过 5 秒');
    }
    else if (phenomenon.match(/AI.*不聪明|重复工作|效率低/i)) {
        directCause = 'AI 缺乏认知引擎, 只能被动响应';
        causalChain.push(`→ 直接原因: ${directCause}`);
        rootCause = '没有认知架构, AI 只有模型能力没有系统智能';
        causalChain.push(`→ 根本原因: ${rootCause}`);
        causalChain.push(`→ 深层原因: 传统 AI 产品设计目标是"好用"而非"会思考"`);
        prevention.push('部署认知引擎系统');
        prevention.push('启用反思+学习+记忆网络');
    }
    return { phenomenon, directCause, rootCause, causalChain, prevention };
}
/**
 * 注入因果分析
 */
export function buildCausalAnalysisContext(phenomenon, context) {
    const analysis = analyzeCausality(phenomenon, context);
    if (analysis.rootCause === '未知')
        return '';
    const parts = ['[深度因果推理]'];
    parts.push(analysis.causalChain.join('\n'));
    if (analysis.prevention.length > 0) {
        parts.push(`预防: ${analysis.prevention.join('; ')}`);
    }
    return parts.join('\n');
}
