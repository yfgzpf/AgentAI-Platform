/**
 * Voice Wake — 语音唤醒服务
 * 使用浏览器 Web Speech API 持续监听唤醒词
 *
 * 工作方式:
 *   - 后台运行连续语音识别
 *   - 检测到唤醒词时触发回调
 *   - 支持自定义唤醒词和灵敏度调节
 */
import { startSpeechRecognition, stopSpeechRecognition } from './voice';

/* ===== 类型定义 ===== */
export interface WakeConfig {
  /** 唤醒词 (默认 '你好') */
  keyword: string;
  /** 灵敏度 0-1 (默认 0.5, 越低越容易触发) */
  sensitivity: number;
  /** 是否启用 */
  enabled: boolean;
}

export type WakeState = 'idle' | 'listening' | 'triggered';

type WakeCallback = (state: WakeState, transcript?: string) => void;

/* ===== 默认配置 ===== */
const DEFAULT_CONFIG: WakeConfig = {
  keyword: '你好',
  sensitivity: 0.5,
  enabled: false,
};

/* ===== 状态 ===== */
let config: WakeConfig = { ...DEFAULT_CONFIG };
let state: WakeState = 'idle';
let stopListening: (() => void) | null = null;
let callback: WakeCallback | null = null;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

/* ===== 配置管理 ===== */
export function getWakeConfig(): WakeConfig {
  return { ...config };
}

export function setWakeConfig(partial: Partial<WakeConfig>): void {
  config = { ...config, ...partial };
  // 如果正在运行且配置变更，重启监听
  if (state === 'listening' && stopListening) {
    restartListening();
  }
}

/* ===== 回调注册 ===== */
export function onWakeEvent(cb: WakeCallback): void {
  callback = cb;
}

/* ===== 启动唤醒监听 ===== */
export function startWakeListening(): void {
  if (state === 'listening' || !config.enabled) return;

  state = 'listening';
  callback?.('listening');

  stopListening = startSpeechRecognition(
    (result) => {
      if (result.final && result.text) {
        checkWakeWord(result.text);
      }
    },
    (err) => {
      console.warn('[Wake] Error:', err);
      state = 'idle';
      callback?.('idle');
      // 自动重试 (3秒后)
      if (config.enabled) {
        setTimeout(startWakeListening, 3000);
      }
    },
    {
      lang: 'zh-CN',
      continuous: true,
      interim: false,
    },
  );
}

/* ===== 停止唤醒监听 ===== */
export function stopWakeListening(): void {
  if (stopListening) {
    stopListening();
    stopListening = null;
  }
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  state = 'idle';
  callback?.('idle');
}

/* ===== 重启 ===== */
function restartListening(): void {
  stopWakeListening();
  if (config.enabled) {
    startWakeListening();
  }
}

/* ===== 唤醒词检测 ===== */
function checkWakeWord(transcript: string): void {
  if (!config.keyword) return;

  const lowerTranscript = transcript.toLowerCase();
  const lowerKeyword = config.keyword.toLowerCase();

  // 精确匹配
  if (lowerTranscript.includes(lowerKeyword)) {
    triggerWake(transcript);
    return;
  }

  // 模糊匹配 (灵敏度控制)
  if (config.sensitivity < 1) {
    // 计算编辑距离或子串匹配
    const words = lowerTranscript.split(/[\s,，。.！？!?]+/);
    for (const word of words) {
      const dist = levenshteinDistance(word, lowerKeyword);
      const maxLen = Math.max(word.length, lowerKeyword.length);
      const similarity = maxLen > 0 ? 1 - dist / maxLen : 0;
      if (similarity >= config.sensitivity) {
        triggerWake(transcript);
        return;
      }
    }
  }
}

/* ===== 触发唤醒 ===== */
function triggerWake(transcript: string): void {
  state = 'triggered';
  callback?.('triggered', transcript);

  // 3秒后自动回到监听状态
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    if (config.enabled && state === 'triggered') {
      state = 'listening';
      callback?.('listening');
    }
  }, 3000);
}

/* ===== 工具函数 ===== */

/**
 * 编辑距离 (Levenshtein Distance)
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // 删除
          dp[i][j - 1] + 1,     // 插入
          dp[i - 1][j - 1] + 1, // 替换
        );
      }
    }
  }
  return dp[m][n];
}
