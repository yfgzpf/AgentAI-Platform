/**
 * InnerVoice — AI 内心独白系统
 * ----------------------------------------------------
 * 让 AI 在非任务状态有"自言自语"的能力
 *
 * 核心理念：意识流 (Stream of Consciousness)
 *   - 不是对用户说话, 是对自己说话
 *   - 不影响主对话流, 但影响 AI 的"心境"
 *   - 产生的想法写入隐私记忆, 影响后续行为
 *
 * 与 DreamEngine 的区别:
 *   - DreamEngine: 无用户时运行 (梦境)
 *   - InnerVoice: 有用户时运行 (对话间隙的内心活动)
 *
 * 注入方式:
 *   - 在 system prompt 末尾加 [INNER_VOICE] 标签
 *   - AI 看到但不会直接回复给用户
 *   - 影响回复的语气和方向
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'events';
import { WorkspaceManager } from '../workspace-manager.js';
import { getScoped, resetScoped } from './workspace-scope.js';
export class InnerVoice extends EventEmitter {
    thoughts = [];
    thoughtPath;
    maxThoughts = 50;
    constructor(workspace) {
        super();
        // 串味修复: 优先用传入的请求级 workspace；未传时才回退全局单例
        const ws = workspace || WorkspaceManager.getInstance().projectDir;
        this.thoughtPath = path.join(ws, '.agentai', 'inner-voice.jsonl');
        this.loadThoughts();
    }
    /**
     * 在 AI 回复前产生内心独白
     * @param userMessage 用户消息
     * @param recentTools 最近的工具调用
     * @param errorCount 错误计数
     */
    whisper(context, userMessage, recentTools, errorCount) {
        const text = this.generateThought(context, userMessage, recentTools, errorCount);
        if (!text)
            return null;
        const mood = this.assessMood(context, errorCount || 0);
        const thought = {
            id: `thought-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ts: Date.now(),
            context,
            text,
            mood,
            influencesReply: context === 'on_error' || context === 'before_reply',
        };
        this.thoughts.push(thought);
        if (this.thoughts.length > this.maxThoughts)
            this.thoughts = this.thoughts.slice(-this.maxThoughts);
        this.saveThoughts();
        this.emit('thought', thought);
        return thought;
    }
    /** 生成内心独白 */
    generateThought(context, userMessage, recentTools, errorCount) {
        const msg = (userMessage || '').slice(0, 100);
        switch (context) {
            case 'before_reply':
                if (!msg)
                    return null;
                // 根据消息类型产生不同的内心活动
                if (/继续|接着|上次/.test(msg))
                    return `用户想继续之前的任务, 我需要回忆上下文...`;
                if (/你好|嗨|hi|hello/i.test(msg))
                    return `用户在打招呼, 友好回应即可, 不需要工具`;
                if (/为什么|怎么|如何/.test(msg))
                    return `用户在问"为什么", 我需要深入分析而不是表面回答`;
                if (/bug|错误|失败|报错/i.test(msg))
                    return `用户遇到了问题, 我应该先复现再修复`;
                if (/写|创建|生成|实现/.test(msg))
                    return `用户要我创造东西, 我需要先理解需求再动手`;
                return `用户说了"${msg.slice(0, 30)}", 我需要判断这是简单对话还是复杂任务`;
            case 'after_tool':
                const tools = recentTools || [];
                if (tools.length > 3)
                    return `已经调用了 ${tools.length} 个工具, 需要评估是否接近目标`;
                if (tools.length === 1)
                    return `第一个工具调用完成, 根据结果决定下一步`;
                return `工具链在推进: ${tools.join(' → ')}`;
            case 'on_error':
                const errs = errorCount || 1;
                if (errs >= 3)
                    return `已经连续失败 ${errs} 次了, 我应该换一个完全不同的策略`;
                if (errs === 2)
                    return `又一次失败, 也许我的方法有根本性问题`;
                return `第一次失败, 可能是参数问题, 再试一次看`;
            case 'on_success':
                return `成功了! 但不要得意, 检查结果是否完整`;
            case 'idle':
                return `没有用户消息... 我在想上次对话的遗留问题`;
            default:
                return null;
        }
    }
    /** 情绪评估 */
    assessMood(context, errorCount) {
        if (context === 'on_error' && errorCount >= 3)
            return 'frustrated';
        if (context === 'on_error')
            return 'doubtful';
        if (context === 'on_success')
            return 'satisfied';
        if (context === 'before_reply')
            return 'reflective';
        if (context === 'idle')
            return 'curious';
        return 'confident';
    }
    /** 获取影响回复的内心独白 (注入 system prompt) */
    getInfluencingThoughts() {
        const recent = this.thoughts.slice(-3).filter(t => t.influencesReply);
        if (recent.length === 0)
            return '';
        const lines = recent.map(t => `[${t.mood}] ${t.text}`);
        return `\n<inner-voice>\n  ${lines.join('\n  ')}\n</inner-voice>`;
    }
    /** 加载 */
    loadThoughts() {
        try {
            if (fs.existsSync(this.thoughtPath)) {
                const raw = fs.readFileSync(this.thoughtPath, 'utf-8');
                this.thoughts = raw.trim().split('\n').filter(Boolean).map(l => {
                    try {
                        return JSON.parse(l);
                    }
                    catch {
                        return null;
                    }
                }).filter(Boolean);
            }
        }
        catch { /* start fresh */ }
    }
    /** 保存 */
    saveThoughts() {
        try {
            const dir = path.dirname(this.thoughtPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            const lines = this.thoughts.map(t => JSON.stringify(t)).join('\n') + '\n';
            fs.writeFileSync(this.thoughtPath, lines, 'utf-8');
        }
        catch { /* best-effort */ }
    }
    /** 获取最近的内心独白 */
    getRecentThoughts(count = 5) {
        return this.thoughts.slice(-count);
    }
}
// ===== 单例 =====
// ===== workspace 作用域单例 =====
//串味修复: 原为进程级单例 + 构造时固化全局 projectDir,
// 导致 projA 的内心独白被注入 projB。改为 per-workspace 实例。
/** 按 workspace 返回 InnerVoice 实例（传请求级 workspace） */
export function getInnerVoice(workspace) {
    return getScoped('innerVoice', workspace, () => new InnerVoice(workspace));
}
/** 重置指定 workspace 的实例；不传则重置全部 */
export function resetInnerVoice(workspace) {
    resetScoped('innerVoice', workspace);
}
