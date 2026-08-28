/**
 * TaskNotifier — 任务完成提醒服务
 * ----------------------------------------------------
 * 功能:
 *   - 桌面 Notification API 通知
 *   - 提示音 (Web Audio API 合成, 无需外部文件)
 *   - 设置中可开关
 *
 * 存储: localStorage 'agentai.settings.notify'
 * 默认: 开启
 */

interface NotifySettings {
  desktopEnabled: boolean;
  soundEnabled: boolean;
}

const STORAGE_KEY = 'agentai.settings.notify';
const DEFAULT: NotifySettings = { desktopEnabled: true, soundEnabled: true };

class TaskNotifierImpl {
  private settings: NotifySettings;
  private audioCtx: AudioContext | null = null;

  constructor() {
    this.settings = this.load();
    // 提前请求 Notification 权限
    if (this.settings.desktopEnabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  private load(): NotifySettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULT };
  }

  private save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
  }

  get desktopEnabled() { return this.settings.desktopEnabled; }
  get soundEnabled() { return this.settings.soundEnabled; }

  setDesktopEnabled(v: boolean) {
    this.settings.desktopEnabled = v;
    this.save();
    if (v && 'Notification' in window) Notification.requestPermission();
  }

  setSoundEnabled(v: boolean) {
    this.settings.soundEnabled = v;
    this.save();
  }

  /** 任务完成通知 */
  notifyTaskComplete(title?: string, body?: string) {
    if (this.settings.desktopEnabled) this.doDesktopNotify(title, body);
    if (this.settings.soundEnabled) this.playCompleteSound();
  }

  /** 收到新消息通知(页面不可见时) */
  notifyNewMessage(sender: string, preview: string) {
    if (this.settings.desktopEnabled) {
      this.doDesktopNotify(`💬 ${sender}`, preview.slice(0, 100));
    }
    if (this.settings.soundEnabled) this.playMessageSound();
  }

  // ========== private ==========

  private async doDesktopNotify(title?: string, body?: string) {
    // Bug4 修复: Tauri 环境下用原生通知插件, 浏览器环境下用 Web Notification API
    const isTauri = !!(window as any).__TAURI__;
    const notifyTitle = title || '✅ 任务完成';
    const notifyBody = body || 'AI 已完成任务, 回到岐枢查看结果';

    if (isTauri) {
      // Tauri 2.x: 用原生通知插件
      try {
        const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
        let permission = await isPermissionGranted();
        if (!permission) permission = (await requestPermission()) === 'granted';
        if (permission) {
          await sendNotification({ title: notifyTitle, body: notifyBody });
          return;
        }
      } catch {
        // Tauri 插件不可用时 fallback 到 Web API
      }
    }

    // 浏览器环境: Web Notification API
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    // 前台时不弹
    if (document.visibilityState === 'visible') return;

    try {
      new Notification(notifyTitle, {
        body: notifyBody,
        icon: '/favicon.svg',
        tag: 'agentai-task-done',
      });
    } catch {}
  }

  private playCompleteSound() {
    try {
      if (!this.audioCtx) this.audioCtx = new AudioContext();
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      // 三音上升: C5 → E5 → G5 (完成感)
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = freq;
        const t = now + i * 0.12;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.3, t + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t); osc.stop(t + 0.4);
      });
    } catch {}
  }

  private playMessageSound() {
    try {
      if (!this.audioCtx) this.audioCtx = new AudioContext();
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'triangle'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now); osc.stop(now + 0.15);
    } catch {}
  }
}

export const taskNotifier = new TaskNotifierImpl();
