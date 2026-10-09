/**
 * imageTaskManager — 全局图片生成任务管理器
 *
 * 功能:
 * 1. 排队队列: 多张图片排队, 上一张完成后自动提交下一张
 * 2. 历史持久化: localStorage 保存, 退出再进入不丢失
 * 3. 跨组件共享: ImageStudio 组件挂载时读取最新状态
 * 4. 并行度=2: 同时提交 2 个请求 (图片生成比视频快)
 */

export interface ImageTask {
  id: string;
  prompt: string;
  imageUrl: string | null;
  status: 'queued' | 'submitting' | 'completed' | 'failed';
  ts: number;
  model?: string;
  mode?: string;
  size?: string;
  error?: string;
  // 提交参数 (用于重新生成)
  params?: {
    prompt: string;
    model?: string;
    mode?: string;
    size?: string;
    image?: string;     // img2img 参考图
    strength?: number;
    n?: number;
  };
}

type Listener = (tasks: ImageTask[], activeTask: ImageTask | null) => void;

const STORAGE_KEY = 'agentai-image-history';
const MAX_PARALLEL = 2;

class ImageTaskManager {
  private tasks: ImageTask[] = [];
  private activeIds: Set<string> = new Set();
  private listeners: Set<Listener> = new Set();
  private httpUrl = '';

  constructor() {
    this.loadFromStorage();
  }

  setHttpUrl(url: string) {
    this.httpUrl = url;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getTasks(), this.getActiveTask());
    return () => this.listeners.delete(listener);
  }

  getTasks(): ImageTask[] {
    return [...this.tasks];
  }

  getActiveTask(): ImageTask | null {
    return this.tasks.find(t => t.status === 'submitting') || null;
  }

  private notify() {
    const active = this.getActiveTask();
    for (const listener of this.listeners) {
      listener(this.getTasks(), active);
    }
    this.saveToStorage();
  }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.tasks = JSON.parse(raw);
        // 恢复时: submitting 状态的如果有 imageUrl 就标完成, 否则标 failed
        this.tasks = this.tasks.map(t => {
          if (t.status === 'submitting') {
            return t.imageUrl
              ? { ...t, status: 'completed' as const }
              : { ...t, status: 'failed' as const, error: '页面刷新中断' };
          }
          return t;
        });
      }
    } catch {}
  }

  private saveToStorage() {
    try {
      const toSave = this.tasks.filter(t => t.imageUrl || t.status !== 'failed').slice(0, 30);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      try {
        const withUrl = this.tasks.filter(t => t.imageUrl).slice(0, 15);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(withUrl));
      } catch { /* give up */ }
    }
  }

  /** 添加任务到队列 */
  submitTask(params: {
    prompt: string;
    model?: string;
    mode?: string;
    size?: string;
    image?: string;
    strength?: number;
    n?: number;
  }): string {
    const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: ImageTask = {
      id,
      prompt: params.prompt,
      imageUrl: null,
      status: 'queued',
      ts: Date.now(),
      model: params.model,
      mode: params.mode,
      size: params.size,
      params,
    };
    this.tasks = [task, ...this.tasks];
    this.notify();
    this.processQueue();
    return id;
  }

  /** 处理队列: 支持并行 */
  private async processQueue() {
    while (this.activeIds.size < MAX_PARALLEL) {
      const next = this.tasks.find(t => t.status === 'queued');
      if (!next) break;
      this.activeIds.add(next.id);
      next.status = 'submitting';
      this.notify();
      this.executeTask(next);
    }
  }

  private async executeTask(task: ImageTask) {
    try {
      const body: any = {
        prompt: task.params?.prompt,
        model: task.params?.model,
        mode: task.params?.mode || 'text2img',
        size: task.params?.size || '1024x1024',
      };
      if (task.params?.image) body.image = task.params.image;
      if (task.params?.strength) body.strength = task.params.strength;
      if (task.params?.n) body.n = task.params.n;

      const resp = await fetch(`${this.httpUrl}/v1/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();

      if (data.error) {
        task.status = 'failed';
        task.error = data.error;
      } else {
        task.status = 'completed';
        // 兼容多种返回格式
        task.imageUrl = data.url || data.image_url || data.data?.[0]?.url || data.images?.[0] || null;
      }
    } catch (e: any) {
      task.status = 'failed';
      task.error = e.message;
    } finally {
      this.activeIds.delete(task.id);
      this.notify();
      // 自动处理队列中下一个
      this.processQueue();
    }
  }

  /** 注册一个已完成的任务 (只做持久化, 不再提交请求) */
  registerCompleted(params: {
    prompt: string;
    model?: string;
    mode?: string;
    size?: string;
    imageUrl: string;
  }): string {
    const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: ImageTask = {
      id,
      prompt: params.prompt,
      imageUrl: params.imageUrl,
      status: 'completed',
      ts: Date.now(),
      model: params.model,
      mode: params.mode,
      size: params.size,
      params: {
        prompt: params.prompt,
        model: params.model,
        mode: params.mode,
        size: params.size,
      },
    };
    this.tasks = [task, ...this.tasks].slice(0, 50);
    this.notify();
    return id;
  }

  /** 删除任务 */
  deleteTask(id: string) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.activeIds.delete(id);
    this.notify();
  }

  /** 清空所有 */
  clearAll() {
    this.tasks = [];
    this.activeIds.clear();
    this.notify();
  }

  /** 重新生成 */
  regenerate(id: string): string | null {
    const task = this.tasks.find(t => t.id === id);
    if (!task || !task.params) return null;
    return this.submitTask(task.params);
  }
}

// 全局单例
export const imageTaskManager = new ImageTaskManager();
