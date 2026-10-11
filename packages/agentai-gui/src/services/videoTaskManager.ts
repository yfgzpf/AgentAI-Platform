/**
 * videoTaskManager — 全局视频任务管理器
 *
 * 功能:
 * 1. 后台轮询: 组件卸载后仍继续轮询, 完成后通知
 * 2. 排队队列: 多个任务排队, 上一个完成后自动提交下一个
 * 3. 历史持久化: localStorage 保存, 退出再进入不丢失
 * 4. 跨组件共享: VideoGen 组件挂载时读取最新状态
 */

import { io, type Socket } from 'socket.io-client';

export interface VideoTask {
  id: string;
  prompt: string;
  taskId: string | null;       // 后端任务ID (提交前为null)
  videoUrl: string | null;
  coverUrl?: string | null;
  status: 'queued' | 'submitting' | 'polling' | 'completed' | 'failed';
  progress: number;
  ts: number;
  provider?: string;
  model?: string;
  error?: string;
  // 提交参数 (用于重新生成)
  params?: {
    prompt: string;
    image?: string;
    end_frame?: string;
    images?: string[];
    audios?: string[];
    duration?: string;
    model?: string;
    size?: string;
    aspect_ratio?: string;
  };
  // P3: 剧集链 — 角色记忆 + 故事线
  episodeIndex?: number;         // 第几集 (1=首集)
  characters?: EpisodeCharacter[]; // 角色信息
  storySummary?: string;         // 故事线摘要 (供续集参考)
  chainId?: string;              // 剧集链 ID (同一故事线的续集共享)
}

/** 剧集角色 — 跨集一致性 */
export interface EpisodeCharacter {
  name: string;
  description: string;           // 外貌/服装/性格描述
  firstAppearEpisode?: number;   // 首次出场集数
}

/** 剧集链 — 同一故事线的所有集数 */
export interface EpisodeChain {
  chainId: string;
  episodes: Array<{
    taskId: string;
    episodeIndex: number;
    prompt: string;
    videoUrl?: string;
    tailFrameUrl?: string;
    characters?: EpisodeCharacter[];
  }>;
  storySummary: string;
  createdAt: number;
}

type Listener = (tasks: VideoTask[], activeTask: VideoTask | null) => void;

const STORAGE_KEY = 'agentai-video-history';
const QUEUE_KEY = 'agentai-video-queue';
const POLL_INTERVAL = 15000;
const MAX_POLLS = 200;
const MAX_PARALLEL = 1; // Agnes Flash 不支持并发, 串行提交
// 限流/队列满的重试上限 —— 见 submitTaskToBackend 中的说明
const MAX_THROTTLE_RETRIES = 5;

class VideoTaskManager {
  private tasks: VideoTask[] = [];
  private queue: VideoTask[] = [];     // 等待提交的任务
  private activePollIds: Set<string> = new Set();  // 正在轮询的任务ID集合 (并行)
  private pollTimers: Map<string, ReturnType<typeof setInterval>> = new Map(); // 每个任务独立的定时器
  private pollCounts: Map<string, number> = new Map(); // 每个任务独立的轮询计数
  private listeners: Set<Listener> = new Set();
  private httpUrl = '';
  private wsSocket: Socket | null = null;

  constructor() {
    // 从 localStorage 恢复
    this.loadFromStorage();
  }

  setHttpUrl(url: string) {
    this.httpUrl = url;
    // 初始化 WS 连接监听后端推送 (零延迟通知, 替代部分轮询)
    this.initWebSocket(url);
  }

  /** 初始化 WebSocket — 监听 video:completed / video:failed 事件 */
  private initWebSocket(httpUrl: string) {
    if (this.wsSocket) return; // 已初始化
    try {
      const wsUrl = httpUrl.replace(/^http/, 'ws');
      this.wsSocket = io(wsUrl, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
      });
      // 后端推送: 视频完成 → 立即更新任务, 停止轮询
      this.wsSocket.on('video:completed', (data: { taskId: string; videoUrl: string; coverUrl?: string }) => {
        const task = this.tasks.find(t => t.taskId === data.taskId);
        if (task && task.status === 'polling') {
          this.stopPolling(task.id);
          this.activePollIds.delete(task.id);
          task.status = 'completed';
          task.videoUrl = data.videoUrl;
          task.coverUrl = data.coverUrl || null;
          task.progress = 100;
          this.notify();
          // 浏览器通知
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('🎬 视频生成完成', { body: task.prompt.slice(0, 50) });
          }
          this.processQueue();
        }
      });
      // 后端推送: 视频失败
      this.wsSocket.on('video:failed', (data: { taskId: string; status: string }) => {
        const task = this.tasks.find(t => t.taskId === data.taskId);
        if (task && task.status === 'polling') {
          this.stopPolling(task.id);
          this.activePollIds.delete(task.id);
          task.status = 'failed';
          this.notify();
          this.processQueue();
        }
      });
    } catch { /* WS 不可用, 回退到轮询 */ }
  }

  /** 注册监听器, 立即返回当前状态 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getTasks(), this.getActiveTask());
    return () => this.listeners.delete(listener);
  }

  getTasks(): VideoTask[] {
    return [...this.tasks];
  }

  getActiveTask(): VideoTask | null {
    return this.tasks.find(t => t.status === 'polling' || t.status === 'submitting') || null;
  }

  getActiveTasks(): VideoTask[] {
    return this.tasks.filter(t => t.status === 'polling' || t.status === 'submitting');
  }

  getQueue(): VideoTask[] {
    return [...this.queue];
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
        // 恢复时: 有 taskId 且无 videoUrl 的任务 → 恢复轮询 (不标 failed)
        this.tasks = this.tasks.map(t => {
          if (t.status === 'polling' || t.status === 'submitting') {
            if (t.videoUrl) return { ...t, status: 'completed' as const };
            if (t.taskId) return { ...t, status: 'polling' as const }; // 恢复轮询
            return { ...t, status: 'failed' as const }; // 没 taskId 说明提交都没成功
          }
          return t;
        });
        // 恢复轮询: 找到所有 polling 状态且有 taskId 的任务, 重新开始轮询
        const recoverable = this.tasks.filter(t => t.status === 'polling' && t.taskId);
        if (recoverable.length > 0) {
          // 并行恢复: 前 MAX_PARALLEL 个直接恢复轮询, 其余放回 queue
          const toRecover = recoverable.slice(0, MAX_PARALLEL);
          const toQueue = recoverable.slice(MAX_PARALLEL);
          for (const t of toRecover) {
            this.activePollIds.add(t.id);
          }
          for (const t of toQueue) {
            t.status = 'queued';
            this.queue.push(t);
          }
          // 延迟 2 秒后恢复轮询 (等 httpUrl 设置好)
          setTimeout(() => {
            for (const t of toRecover) {
              if (t.taskId) this.startPolling(t);
            }
          }, 2000);
        }
      }
    } catch {}
  }

  private saveToStorage() {
    try {
      // 只保存有价值的任务 (有URL或用户显式提交的)
      const toSave = this.tasks.filter(t => t.videoUrl || t.status !== 'failed').slice(0, 50);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // 溢出时只保存有URL的
      try {
        const withUrl = this.tasks.filter(t => t.videoUrl).slice(0, 20);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(withUrl));
      } catch { /* give up */ }
    }
  }

  /** 添加任务到队列 (用户点击生成) */
submitTask(params: {
prompt: string;
image?: string;
end_frame?: string;
images?: string[];
audios?: string[];
duration?: string;
model?: string;
size?: string;
aspect_ratio?: string;
}): string {
    const id = `vt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: VideoTask = {
      id,
      prompt: params.prompt,
      taskId: null,
      videoUrl: null,
      status: 'queued',
      progress: 0,
      ts: Date.now(),
      model: params.model,
      params,
    };
    this.tasks = [task, ...this.tasks];
    this.queue.push(task);
    this.notify();
    this.processQueue();
    return id;
  }

  /** 处理队列: 支持并行 (最多 MAX_PARALLEL 个同时轮询) */
  private async processQueue() {
    while (this.activePollIds.size < MAX_PARALLEL) {
      const next = this.queue.shift();
      if (!next) break;

      this.activePollIds.add(next.id);
      next.status = 'submitting';
      this.notify();

      // 异步提交, 不阻塞循环
      this.submitTaskToBackend(next);
    }
  }

  private async submitTaskToBackend(next: VideoTask) {
    try {
      const body: any = {
        prompt: next.params?.prompt,
        model: next.params?.model || 'agnes',
      };
      if (next.params?.image) body.image = next.params.image;
      if (next.params?.end_frame) body.end_frame = next.params.end_frame;
      if (next.params?.images && next.params.images.length > 0) body.images = next.params.images;
      // 传递 duration, 后端根据 provider 自行 clamp (Agnes 4~12, Seedance 4~30)
      if (next.params?.duration) {
        body.duration = next.params.duration;
      }
      // 传递 size 和 aspect_ratio (前端可能传)
      if (next.params?.size) body.size = next.params.size;
      if (next.params?.aspect_ratio) body.aspect_ratio = next.params.aspect_ratio;

      const resp = await fetch(`${this.httpUrl}/v1/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();

      if (data.error) {
        // 限流/队列满 → 30秒后重试, 最多 MAX_THROTTLE_RETRIES 次
        //
        // ⚠️ 原先**没有次数上限**: 每次限流都 unshift 回队首 + 30s 后重投, 于是
        //    任务永远停在"排队中" —— 既不会成功, 也永远不报错, 用户只能干等。
        // 2026-10-11 实测: agnes 免费档返回 429「您已达到免费用户的 API 速率限制」,
        //    该额度一旦耗尽, 重试多久都不会成功, 必须让用户看到可执行的下一步。
        //    同时补上 429 —— 原先只认 503, 429 会被立刻标失败(丢失退避机会)。
        const isThrottled = resp.status === 503 || resp.status === 429
          || data.code === 'video_queue_full'
          || String(data.error).includes('队列')
          || String(data.error).includes('速率限制');
        if (isThrottled) {
          const tries = ((next as any)._throttleTries || 0) + 1;
          (next as any)._throttleTries = tries;
          if (tries <= MAX_THROTTLE_RETRIES) {
            next.status = 'queued';
            this.queue.unshift(next); // 重新放回队首
            this.activePollIds.delete(next.id);
            setTimeout(() => this.processQueue(), 30000);
            this.notify();
            return;
          }
          // 重试耗尽 — 明确失败并给出可执行的替代方案
          next.status = 'failed';
          next.error = `${data.error}${data.hint ? '\n' + data.hint : ''}`
            + `\n已重试 ${MAX_THROTTLE_RETRIES} 次仍被限流。建议改用「CogVideoX-Flash (智谱免费)」，`
            + '或在设置页配置 AGNES_VIDEO_API_KEY 以解锁独立额度。';
          this.activePollIds.delete(next.id);
          this.notify();
          this.processQueue();
          return;
        }
        next.status = 'failed';
        next.error = data.hint ? `${data.error}\n${data.hint}` : data.error;
        this.activePollIds.delete(next.id);
        this.notify();
        this.processQueue(); // 处理下一个
        return;
      }

      next.taskId = data.taskId;
      next.provider = data.provider;
      // 提交成功检查: taskId 必须有效
      if (!next.taskId) {
        next.status = 'failed';
        this.activePollIds.delete(next.id);
        this.notify();
        this.processQueue();
        return;
      }
      next.status = 'polling';
      this.notify();
      this.startPolling(next);
    } catch (e) {
      next.status = 'failed';
      this.activePollIds.delete(next.id);
      this.notify();
      this.processQueue();
    }
  }

  private startPolling(task: VideoTask) {
    // 每个任务独立的定时器和计数
    let count = 0;
    const timer = setInterval(async () => {
      count++;
      this.pollCounts.set(task.id, count);
      if (count > MAX_POLLS) {
        this.stopPolling(task.id);
        task.status = 'failed';
        this.activePollIds.delete(task.id);
        this.notify();
        this.processQueue();
        return;
      }

      try {
        const resp = await fetch(`${this.httpUrl}/v1/video/${task.taskId}?provider=${encodeURIComponent(task.provider || '')}`);
        const data = await resp.json();

        if (data.error) {
          // 查询错误: 不立即标失败, 允许连续 3 次错误才标失败 (API 偶尔抖动)
          const errCount = (task as any)._queryErrors || 0;
          (task as any)._queryErrors = errCount + 1;
          if (errCount + 1 >= 3) {
            this.stopPolling(task.id);
            task.status = 'failed';
            this.activePollIds.delete(task.id);
            this.notify();
            this.processQueue();
          }
          return;
        }

        const newStatus = data.status || 'queued';
        const remoteUrl = data.videoUrl || data.video_url || null;

        // 尝试从 raw 提取 URL
        let finalUrl = remoteUrl;
        if (!finalUrl && data.raw) {
          try {
            const raw = JSON.parse(data.raw);
            finalUrl = raw.video_url || raw.video?.url || raw.output?.[0]?.url || raw.url || raw.result?.video_url || null;
          } catch {}
        }

        const isDone = ['completed', 'success', 'succeeded', 'done', 'finished'].includes(newStatus) || (finalUrl && newStatus !== 'failed');
        const isFailed = ['failed', 'error', 'cancelled', 'canceled'].includes(newStatus);

        if (isDone || isFailed) {
          this.stopPolling(task.id);
          task.status = isDone ? 'completed' : 'failed';
          task.videoUrl = finalUrl;
          task.coverUrl = data.coverUrl || data.cover_url || null;
          // P0: 保存 API 返回的尾帧 URL (return_last_frame: true 时返回)
          (task as any).lastFrameUrl = data.lastFrameUrl || data.last_frame_url || null;
          this.activePollIds.delete(task.id);
          this.notify();

          // 浏览器通知
          if (isDone && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('🎬 视频生成完成', { body: task.prompt.slice(0, 50) });
          }

          // 自动处理队列中下一个
          this.processQueue();
        } else {
          task.progress = typeof data.progress === 'number' ? data.progress : 0;
          if (finalUrl) task.videoUrl = finalUrl;
          this.notify();
        }
      } catch { /* 网络抖动 */ }
    }, POLL_INTERVAL);
    this.pollTimers.set(task.id, timer);
  }

  private stopPolling(taskId?: string) {
    if (taskId) {
      // 停止指定任务的定时器
      const timer = this.pollTimers.get(taskId);
      if (timer) { clearInterval(timer); this.pollTimers.delete(taskId); }
      this.pollCounts.delete(taskId);
    } else {
      // 停止所有
      for (const timer of this.pollTimers.values()) clearInterval(timer);
      this.pollTimers.clear();
      this.pollCounts.clear();
    }
  }

  /** 用户取消任务 */
  cancelTask(id: string) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return;
    if (task.status === 'queued') {
      // 从队列中移除
      this.queue = this.queue.filter(q => q.id !== id);
    }
    if (this.activePollIds.has(id)) {
      this.stopPolling(id);
      this.activePollIds.delete(id);
      this.processQueue();
    }
    task.status = 'failed';
    this.notify();
  }

  /** 删除任务 */
  deleteTask(id: string) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.queue = this.queue.filter(q => q.id !== id);
    if (this.activePollIds.has(id)) {
      this.stopPolling(id);
      this.activePollIds.delete(id);
    }
    this.notify();
  }

  /** P3: 获取任务所属的剧集链 (同一故事线的所有续集) */
  getEpisodeChain(taskId: string): VideoTask[] {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return [task!].filter(Boolean);
    const chainId = task.chainId;
    if (!chainId) return [task];
    return this.tasks.filter(t => t.chainId === chainId).sort((a, b) => (a.episodeIndex || 1) - (b.episodeIndex || 1));
  }

  /** P3: 将任务标记为续集 — 关联到上一集的 chainId */
  linkToChain(prevTaskId: string, newTaskId: string, episodeIndex: number, characters?: EpisodeCharacter[], storySummary?: string): void {
    const prevTask = this.tasks.find(t => t.id === prevTaskId);
    const newTask = this.tasks.find(t => t.id === newTaskId);
    if (!prevTask || !newTask) return;
    // 继承或创建 chainId
    const chainId = prevTask.chainId || `chain-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    prevTask.chainId = chainId;
    newTask.chainId = chainId;
    newTask.episodeIndex = episodeIndex;
    if (characters) newTask.characters = characters;
    if (storySummary) newTask.storySummary = storySummary;
    // 也给前序任务补上 episodeIndex (如果没设)
    if (!prevTask.episodeIndex) prevTask.episodeIndex = episodeIndex - 1;
    this.saveToStorage();
    this.notify();
  }

  /** P3: 获取剧集链的故事上下文 (供续集 LLM 参考) */
  getChainContext(taskId: string): { storyContext: string; characters: EpisodeCharacter[]; episodeIndex: number } {
    const chain = this.getEpisodeChain(taskId);
    const completed = chain.filter(t => t.status === 'completed');
    const storyContext = completed
      .map(t => `第${t.episodeIndex || 1}集: ${t.prompt.slice(0, 100)}`)
      .join('\n');
    // 合并所有集数的角色
    const charMap = new Map<string, EpisodeCharacter>();
    for (const t of chain) {
      if (t.characters) for (const c of t.characters) {
        if (!charMap.has(c.name)) charMap.set(c.name, c);
      }
    }
    return {
      storyContext,
      characters: Array.from(charMap.values()),
      episodeIndex: completed.length + 1,
    };
  }

  /** 清空所有 */
  clearAll() {
    this.stopPolling();
    this.tasks = [];
    this.queue = [];
    this.activePollIds.clear();
    this.notify();
  }

  /** 重新生成 (复制参数重新提交) */
  regenerate(id: string): string | null {
    const task = this.tasks.find(t => t.id === id);
    if (!task || !task.params) return null;
    return this.submitTask(task.params);
  }
}

// 全局单例
export const videoTaskManager = new VideoTaskManager();
