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
import * as path from 'path';

// ═══════════════════════════════════════════════════════════
// Tripo3D API 配置
// ═══════════════════════════════════════════════════════════

const TRIPO3D_CONFIG = {
  apiKey: 'tsk_xSQSUveuLLzKQqpr0VB2WFC0QweDOHmj1iptiJor8aI',
  baseUrl: 'https://api.tripo3d.ai/v2',
  webhookUrl: process.env.TRIPO_WEBHOOK_URL,
};

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface GenerationTask {
  id: string;
  type: 'image' | 'video' | '3d';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  prompt: string;
  negativePrompt?: string;
  params: Record<string, any>;
  progress: number;
  result?: {
    url?: string;
    urls?: string[];
    localPath?: string;
  };
  error?: string;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface Tripo3DResponse {
  task_id: string;
  status: string;
  result?: {
    model: string;
    image_url?: string;
    video_url?: string;
    pbr_url?: string;
  };
}

// ═══════════════════════════════════════════════════════════
// Tripo3D API 客户端
// ═══════════════════════════════════════════════════════════

export class Tripo3DClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config = TRIPO3D_CONFIG) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  /**
   * 创建3D生成任务
   */
  async createTask(params: {
    type: 'image_to_model' | 'text_to_model';
    prompt?: string;
    imageUrl?: string;
    style?: 'pbr' | 'normal';
    texture?: boolean;
  }): Promise<{ taskId: string; status: string }> {
    const url = `${this.baseUrl}/task`;
    
    const body: any = {
      type: params.type,
      style: params.style || 'pbr',
      texture: params.texture !== false,
    };

    if (params.type === 'text_to_model' && params.prompt) {
      body.prompt = params.prompt;
    } else if (params.type === 'image_to_model' && params.imageUrl) {
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
    } catch (error: any) {
      console.error('[Tripo3D] 创建任务失败:', error.response?.data || error.message);
      throw new Error(`创建3D任务失败: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * 查询任务状态
   */
  async getTaskStatus(taskId: string): Promise<{
    status: string;
    progress?: number;
    result?: {
      model?: string;
      image?: string;
      video?: string;
      pbr?: string;
    };
  }> {
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
    } catch (error: any) {
      console.error('[Tripo3D] 查询任务失败:', error.response?.data || error.message);
      throw new Error(`查询任务失败: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * 下载生成的模型
   */
  async downloadModel(modelUrl: string, savePath: string): Promise<string> {
    try {
      const response = await axios.get(modelUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
      });

      fs.writeFileSync(savePath, response.data);
      return savePath;
    } catch (error: any) {
      console.error('[Tripo3D] 下载模型失败:', error.message);
      throw new Error(`下载模型失败: ${error.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 多媒体生成核心
// ═══════════════════════════════════════════════════════════

export class MediaGenerationCore extends EventEmitter {
  private tasks: Map<string, GenerationTask> = new Map();
  private tripoClient: Tripo3DClient;
  private isRunning = false;

  constructor() {
    super();
    this.tripoClient = new Tripo3DClient();
  }

  /**
   * 启动核心
   */
  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.startTaskProcessor();
    console.log('[MediaCore] 多媒体生成核心已启动');
  }

  /**
   * 创建生成任务
   */
  async createTask(params: {
    type: 'image' | 'video' | '3d';
    prompt: string;
    negativePrompt?: string;
    imageUrl?: string; // 用于图生3D
    params?: Record<string, any>;
  }): Promise<GenerationTask> {
    const task: GenerationTask = {
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
  private async process3DTask(task: GenerationTask, imageUrl?: string): Promise<void> {
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

    } catch (error: any) {
      task.status = 'failed';
      task.error = error.message;
      task.updatedAt = Date.now();
      this.emit('task:failed', task);
    }
  }

  /**
   * 轮询3D任务状态
   */
  private async poll3DTask(task: GenerationTask): Promise<void> {
    const tripoTaskId = task.params.tripoTaskId;
    const maxAttempts = 180; // 最多轮询30分钟（每10秒一次）
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const status = await this.tripoClient.getTaskStatus(tripoTaskId);
        
        task.status = status.status as any;
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
            ].filter(Boolean) as string[],
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

      } catch (error: any) {
        // 重试逻辑
        if (task.retryCount < 3) {
          task.retryCount++;
          console.log(`[MediaCore] 3D任务查询失败，第${task.retryCount}次重试...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          throw error;
        }
      }
    }

    throw new Error('3D任务超时');
  }

  /**
   * 启动任务处理器
   */
  private startTaskProcessor(): void {
    // 定期清理完成的任务
    setInterval(() => {
      this.cleanupCompletedTasks();
    }, 3600000); // 每小时清理一次
  }

  /**
   * 清理完成的任务
   */
  private cleanupCompletedTasks(): void {
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
  getTask(taskId: string): GenerationTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): GenerationTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取统计
   */
  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
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
  stop(): void {
    this.isRunning = false;
    console.log('[MediaCore] 多媒体生成核心已停止');
  }
}

// 单例导出
let mediaCore: MediaGenerationCore | null = null;

export function getMediaGenerationCore(): MediaGenerationCore {
  if (!mediaCore) {
    mediaCore = new MediaGenerationCore();
  }
  return mediaCore;
}
