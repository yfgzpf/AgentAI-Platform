/**
 * Human Feedback Loop — 人工反馈闭环系统
 * ---------------------------------------
 * 收集用户对AI输出的反馈，用于持续改进模型表现
 *
 * 反馈类型:
 * - thumbs_up/thumbs_down: 快速反馈
 * - correction: 用户修正
 * - detailed: 详细反馈 (评分+评论)
 *
 * 闭环流程:
 * 1. 收集反馈 → 2. 关联原始输出 → 3. 分析模式 → 4. 注入进化记忆
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeEvolutionAsync } from './evolution.js';
const FEEDBACK_DIR = path.join(os.homedir(), '.agentai', 'feedback');
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback.jsonl');
class FeedbackLoop {
    feedbacks = new Map();
    listeners = new Set();
    constructor() {
        this.loadExistingFeedback();
    }
    loadExistingFeedback() {
        try {
            if (fs.existsSync(FEEDBACK_FILE)) {
                const lines = fs.readFileSync(FEEDBACK_FILE, 'utf-8')
                    .split('\n')
                    .filter(Boolean);
                for (const line of lines) {
                    try {
                        const entry = JSON.parse(line);
                        this.feedbacks.set(entry.id, entry);
                    }
                    catch {
                        // 跳过损坏的记录
                    }
                }
                console.log(`[feedback-loop] Loaded ${this.feedbacks.size} feedback entries`);
            }
        }
        catch (e) {
            console.warn('[feedback-loop] Failed to load feedback:', e);
        }
    }
    async saveFeedback(entry) {
        try {
            if (!fs.existsSync(FEEDBACK_DIR)) {
                fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
            }
            const line = JSON.stringify(entry) + '\n';
            fs.appendFileSync(FEEDBACK_FILE, line, 'utf-8');
        }
        catch (e) {
            console.warn('[feedback-loop] Failed to save feedback:', e);
        }
    }
    /**
     * 提交反馈
     */
    async submitFeedback(feedback) {
        const entry = {
            ...feedback,
            id: `fb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            processed: false
        };
        this.feedbacks.set(entry.id, entry);
        await this.saveFeedback(entry);
        // 触发实时处理
        this.processFeedback(entry);
        // 通知监听器
        for (const listener of this.listeners) {
            try {
                listener(entry);
            }
            catch (e) {
                console.error('[feedback-loop] Listener error:', e);
            }
        }
        console.log(`[feedback-loop] Feedback submitted: ${entry.type} for session ${entry.sessionId}`);
        return entry;
    }
    /**
     * 快速反馈 (点赞/点踩)
     */
    async quickFeedback(sessionId, messageId, type, originalOutput) {
        return this.submitFeedback({
            sessionId,
            messageId,
            type,
            originalOutput,
            context: {}
        });
    }
    /**
     * 详细反馈
     */
    async detailedFeedback(sessionId, messageId, rating, comment, tags, originalOutput) {
        return this.submitFeedback({
            sessionId,
            messageId,
            type: 'detailed',
            rating,
            comment,
            tags,
            originalOutput,
            context: {}
        });
    }
    /**
     * 用户修正反馈
     */
    async correctionFeedback(sessionId, messageId, correction, originalOutput, context) {
        return this.submitFeedback({
            sessionId,
            messageId,
            type: 'correction',
            correction,
            originalOutput,
            context: context || {}
        });
    }
    /**
     * 处理反馈 (闭环)
     */
    async processFeedback(entry) {
        // 1. 负面反馈 → 写入进化记忆
        if (entry.type === 'thumbs_down' || (entry.rating && entry.rating <= 2)) {
            await this.convertToEvolution(entry);
        }
        // 2. 用户修正 → 提取改进规则
        if (entry.type === 'correction' && entry.correction) {
            await this.extractCorrectionPattern(entry);
        }
        // 3. 标记为已处理
        entry.processed = true;
        entry.processedAt = Date.now();
        this.feedbacks.set(entry.id, entry);
        console.log(`[feedback-loop] Processed feedback ${entry.id}`);
    }
    /**
     * 转换为进化记忆
     */
    async convertToEvolution(entry) {
        const taskType = entry.context.taskType;
        const evolutionEntry = {
            type: 'feedback_negative',
            content: entry.comment || `User gave ${entry.type} feedback`,
            taskType: taskType || 'general',
            keywords: entry.tags || ['user_feedback', 'negative'],
            success: false,
            failureCategory: 'skill_defect',
            errorType: 'UserFeedback',
            userId: entry.context.userId,
            workspace: entry.context.workspace,
        };
        await writeEvolutionAsync(evolutionEntry);
        entry.evolutionEntryId = `evo_${entry.timestamp}`;
        console.log(`[feedback-loop] Converted to evolution entry`);
    }
    /**
     * 提取修正模式
     */
    async extractCorrectionPattern(entry) {
        if (!entry.correction || !entry.originalOutput)
            return;
        // 分析用户修正与原输出的差异
        // 提取可复用的改进规则
        const pattern = {
            original: entry.originalOutput.content.substring(0, 200),
            correction: entry.correction.substring(0, 200),
            context: entry.context
        };
        // 保存到修正模式库
        const patternsFile = path.join(FEEDBACK_DIR, 'correction-patterns.jsonl');
        fs.appendFileSync(patternsFile, JSON.stringify(pattern) + '\n', 'utf-8');
        console.log(`[feedback-loop] Extracted correction pattern`);
    }
    /**
     * 获取反馈统计
     */
    getStats() {
        const entries = Array.from(this.feedbacks.values());
        const now = Date.now();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
        const recentEntries = entries.filter(e => e.timestamp > sevenDaysAgo);
        const ratings = entries
            .filter(e => e.rating !== undefined)
            .map(e => e.rating);
        const tagDistribution = {};
        for (const entry of entries) {
            for (const tag of entry.tags || []) {
                tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
            }
        }
        return {
            totalCount: entries.length,
            thumbsUp: entries.filter(e => e.type === 'thumbs_up').length,
            thumbsDown: entries.filter(e => e.type === 'thumbs_down').length,
            correctionCount: entries.filter(e => e.type === 'correction').length,
            detailedCount: entries.filter(e => e.type === 'detailed').length,
            averageRating: ratings.length > 0
                ? ratings.reduce((a, b) => a + b, 0) / ratings.length
                : 0,
            trend7d: {
                positive: recentEntries.filter(e => e.type === 'thumbs_up' || (e.rating && e.rating >= 4)).length,
                negative: recentEntries.filter(e => e.type === 'thumbs_down' || (e.rating && e.rating <= 2)).length,
                neutral: recentEntries.filter(e => e.type === 'detailed' && e.rating === 3).length
            },
            tagDistribution
        };
    }
    /**
     * 获取会话反馈
     */
    getSessionFeedback(sessionId) {
        return Array.from(this.feedbacks.values())
            .filter(e => e.sessionId === sessionId)
            .sort((a, b) => b.timestamp - a.timestamp);
    }
    /**
     * 订阅反馈事件
     */
    onFeedback(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /**
     * 获取所有反馈
     */
    getAllFeedback() {
        return Array.from(this.feedbacks.values())
            .sort((a, b) => b.timestamp - a.timestamp);
    }
}
// 单例
let feedbackLoop = null;
export function getFeedbackLoop() {
    if (!feedbackLoop) {
        feedbackLoop = new FeedbackLoop();
    }
    return feedbackLoop;
}
// 便捷导出
export const submitFeedback = (feedback) => getFeedbackLoop().submitFeedback(feedback);
export const quickFeedback = (sessionId, messageId, type, originalOutput) => getFeedbackLoop().quickFeedback(sessionId, messageId, type, originalOutput);
export { FeedbackLoop };
export default getFeedbackLoop;
