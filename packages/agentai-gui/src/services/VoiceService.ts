/**
 * VoiceService — AI语音播报服务
 *   - TTS (Text-to-Speech): 使用浏览器 Web Speech API
 *   - 语音唤醒: 使用 Web Speech Recognition API
 *   - 拟人化回复: 识别用户名称, 回复"在的"
 *   - 开关控制: 全局播报开关
 */

// ═══ TTS 播报 ═══

let ttsEnabled = false;
let currentUtterance: SpeechSynthesisUtterance | null = null;

/** 获取或设置TTS开关状态 */
export function isTtsEnabled(): boolean {
  return ttsEnabled;
}

export function setTtsEnabled(enabled: boolean): void {
  ttsEnabled = enabled;
  if (!enabled) {
    stopTts();
  }
  // 持久化到 localStorage
  try { localStorage.setItem('agentai.tts.enabled', enabled ? '1' : '0'); } catch {}
}

/** 初始化时读取持久化状态 */
try {
  const saved = localStorage.getItem('agentai.tts.enabled');
  if (saved === '1') ttsEnabled = true;
} catch {}

/** 停止当前播报 */
export function stopTts(): void {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel();
  }
  currentUtterance = null;
}

/** 浏览器 SpeechSynthesis 播报 */
function speakText(text: string, options?: { voice?: string; rate?: number; pitch?: number }): void {
  if (typeof speechSynthesis === 'undefined') return;
  stopTts();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options?.rate ?? 1.1;
  utterance.pitch = options?.pitch ?? 1.0;
  utterance.volume = 0.9;
  utterance.lang = 'zh-CN';

  if (options?.voice || typeof speechSynthesis !== 'undefined') {
    const voices = speechSynthesis.getVoices();
    const zhVoice = voices.find(v =>
      v.lang.startsWith('zh') && (v.localService || v.name.includes('Google'))
    );
    if (zhVoice) utterance.voice = zhVoice;
  }

  currentUtterance = utterance;
  speechSynthesis.speak(utterance);
}

/** 播报文本 (根据用户选择的引擎, 失败 fallback 到浏览器) */
export async function speak(text: string, options?: { rate?: number; pitch?: number; voiceName?: string }): Promise<void> {
  if (!ttsEnabled) return;

  const cleanText = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-*]\s/g, '')
    .replace(/\n{2,}/g, '。')
    .replace(/\n/g, '，')
    .trim();

  if (!cleanText) return;

  // 读取用户选择的 TTS 引擎（默认 Agnes，支持多音色）
  let engine = 'agnes';
  try {
    const saved = localStorage.getItem('agentai.tts.settings');
    if (saved) {
      const s = JSON.parse(saved);
      if (s.engine) engine = s.engine;
    }
  } catch {
    // 默认使用 Agnes，支持 40+ 音色
    engine = 'agnes';
  }

  // 浏览器引擎 → 直接用 SpeechSynthesis
  if (engine === 'browser') {
    speakText(cleanText, {
      voice: options?.voiceName,
      rate: options?.rate ?? 1.1,
      pitch: options?.pitch ?? 1.0,
    });
    return;
  }

  // 后端引擎 (agnes/moss) → 调用 API, 失败 fallback 到浏览器
  // 读取用户选择的音色
  let selectedVoice = options?.voiceName;
  if (!selectedVoice) {
    try {
      selectedVoice = localStorage.getItem('agentai.tts.voice') || undefined;
    } catch {}
  }

  try {
    const resp = await fetch('/v1/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanText,
        provider: engine,
        voice: selectedVoice,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (resp.ok) {
      const contentType = resp.headers.get('Content-Type') || '';
      if (contentType.includes('audio')) {
        const audioBlob = await resp.blob();
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        audio.volume = 0.9;
        await audio.play().catch(() => {});
        URL.revokeObjectURL(url);
        return;
      }
    }
  } catch (e: any) {
    console.debug(`[VoiceService] ${engine} TTS 失败, fallback 到浏览器:`, e.message);
  }

  // Fallback: 浏览器 SpeechSynthesis
  speakText(cleanText, {
    voice: options?.voiceName,
    rate: options?.rate,
    pitch: options?.pitch,
  });
}

/** 检查是否正在播报 */
export function isSpeaking(): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  return speechSynthesis.speaking;
}

// ═══ 语音唤醒 ═══

let recognition: any = null;
let wakeEnabled = false;
let wakeCallback: ((transcript: string) => void) | null = null;

/** 唤醒词列表 (基础) */
const BASE_WAKE_WORDS = ['小助手', '小A', 'AI', '你好', '嘿'];

/** 获取完整唤醒词列表 (包含用户名) */
export function getWakeWords(): string[] {
  const words = [...BASE_WAKE_WORDS];
  // 从 profile store 读取用户名作为唤醒词
  try {
    const profile = JSON.parse(localStorage.getItem('agentai-profile') || '{}');
    if (profile.name) {
      words.push(profile.name);
    }
  } catch {}
  return words;
}

/** 初始化语音识别 */
export function initWakeWord(callback: (transcript: string) => void): void {
  wakeCallback = callback;

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[VoiceService] 浏览器不支持语音识别');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'zh-CN';

  recognition.onresult = (event: any) => {
    const last = event.results[event.results.length - 1];
    if (last.isFinal) {
      const transcript = last[0].transcript.trim();
      console.log('[VoiceService] 识别到:', transcript);

      // 检测唤醒词 (动态获取, 包含用户名)
      const wakeWords = getWakeWords();
      const isWake = wakeWords.some(w => transcript.includes(w));
      if (isWake && wakeCallback) {
        wakeCallback(transcript);
      }
    }
  };

  recognition.onerror = (event: any) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      console.warn('[VoiceService] 识别错误:', event.error);
    }
  };

  recognition.onend = () => {
    // 自动重启 (如果仍然启用)
    if (wakeEnabled && recognition) {
      try { recognition.start(); } catch {}
    }
  };
}

/** 开启语音唤醒 */
export function startWakeWord(): void {
  if (!recognition) return;
  wakeEnabled = true;
  try { recognition.start(); } catch {}
  try { localStorage.setItem('agentai.wake.enabled', '1'); } catch {}
}

/** 关闭语音唤醒 */
export function stopWakeWord(): void {
  if (!recognition) return;
  wakeEnabled = false;
  try { recognition.stop(); } catch {}
  try { localStorage.setItem('agentai.wake.enabled', '0'); } catch {}
}

export function isWakeEnabled(): boolean {
  return wakeEnabled;
}

// ═══ 拟人化回复 ═══

/** 从用户消息中提取用户名称 */
export function extractUserName(text: string): string | null {
  // 匹配 "我是XXX", "我叫XXX", "我叫XXX吧"
  const nameMatch = text.match(/(?:我是|我叫|名字是|叫我)\s*([^\s,，。！!？?]{1,8})/);
  if (nameMatch) return nameMatch[1];
  return null;
}

/** 生成拟人化回复 */
export function generateHumanLikeResponse(userName?: string): string {
  const greetings = userName
    ? [`在的，${userName}！有什么需要帮忙的吗？`, `${userName}，我在呢！`, `嗯，${userName}，请说！`]
    : ['在的！有什么需要帮忙的吗？', '我在呢！', '嗯，请说！'];
  return greetings[Math.floor(Math.random() * greetings.length)];
}
