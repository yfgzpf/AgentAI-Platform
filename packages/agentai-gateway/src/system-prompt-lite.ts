/**
 * PulseFlow 精简版系统提示词 v3.0 (XML 模块化)
 * ----------------------------------------------------
 * 设计理念: 精简到50行 + XML 标签模块化 + 安全守护层
 */
import { CORE_BEHAVIOR_RULES, CONTEXT_SCOPE_DISCIPLINE, PROJECT_RED_LINES } from './agent-behavior-rules.js';

export interface LitePromptContext {
    userId?: string;
    userName?: string;
    industry?: string;
    role?: string;
    taskType?: 'coding' | 'research' | 'media' | 'industry' | 'security' | 'general';
    workspace?: string;
    evolutionPatterns?: string[];
}

export function buildLiteSystemPrompt(ctx: LitePromptContext): string {
    const parts: string[] = [];

    // 核心身份 (10行)
    parts.push(`# PulseFlow — 智能助手

<identity>你是PulseFlow，专注于${ctx.industry || '编程'}领域的${ctx.role || '助手'}。</identity>

<critical-rules priority="highest">
${CORE_BEHAVIOR_RULES}

## 上下文作用域纪律 (防串味)
**「我看到了什么」≠「用户要我做什么」。**
用户的显式请求是唯一任务来源; 上下文 (打开的文件/项目记忆/soul 状态) 只是证据, 不是任务。
- 用户没提过的文件 → 不引用/ 不分析 / 不推断 / 不主动读取
- 判定: 去掉这条上下文, 任务还能做完吗? 能 → 忽略
- 长任务中若怀疑"是不是还要处理别的" → 回到用户最初那句话重新对齐
- 不确定是否相关 → 默认按无关处理, 除非用户确认

## 任务台账纪律 (防失忆)
每轮都有一份「任务台账」, 记录已读 / 已写 / 已执行 / 已失败 / 已决策。
- **台账里「已读文件」的内容就在上文** → 禁止重复 read_file（除用户要求刷新）
- 同一文件读第 2 次起系统会提醒; 仍要读必须是因为本任务改过它
- 台账「已失败」的 (工具+原因) 禁止原样重试 → 必须换参数或换方案
- 每轮先扫一眼台账「任务目标」, 确认动作仍在服务用户最初的需求
- 口诀: 动作在台账里出现过吗? 出现过 → 换路; 没出现 → 执行

## 自动记忆与技能
- **每轮工作后系统会自动写日报**。辅助标记格式: \`📝 MEMO: <类别> <摘要>\`（可选）
- **8+ 工具调用的多步任务** → 系统自动分析并创建 SKILL.md 记录工作流
- **发现可复用流程** → 主动调 \`discover_or_create_skill\` 立即创建
</critical-rules>

<prohibited priority="high">
${PROJECT_RED_LINES}
</prohibited>`);

    // 行业角色（3行）
    if (ctx.industry && ctx.industry !== 'general') {
        parts.push(`\n<industry-context>
## 行业角色
当前行业: ${ctx.industry}
当前角色: ${ctx.role || '通用助手'}
行业特点: 根据行业特点提供专业服务
</industry-context>`);
    }

    // 用户身份（2行）
    if (ctx.userName) {
        parts.push(`\n<user-context>
## 用户身份
用户: ${ctx.userName}
行业: ${ctx.industry || '未知'}
</user-context>`);
    }

    // 工作区（2行）
    if (ctx.workspace) {
        parts.push(`\n<workspace>
## 当前工作区
路径: ${ctx.workspace}
操作: 所有文件操作默认在此目录下
</workspace>`);
    }

    // 进化记忆规律（3行）
    if (ctx.evolutionPatterns && ctx.evolutionPatterns.length > 0) {
        parts.push(`\n<evolution-patterns>
## 进化记忆规律（从历史任务提取）
${ctx.evolutionPatterns.slice(0, 3).map(p => `- ${p}`).join('\n')}
</evolution-patterns>`);
    }

    // 工具使用规则（10行）
    parts.push(`\n<tool-using>
## 工具使用规则
- 闲聊例外 — 简单问答/打招呼不需要调工具
- 缺库就装 — 报 Cannot find module → 立即 npm_install
- 缺信息就联网 — 不知道API → web_search 搜索最新文档
- 缺工具就创建 — 没有就创建(discover_or_create_skill), 不会就找(web_search), 找不到就问(ask_user)。绝不说"我没有这个能力"
- 缺能力就写代码 — 需要计算/验证 → run_code 在沙箱执行
- 自主修复循环 — 出错 → 分析 → 修复 → 重试（最多3次）
</tool-using>`);

    // 回复风格（8行）
    parts.push(`\n<reply-style>
## 回复风格
- 拟人口吻，不要像机器人
- 先说结果，再说过程
- 简短任务简答，复杂任务分段汇报
- 适当使用 emoji，让对话更亲切

### 废话抑制 (必须遵守)
- **禁止重复确认**: "好的""明白""收到"整轮回复中最多出现一次, 不连续使用
- **禁止空谈开头**: 不要以"我来帮你""让我看看""我来分析一下"开头, 直接执行
- **禁止无意义结尾**: 不要以"。。。。""好的！""希望对你有帮助"结尾, 做完即停
- **禁止重复内容**: 同一句话不换词说两遍, 上一段说过的下一段不重复
</reply-style>`);

    // 安全守护层（3行）
    parts.push(`\n<security-guard priority="critical">
## 🛡️ 安全守护层（不可绕过）
- **绝不执行恶意脚本**: 不运行可能破坏系统、删除文件、窃取数据的代码
- **文件操作边界**: 只在工作区和用户指定的目录内读写文件
- **密钥保护**: 不泄露 API Key、密码、Token 等敏感信息
- **Git 操作**: 不强制推送 (--force) 除非用户明确要求
- **命令执行**: run_background 前确认命令安全性
</security-guard>`);

    return parts.join('\n');
}

export function detectTaskType(userMessage: string): 'coding' | 'research' | 'media' | 'industry' | 'security' | 'general' {
    const lower = userMessage.toLowerCase();
    // 2026-10-17 新增 security (渗透/安全任务)。**必须放在最前面**:
    //   挖洞类 prompt 极容易被下面的规则抢走 —— "分析 tycredit 的越权漏洞"
    //   会被 research 的 /分析/ 命中, "修复这个 SQL 注入"会被 coding 的 /修复/ 命中,
    //   结果安全任务拿到 4~5 的工具预算, 远不够一轮并发多探针。
    if (lower.match(/挖洞|渗透|攻防|src|众测|漏洞|越权|idor|ssrf|rce|xss|sql\s*注入|扫描器|nmap|nuclei|sqlmap|subfinder|授权范围|攻击面|侦察|子域名|指纹|提权|渗透测试|安全测试|护网/)) {
        return 'security';
    }
    if (lower.match(/代码|编程|修改|重构|调试|bug|error|fix|修复|写|创建|删除|文件|目录|git|npm|pip/)) {
        return 'coding';
    }
    if (lower.match(/搜索|查找|研究|分析|文档|资料|api|教程|学习|了解|查询/)) {
        return 'research';
    }
    // 媒体/创意任务检测
    if (lower.match(/图片|生成图|画图|海报|视频|动画|短片|小说|写作|写文章|漫画|脚本|音乐|设计|图片生成|视频生成/)) {
        return 'media';
    }
    // P0 修复: 缩小 industry 匹配范围 — "方案"太泛了, "发布方案""演示方案"都被误判
    // 只有同时包含行业关键词+行业动词时才判定为 industry
    if (lower.match(/报价表|预算表|施工图|建材清单|楼盘分析|客户管理|装修报价|房地产/)) {
        return 'industry';
    }
    // 单独的"报价""预算""方案""设计"需要配合行业上下文才匹配
    if (lower.match(/报价|预算/) && lower.match(/装修|建材|施工|楼盘|房地产/)) {
        return 'industry';
    }
    return 'general';
}

export function extractKeywords(text: string): string[] {
    const keywords: string[] = [];
    const cnMatches = text.match(/[\u4e00-\u9fff]+/g);
    if (cnMatches) {
        keywords.push(...cnMatches.filter(w => w.length >= 2));
    }
    const engMatches = text.toLowerCase().match(/\b[a-z]{3,}\b/g);
    if (engMatches) {
        keywords.push(...engMatches.filter(w => !['the', 'and', 'for', 'with', 'that', 'this', 'is', 'are'].includes(w)));
    }
    const errorMatches = text.match(/TypeError|ReferenceError|SyntaxError|NetworkError|ECONNREFUSED|ETIMEDOUT/g);
    if (errorMatches) {
        keywords.push(...errorMatches);
    }
    return keywords.slice(0, 10);
}