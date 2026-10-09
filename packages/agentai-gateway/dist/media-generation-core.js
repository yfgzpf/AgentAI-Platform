/**
 * Media Generation Core - 多媒体生成核心
 *
 * 整合：
 * 1. 图像生成（现有）
 * 2. 视频生成（参考漫剧系统）
 * 3. 3D模型生成（Tripo3D API）
 *
 * 生产级能力：
 * - 任务队列管理
 * - 进度实时推送
 * - 错误自动重试
 * - 资源智能调度
 */
import { EventEmitter } from 'events';
import axios from 'axios';
import * as fs from 'fs';
// ═══════════════════════════════════════════════════════════
// Tripo3D API 配置
// ═══════════════════════════════════════════════════════════
const TRIPO3D_CONFIG = {
    apiKey: 'tsk_xSQSUveuLLzKQqpr0VB2WFC0QweDOHmj1iptiJor8aI',
    baseUrl: 'https://api.tripo3d.ai/v2',
    webhookUrl: process.env.TRIPO_WEBHOOK_URL,
};
// ═══════════════════════════════════════════════════════════
// Tripo3D API 客户端
// ═══════════════════════════════════════════════════════════
export class Tripo3DClient {
    apiKey;
    baseUrl;
    constructor(config = TRIPO3D_CONFIG) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl;
    }
    /**
     * 创建3D生成任务
     */
    async createTask(params) {
        const url = `${this.baseUrl}/task`;
        const body = {
            type: params.type,
            style: params.style || 'pbr',
            texture: params.texture !== false,
        };
        if (params.type === 'text_to_model' && params.prompt) {
            body.prompt = params.prompt;
        }
        else if (params.type === 'image_to_model' && params.imageUrl) {
            body.file = {
                type: 'url',
                data: params.imageUrl,
            };
        }
        try {
            const response = await axios.post(url, body, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });
            return {
                taskId: response.data.data.task_id,
                status: response.data.data.status,
            };
        }
        catch (error) {
            console.error('[Tripo3D] 创建任务失败:', error.response?.data || error.message);
            throw new Error(`创建3D任务失败: ${error.response?.data?.message || error.message}`);
        }
    }
    /**
     * 查询任务状态
     */
    async getTaskStatus(taskId) {
        const url = `${this.baseUrl}/task/${taskId}`;
        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                timeout: 10000,
            });
            const data = response.data.data;
            return {
                status: data.status,
                progress: data.progress,
                result: data.result ? {
                    model: data.result.model,
                    image: data.result.image_url,
                    video: data.result.video_url,
                    pbr: data.result.pbr_url,
                } : undefined,
            };
        }
        catch (error) {
            console.error('[Tripo3D] 查询任务失败:', error.response?.data || error.message);
            throw new Error(`查询任务失败: ${error.response?.data?.message || error.message}`);
        }
    }
    /**
     * 下载生成的模型
     */
    async downloadModel(modelUrl, savePath) {
        try {
            const response = await axios.get(modelUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
            });
            fs.writeFileSync(savePath, response.data);
            return savePath;
        }
        catch (error) {
            console.error('[Tripo3D] 下载模型失败:', error.message);
            throw new Error(`下载模型失败: ${error.message}`);
        }
    }
}
// ═══════════════════════════════════════════════════════════
// 多媒体生成核心
// ═══════════════════════════════════════════════════════════
export class MediaGenerationCore extends EventEmitter {
    tasks = new Map();
    tripoClient;
    isRunning = false;
    constructor() {
        super();
        this.tripoClient = new Tripo3DClient();
    }
    /**
     * 启动核心
     */
    start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        this.startTaskProcessor();
        console.log('[MediaCore] 多媒体生成核心已启动');
    }
    /**
     * 创建生成任务
     */
    async createTask(params) {
        const task = {
            id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: params.type,
            status: 'pending',
            prompt: params.prompt,
            negativePrompt: params.negativePrompt,
            params: params.params || {},
            progress: 0,
            retryCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.tasks.set(task.id, task);
        this.emit('task:created', task);
        // 立即处理3D任务
        if (params.type === '3d') {
            this.process3DTask(task, params.imageUrl);
        }
        return task;
    }
    /**
     * 处理3D生成任务
     */
    async process3DTask(task, imageUrl) {
        task.status = 'processing';
        task.updatedAt = Date.now();
        this.emit('task:started', task);
        try {
            // 创建Tripo3D任务
            const tripoTask = await this.tripoClient.createTask({
                type: imageUrl ? 'image_to_model' : 'text_to_model',
                prompt: task.prompt,
                imageUrl,
                style: task.params.style || 'pbr',
                texture: task.params.texture !== false,
            });
            task.params.tripoTaskId = tripoTask.taskId;
            // 轮询状态
            await this.poll3DTask(task);
        }
        catch (error) {
            task.status = 'failed';
            task.error = error.message;
            task.updatedAt = Date.now();
            this.emit('task:failed', task);
        }
    }
    /**
     * 轮询3D任务状态
     */
    async poll3DTask(task) {
        const tripoTaskId = task.params.tripoTaskId;
        const maxAttempts = 180; // 最多轮询30分钟（每10秒一次）
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const status = await this.tripoClient.getTaskStatus(tripoTaskId);
                task.status = status.status;
                task.progress = status.progress || (i / maxAttempts) * 100;
                task.updatedAt = Date.now();
                this.emit('task:progress', task);
                if (status.status === 'success') {
                    // 任务完成
                    task.status = 'completed';
                    task.progress = 100;
                    task.result = {
                        urls: [
                            status.result?.model,
                            status.result?.image,
                            status.result?.video,
                            status.result?.pbr,
                        ].filter(Boolean),
                    };
                    task.completedAt = Date.now();
                    this.emit('task:completed', task);
                    return;
                }
                if (status.status === 'failed') {
                    throw new Error('Tripo3D任务执行失败');
                }
                // 等待10秒再查询
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
            catch (error) {
                // 重试逻辑
                if (task.retryCount < 3) {
                    task.retryCount++;
                    console.log(`[MediaCore] 3D任务查询失败，第${task.retryCount}次重试...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                else {
                    throw error;
                }
            }
        }
        throw new Error('3D任务超时');
    }
    /**
     * 启动任务处理器
     */
    startTaskProcessor() {
        // 定期清理完成的任务
        setInterval(() => {
            this.cleanupCompletedTasks();
        }, 3600000); // 每小时清理一次
    }
    /**
     * 清理完成的任务
     */
    cleanupCompletedTasks() {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        for (const [id, task] of this.tasks) {
            if ((task.status === 'completed' || task.status === 'failed') &&
                task.updatedAt < oneDayAgo) {
                this.tasks.delete(id);
            }
        }
    }
    /**
     * 获取任务
     */
    getTask(taskId) {
        return this.tasks.get(taskId);
    }
    /**
     * 获取所有任务
     */
    getAllTasks() {
        return Array.from(this.tasks.values());
    }
    /**
     * 获取统计
     */
    getStats() {
        const tasks = this.getAllTasks();
        return {
            total: tasks.length,
            pending: tasks.filter(t => t.status === 'pending').length,
            processing: tasks.filter(t => t.status === 'processing').length,
            completed: tasks.filter(t => t.status === 'completed').length,
            failed: tasks.filter(t => t.status === 'failed').length,
        };
    }
    /**
     * 停止核心
     */
    stop() {
        this.isRunning = false;
        console.log('[MediaCore] 多媒体生成核心已停止');
    }
}
// 单例导出
let mediaCore = null;
export function getMediaGenerationCore() {
    if (!mediaCore) {
        mediaCore = new MediaGenerationCore();
    }
    return mediaCore;
}
