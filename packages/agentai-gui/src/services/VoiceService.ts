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

/** 停止当前播报并清空队列 */
export function stopTts(): void {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel();
  }
  currentUtterance = null;
  // 清空队列
  ttsQueue = [];
  isPlaying = false;
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

  // 匹配音色: 先直接匹配 (Microsoft 英文名), 再中文 ID 映射匹配
  if (options?.voice && speechSynthesis.getVoices().length > 0) {
    const allVoices = speechSynthesis.getVoices();
    let found = allVoices.find(
      v => v.name.includes(options.voice!) || v.voiceURI.includes(options.voice!),
    );
    if (!found) {
      const zhMap: Record<string, string[]> = {
        'zh-CN-XiaoxiaoNeural': ['Xiaoxiao', 'Huihui'],
        'zh-CN-YunxiNeural': ['Yunxi', 'Kangkang'],
        'zh-CN-YunjianNeural': ['Yunjian'],
        'zh-CN-XiaoyiNeural': ['Xiaoyi', 'Yaoyao'],
        'zh-CN-YunyangNeural': ['Yunyang'],
        'zh-CN-XiaochenNeural': ['Xiaochen'],
        'zh-CN-XiaohanNeural': ['Xiaohan'],
        'zh-CN-XiaomengNeural': ['Xiaomeng'],
        'zh-CN-YunfengNeural': ['Yunfeng'],
        'zh-CN-YunhaoNeural': ['Yunhao'],
        'zh-HK-HiuMaanNeural': ['HiuMaan'],
        'zh-HK-WanLungNeural': ['WanLung'],
        'zh-TW-HsiaoChenNeural': ['HsiaoChen'],
        'zh-TW-YunJheNeural': ['YunJhe'],
        'en-US-AriaNeural': ['Aria'],
        'en-US-GuyNeural': ['Guy'],
        'ja-JP-NanamiNeural': ['Nanami'],
        'ko-KR-SunHiNeural': ['SunHi'],
      };
      const keywords = zhMap[options.voice];
      if (keywords) {
        found = allVoices.find(v => keywords.some(k => v.name.includes(k)));
      }
    }
    if (found) utterance.voice = found;
  }

  currentUtterance = utterance;
  speechSynthesis.speak(utterance);
}

/** 播报队列，防止多个请求冲突 */
interface TtsQueueItem {
  text: string;
  options?: { rate?: number; pitch?: number; voiceName?: string };
}
let ttsQueue: TtsQueueItem[] = [];
let isPlaying = false;

/** 处理 TTS 队列 */
async function processTtsQueue() {
  if (isPlaying || ttsQueue.length === 0) return;
  isPlaying = true;

  while (ttsQueue.length > 0) {
    const item = ttsQueue.shift();
    if (!item) continue;
    await speakInternal(item.text, item.options);
  }

  isPlaying = false;
}

/** 内部播报实现 */
async function speakInternal(text: string, options?: { rate?: number; pitch?: number; voiceName?: string }): Promise<void> {
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

  // 读取用户选择的 TTS 引擎（默认 browser，避免后端依赖）
  let engine = 'browser';
  try {
    const saved = localStorage.getItem('agentai.tts.settings');
    if (saved) {
      const s = JSON.parse(saved);
      if (s.engine) engine = s.engine;
    }
  } catch {
    engine = 'browser';
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

  // 后端引擎 → 调用 API, 失败 fallback 到浏览器
  let selectedVoice = options?.voiceName;
  if (!selectedVoice) {
    try {
      const saved = localStorage.getItem('agentai.tts.settings');
      if (saved) selectedVoice = JSON.parse(saved).voice || undefined;
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
        await new Promise<void>((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          audio.play().catch(() => resolve());
        });
        return;
      }
      // 后端返回 JSON fallback
      const data = await resp.json();
      if (data.fallback === 'browser-api') {
        console.log('[VoiceService] 后端建议使用浏览器 TTS:', data.note);
        speakText(cleanText, { voice: options?.voiceName, rate: options?.rate, pitch: options?.pitch });
        return;
      }
    }
  } catch (e: any) {
    console.warn(`[VoiceService] ${engine} TTS 失败, fallback 到浏览器:`, e.message);
  }

  // Fallback: 浏览器 SpeechSynthesis
  speakText(cleanText, {
    voice: options?.voiceName,
    rate: options?.rate,
    pitch: options?.pitch,
  });
}

/** 播报文本 (根据用户选择的引擎, 失败 fallback 到浏览器) */
export async function speak(text: string, options?: { rate?: number; pitch?: number; voiceName?: string }): Promise<void> {
  // 🔧 修复: 调用方未传 voiceName 时, 自动从 localStorage 读取用户选择的音色
  // 这是 TTS 实际播报时使用默认音色 (而非测试音色) 的根因
  let voiceName = options?.voiceName;
  let rate = options?.rate;
  let pitch = options?.pitch;
  if (!voiceName) {
    try {
      const saved = localStorage.getItem('agentai.tts.settings');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.voice) voiceName = s.voice;
        if (rate === undefined && typeof s.rate === 'number') rate = s.rate;
        if (pitch === undefined && typeof s.pitch === 'number') pitch = s.pitch;
      }
    } catch {}
  }
  // 添加到队列并处理 (保留完整 options 以传递音色选择)
  ttsQueue.push({ text, options: { ...options, voiceName, rate, pitch } });
  await processTtsQueue();
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
    const profile = JSON.parse(localStorage.getItem('agentai-user-profile') || '{}');
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
