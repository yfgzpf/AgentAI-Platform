/**
 * Voice Service — TTS/STT 语音服务
 *   - STT: 优先使用浏览器 Web Speech API (SpeechRecognition)
 *          后端 API (/v1/stt) 作为高精度备用
 *   - TTS: 优先使用浏览器 SpeechSynthesis API
 *          后端 API (/v1/tts) 作为高质量备用
 */
/* ===== STT: 语音 → 文字 ===== */

export interface SttOptions {
  /** 语言 (默认 'zh-CN') */
  lang?: string;
  /** 是否持续识别 (默认 false, 单次) */
  continuous?: boolean;
  /** 是否返回中间结果 (默认 true) */
  interim?: boolean;
}

export interface SttResult {
  text: string;
  final: boolean;
  confidence?: number;
}

type SttCallback = (result: SttResult) => void;

let recognitionInstance: any = null;

/**
 * 检测浏览器是否支持 SpeechRecognition
 */
export function isSpeechRecognitionSupported(): boolean {
  const w = window as any;
  return !!(
    w.SpeechRecognition ||
    w.webkitSpeechRecognition ||
    w.mozSpeechRecognition ||
    w.msSpeechRecognition
  );
}

/**
 * 启动语音识别 (浏览器 Web Speech API)
 * 返回停止函数
 */
export function startSpeechRecognition(
  onResult: SttCallback,
  onError?: (err: string) => void,
  options?: SttOptions,
): () => void {
  const w = window as any;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) {
    onError?.('浏览器不支持语音识别');
    return () => {};
  }

  const recognition = new SR();
  recognition.lang = options?.lang || 'zh-CN';
  recognition.continuous = options?.continuous ?? false;
  recognition.interimResults = options?.interim ?? true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      const final = event.results[i].isFinal;
      const confidence = event.results[i][0].confidence;
      onResult({ text: transcript, final, confidence });
    }
  };

  recognition.onerror = (event: any) => {
    onError?.(`语音识别错误: ${event.error}`);
    recognition.stop();
  };

  recognition.onend = () => {
    recognitionInstance = null;
  };

  recognition.start();
  recognitionInstance = recognition;

  return () => {
    try { recognition.stop(); } catch { /* ignore */ }
    recognitionInstance = null;
  };
}

/**
 * 停止当前语音识别
 */
export function stopSpeechRecognition(): void {
  if (recognitionInstance) {
    try { recognitionInstance.stop(); } catch { /* ignore */ }
    recognitionInstance = null;
  }
}

/**
 * 使用后端 API 进行高精度 STT
 */
export async function sttWithApi(audioBlob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', audioBlob, `recording.${audioBlob.type.split('/')[1] || 'wav'}`);

  const resp = await fetch('/v1/stt', {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`STT API error: ${err}`);
  }

  const data = await resp.json();
  return data.text || '';
}

/* ===== TTS: 文字 → 语音 ===== */

let ttsQueue: string[] = [];
let ttsPlaying = false;

/**
 * 检测浏览器是否支持 SpeechSynthesis
 */
export function isSpeechSynthesisSupported(): boolean {
  return 'speechSynthesis' in window;
}

/**
 * 使用浏览器 SpeechSynthesis 朗读文本
 */
export function speakText(
  text: string,
  options?: {
    lang?: string;
    rate?: number;
    pitch?: number;
    voice?: string;
    onDone?: () => void;
  },
): void {
  if (!window.speechSynthesis) return;

  // 取消当前朗读
  window.speechSynthesis.cancel();

  // 分割长文本 (浏览器有长度限制)
  const chunks = splitText(text, 200);
  let idx = 0;

  const speakChunk = () => {
    if (idx >= chunks.length) {
      options?.onDone?.();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[idx]);
    utterance.lang = options?.lang || 'zh-CN';
    utterance.rate = options?.rate ?? 1.0;
    utterance.pitch = options?.pitch ?? 1.0;

    // 匹配音色
    if (options?.voice && window.speechSynthesis.getVoices().length > 0) {
      const found = window.speechSynthesis.getVoices().find(
        v => v.name.includes(options.voice!) || v.voiceURI.includes(options.voice!),
      );
      if (found) utterance.voice = found;
    }

    utterance.onend = () => {
      idx++;
      speakChunk();
    };

    utterance.onerror = () => {
      idx++;
      speakChunk();
    };

    window.speechSynthesis.speak(utterance);
  };

  speakChunk();
}

/**
 * 停止朗读
 */
export function stopSpeaking(): void {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  ttsPlaying = false;
  ttsQueue = [];
}

/**
 * 使用后端 API 获取高质量 TTS 音频并播放
 */
export async function speakWithApi(text: string, voice?: string): Promise<void> {
  const resp = await fetch('/v1/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    // Fallback: 使用浏览器 TTS
    speakText(text);
    throw new Error(`TTS API error: ${err}`);
  }

  const contentType = resp.headers.get('Content-Type') || '';
  if (contentType.includes('json')) {
    // 后端返回 fallback 建议，使用浏览器 TTS
    const data = await resp.json();
    if (data.fallback === 'browser-api') {
      speakText(text);
      return;
    }
    throw new Error(`TTS error: ${JSON.stringify(data)}`);
  }

  // Play audio
  const audioBlob = await resp.blob();
  const url = URL.createObjectURL(audioBlob);
  const audio = new Audio(url);

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Audio playback failed')); };
    audio.play();
  });
}

/* ===== Helpers ===== */

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLen;
    if (end < text.length) {
      // 在标点处分割
      const punct = text.slice(end - 20, end).match(/[。！？.!?\n]/);
      if (punct) {
        end = end - 20 + (punct.index || 20) + 1;
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * 获取浏览器可用语音列表
 */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}
