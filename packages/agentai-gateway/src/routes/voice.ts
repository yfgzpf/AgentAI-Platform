/**
 * Voice Routes — TTS / STT 语音服务
 *
 *   POST /v1/tts          文字 → 语音
 *   GET  /v1/tts/voices   可用音色列表
 *   POST /v1/stt          语音 → 文字
 *
 * 提供商支持:
 *   - agnes:   Agnes Audio 1.0 TTS (默认, 20种高品质音色, 免费)
 *   - moss:    本地 MOSS-TTS-Nano (语音克隆, 拟人口吻)
 *   - mimo:    小米MIMO商业TTS (高品质, 多种音色)
 *   - openai:  OpenAI 兼容 API
 *   - edge:    Microsoft Edge TTS
 *   - none:    使用浏览器 Web Speech API
 */
import { Router, type Request, type Response } from 'express';
import { mossTtsService } from '../moss-tts-service.js';
import { mimoTtsService } from '../mimo-tts-service.js';
import { synthesizeWithEdgeTTS, getEdgeTtsVoices, checkEdgeTtsAvailable } from '../edge-tts-service.js';
import * as fs from 'fs';
import * as path from 'path';

/* ===== 类型 ===== */
interface TtsConfig {
  provider: 'agnes' | 'moss' | 'mimo' | 'openai' | 'edge' | 'nvidia' | 'none';
  apiKey?: string;
  baseUrl?: string;
  voice?: string;
  model?: string;
}

function getTtsConfig(): TtsConfig {
  return {
    provider: (process.env.TTS_PROVIDER as TtsConfig['provider']) || 'edge', // 默认使用 Edge（多音色，免费）
    apiKey: process.env.TTS_API_KEY || '',
    baseUrl: process.env.TTS_BASE_URL || '',
    voice: process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural', // 默认中文女声
    model: process.env.TTS_MODEL || 'edge',
  };
}

/* ===== Router ===== */
export function createVoiceRouter(): Router {
  const r = Router();

  /**
   * POST /v1/tts — 文字转语音
   * Input:  { text, voice?, speed?, provider? }
   * Output: audio/wav (stream) 或 { audioBase64, ... }
   */
  r.post('/v1/tts', async (req: Request, res: Response) => {
    const config = getTtsConfig();
    const startTime = Date.now();

    try {
      const { text, voice, speed, provider } = req.body || {};
      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Missing required field: text' });
        return;
      }

      if (text.length > 5000) {
        res.status(400).json({ error: 'Text too long (max 5000 chars)' });
        return;
      }

      const effectiveProvider = provider || config.provider;

      // ====== MOSS (本地语音克隆) ======
      if (effectiveProvider === 'moss') {
        // 惰性启动: 首次使用 MOSS 时才启动服务
        if (!mossTtsService.isReady && mossTtsService.currentStatus === 'stopped') {
          console.log('[moss-tts] 首次使用, 惰性启动服务...');
          mossTtsService.start().catch((err: any) => {
            console.warn(`[moss-tts] 惰性启动失败: ${err.message}`);
          });
          res.json({
            fallback: 'browser-api',
            note: 'MOSS-TTS 服务正在启动中，请稍后再试...',
            text,
            duration: Date.now() - startTime,
          });
          return;
        }

        if (!mossTtsService.isReady) {
          res.json({
            fallback: 'browser-api',
            note: `MOSS-TTS 服务未就绪 (${mossTtsService.currentStatusMessage})`,
            text,
            duration: Date.now() - startTime,
          });
          return;
        }

        // voice 参数可以是 demo_id (如 demo-1) 或空 (使用默认音色)
        const demoId = (voice && voice.startsWith('demo-')) ? voice : '';
        const result = await mossTtsService.synthesize({
          text,
          demoId: demoId || undefined,
          maxNewFrames: 375,
        });

        const audioBuffer = Buffer.from(result.audioBase64, 'base64');
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('X-Duration-Ms', String(Date.now() - startTime));
        res.send(audioBuffer);
        return;
      }

      // ====== Agnes Audio TTS (支持多音色) ======
      if (effectiveProvider === 'agnes') {
        try {
          // Agnes 支持的标准 Azure TTS 音色
          const agnesVoices: Record<string, { shortName: string; locale: string }> = {
            // 中文音色
            'zh-CN-XiaoxiaoNeural': { shortName: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN' },
            'zh-CN-YunxiNeural': { shortName: 'zh-CN-YunxiNeural', locale: 'zh-CN' },
            'zh-CN-YunjianNeural': { shortName: 'zh-CN-YunjianNeural', locale: 'zh-CN' },
            'zh-CN-XiaoyiNeural': { shortName: 'zh-CN-XiaoyiNeural', locale: 'zh-CN' },
            'zh-CN-YunyangNeural': { shortName: 'zh-CN-YunyangNeural', locale: 'zh-CN' },
            'zh-CN-XiaochenNeural': { shortName: 'zh-CN-XiaochenNeural', locale: 'zh-CN' },
            'zh-CN-XiaohanNeural': { shortName: 'zh-CN-XiaohanNeural', locale: 'zh-CN' },
            'zh-CN-XiaomengNeural': { shortName: 'zh-CN-XiaomengNeural', locale: 'zh-CN' },
            'zh-CN-XiaomoNeural': { shortName: 'zh-CN-XiaomoNeural', locale: 'zh-CN' },
            'zh-CN-XiaoqiuNeural': { shortName: 'zh-CN-XiaoqiuNeural', locale: 'zh-CN' },
            'zh-CN-XiaoruiNeural': { shortName: 'zh-CN-XiaoruiNeural', locale: 'zh-CN' },
            'zh-CN-XiaoshuangNeural': { shortName: 'zh-CN-XiaoshuangNeural', locale: 'zh-CN' },
            'zh-CN-XiaoxuanNeural': { shortName: 'zh-CN-XiaoxuanNeural', locale: 'zh-CN' },
            'zh-CN-XiaoyanNeural': { shortName: 'zh-CN-XiaoyanNeural', locale: 'zh-CN' },
            'zh-CN-XiaoyouNeural': { shortName: 'zh-CN-XiaoyouNeural', locale: 'zh-CN' },
            'zh-CN-YunfengNeural': { shortName: 'zh-CN-YunfengNeural', locale: 'zh-CN' },
            'zh-CN-YunhaoNeural': { shortName: 'zh-CN-YunhaoNeural', locale: 'zh-CN' },
            'zh-CN-YunxiaNeural': { shortName: 'zh-CN-YunxiaNeural', locale: 'zh-CN' },
            'zh-CN-YunyeNeural': { shortName: 'zh-CN-YunyeNeural', locale: 'zh-CN' },
            'zh-CN-YunzeNeural': { shortName: 'zh-CN-YunzeNeural', locale: 'zh-CN' },
            // 粤语
            'zh-HK-HiuMaanNeural': { shortName: 'zh-HK-HiuMaanNeural', locale: 'zh-HK' },
            'zh-HK-WanLungNeural': { shortName: 'zh-HK-WanLungNeural', locale: 'zh-HK' },
            // 台湾腔
            'zh-TW-HsiaoChenNeural': { shortName: 'zh-TW-HsiaoChenNeural', locale: 'zh-TW' },
            'zh-TW-YunJheNeural': { shortName: 'zh-TW-YunJheNeural', locale: 'zh-TW' },
            // 英文
            'en-US-AriaNeural': { shortName: 'en-US-AriaNeural', locale: 'en-US' },
            'en-US-GuyNeural': { shortName: 'en-US-GuyNeural', locale: 'en-US' },
            'en-US-JennyNeural': { shortName: 'en-US-JennyNeural', locale: 'en-US' },
            'en-GB-SoniaNeural': { shortName: 'en-GB-SoniaNeural', locale: 'en-GB' },
            'en-GB-RyanNeural': { shortName: 'en-GB-RyanNeural', locale: 'en-GB' },
            // 日文
            'ja-JP-NanamiNeural': { shortName: 'ja-JP-NanamiNeural', locale: 'ja-JP' },
            'ja-JP-KeitaNeural': { shortName: 'ja-JP-KeitaNeural', locale: 'ja-JP' },
            // 韩文
            'ko-KR-SunHiNeural': { shortName: 'ko-KR-SunHiNeural', locale: 'ko-KR' },
            'ko-KR-InJoonNeural': { shortName: 'ko-KR-InJoonNeural', locale: 'ko-KR' },
          };

          // 解析 voice 参数
          let voiceConfig = agnesVoices['zh-CN-XiaoxiaoNeural']; // 默认音色
          if (voice && agnesVoices[voice]) {
            voiceConfig = agnesVoices[voice];
          } else if (voice && voice.startsWith('zh-')) {
            // 尝试匹配用户传入的音色
            const matched = Object.keys(agnesVoices).find(v => v.includes(voice) || voice.includes(v));
            if (matched) voiceConfig = agnesVoices[matched];
          }

          // 构建 SSML（支持情感/风格）
          const ssml = buildAgnesSsml(text, voiceConfig.shortName, voiceConfig.locale, speed);

          // 调用 Agnes TTS API（Azure TTS 兼容接口）
          const agnesKey = process.env.AGENTAI_API_KEY || config.apiKey || '';
          const agnesUrl = process.env.AGNES_TTS_URL || 'https://apihub.agnes-ai.com/v1/tts';

          const resp = await fetch(agnesUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/ssml+xml',
              'Authorization': `Bearer ${agnesKey}`,
              'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
            },
            body: ssml,
            signal: AbortSignal.timeout(30000),
          });

          if (!resp.ok) {
            const errText = await resp.text();
            console.error(`[agnes-tts] HTTP ${resp.status}: ${errText}`);
            // 降级到 Edge TTS
            throw new Error('Agnes TTS failed, fallback to Edge');
          }

          const audioBuffer = Buffer.from(await resp.arrayBuffer());
          res.setHeader('Content-Type', 'audio/wav');
          res.setHeader('X-Voice-Used', voiceConfig.shortName);
          res.setHeader('X-Duration-Ms', String(Date.now() - startTime));
          res.send(audioBuffer);
          return;

        } catch (agnesErr: any) {
          console.warn(`[agnes-tts] 失败: ${agnesErr.message}, 降级到 Edge TTS`);
          // 降级到 Edge TTS，但保留 voice 参数
          effectiveProvider = 'edge';
        }
      }

      // ====== NVIDIA NIM TTS (chatterbox-multilingual-tts, 免费) ======
      if (effectiveProvider === 'nvidia') {
        const nvidiaKey = process.env.NVIDIA_API_KEY || '';
        if (!nvidiaKey) {
          res.json({
            fallback: 'browser-api',
            note: 'NVIDIA API Key 未配置, 请在 .env 填 NVIDIA_API_KEY',
            text,
            duration: Date.now() - startTime,
          });
          return;
        }
        const nvidiaModel = process.env.NVIDIA_TTS_MODEL || 'resembleai/chatterbox-multilingual-tts';
        const resp = await fetch('https://integrate.api.nvidia.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${nvidiaKey}`,
          },
          body: JSON.stringify({
            model: nvidiaModel,
            input: text,
            voice: voice || 'default',
            response_format: 'wav',
            speed: speed || 1.0,
          }),
          signal: AbortSignal.timeout(60000),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          // NVIDIA TTS 可能不支持 /audio/speech 端点, 降级到浏览器 TTS
          res.json({
            fallback: 'browser-api',
            note: `NVIDIA TTS 返回 HTTP ${resp.status}: ${errText.slice(0, 100)}, 已降级到浏览器 TTS`,
            text,
            duration: Date.now() - startTime,
          });
          return;
        }

        const audioBuffer = Buffer.from(await resp.arrayBuffer());
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('X-Duration-Ms', String(Date.now() - startTime));
        res.send(audioBuffer);
        return;
      }

      // ====== 无提供商 → 通知前端用浏览器 API ======
      if (effectiveProvider === 'none') {
        res.json({
          fallback: 'browser-api',
          note: '未配置 TTS 提供商。前端已使用浏览器 SpeechSynthesis API。',
          text,
          duration: Date.now() - startTime,
        });
        return;
      }

      // ====== OpenAI 兼容 TTS ======
      if (effectiveProvider === 'openai') {
        const resp = await fetch(`${config.baseUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            input: text,
            voice: voice || config.voice || 'alloy',
            response_format: 'wav',
            speed: speed || 1.0,
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          res.status(resp.status).json({ error: 'TTS provider error', detail: errText });
          return;
        }

        const audioBuffer = Buffer.from(await resp.arrayBuffer());
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('X-Duration-Ms', String(Date.now() - startTime));
        res.send(audioBuffer);
        return;
      }

      // ====== MIMO TTS (小米商业TTS，高品质) ======
      if (effectiveProvider === 'mimo') {
        try {
          const status = mimoTtsService.getStatus();
          if (!status.available) {
            throw new Error(status.message);
          }

          const result = await mimoTtsService.synthesize({
            text,
            voice: voice || 'mimo-zhinv',
            speed: speed || 1.0,
          });

          const audioBuffer = Buffer.from(result.audioBase64, 'base64');

          res.setHeader('Content-Type', `audio/${result.format}`);
          res.setHeader('X-Voice-Used', voice || 'mimo-zhinv');
          res.setHeader('X-Duration-Ms', String(result.duration));
          res.setHeader('X-TTS-Provider', 'mimo');
          res.send(audioBuffer);
          return;
        } catch (mimoErr: any) {
          console.error(`[mimo-tts] 失败: ${mimoErr.message}`);
          // 降级到 Edge TTS
          res.json({
            fallback: 'edge',
            note: `MIMO TTS 失败: ${mimoErr.message}，请检查 MIMO_API_KEY 配置`,
            text,
            duration: Date.now() - startTime,
          });
          return;
        }
      }

      // ====== Edge TTS (使用 edge-tts Python 库，免费，40+音色) ======
      if (effectiveProvider === 'edge') {
        try {
          // 检查 edge-tts 是否可用
          const isAvailable = await checkEdgeTtsAvailable();
          if (!isAvailable) {
            throw new Error('edge-tts not installed. Run: pip install edge-tts');
          }

          // 使用 edge-tts 合成
          const rateStr = speed ? `${Math.round((speed - 1) * 100)}%` : '+0%';
          const audioBuffer = await synthesizeWithEdgeTTS(
            text,
            voice || 'zh-CN-XiaoxiaoNeural',
            rateStr
          );

          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('X-Voice-Used', voice || 'zh-CN-XiaoxiaoNeural');
          res.setHeader('X-Duration-Ms', String(Date.now() - startTime));
          res.send(audioBuffer);
          return;
        } catch (edgeErr: any) {
          console.error(`[edge-tts] 失败: ${edgeErr.message}`);
          // 降级到浏览器 TTS
          res.json({
            fallback: 'browser-api',
            note: `Edge TTS 失败: ${edgeErr.message}，已降级到浏览器 TTS`,
            text,
            duration: Date.now() - startTime,
          });
          return;
        }
      }

      res.status(501).json({ error: `TTS provider not implemented: ${effectiveProvider}` });
    } catch (err: any) {
      console.error(`[voice] TTS 错误: ${err.message}`);
      res.status(500).json({ error: 'TTS processing failed', detail: err.message });
    }
  });

  /**
   * GET /v1/tts/voices — 查询可用音色
   */
  r.get('/v1/tts/voices', async (_req: Request, res: Response) => {
    const voices: Array<{ id: string; name: string; gender: string; provider: string; locale?: string; style?: string }> = [];

    // Edge TTS 音色 (40+ 免费音色，通过 edge-tts Python 库)
    const edgeVoices = getEdgeTtsVoices();
    for (const v of edgeVoices) {
      voices.push({ ...v, provider: 'edge' });
    }

    // MOSS 音色（内置预设 + 服务就绪时额外音色克隆）
    try {
      const mossVoices = await mossTtsService.getVoices();
      for (const v of mossVoices) {
        voices.push({ ...v, provider: 'moss' });
      }
    } catch { /* MOSS 未就绪跳过 */ }

    // MIMO 音色（小米商业TTS）
    const mimoStatus = mimoTtsService.getStatus();
    for (const v of mimoTtsService.voices) {
      voices.push({ 
        id: v.id, 
        name: v.name, 
        gender: v.gender, 
        provider: 'mimo',
        style: v.description
      });
    }

    // NVIDIA TTS 音色
    voices.push(
      { id: 'default', name: 'Chatterbox Default', gender: 'neutral', provider: 'nvidia' },
      { id: 'en-US', name: 'Chatterbox EN', gender: 'neutral', provider: 'nvidia' },
      { id: 'zh-CN', name: 'Chatterbox 中文', gender: 'neutral', provider: 'nvidia' },
    );

    // Edge 音色
    voices.push(
      { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', gender: 'female', provider: 'edge' },
      { id: 'zh-CN-YunxiNeural', name: '云希', gender: 'male', provider: 'edge' },
      { id: 'zh-CN-YunyangNeural', name: '云扬', gender: 'male', provider: 'edge' },
    );

    res.json({ voices });
  });

  /**
   * GET /v1/tts/moss/status — MOSS-TTS 状态查询（含下载进度）
   */
  r.get('/v1/tts/moss/status', (_req: Request, res: Response) => {
    const dl = mossTtsService.downloadStatus;
    const modelExist = mossTtsService.checkModelsExist();
    res.json({
      serviceStatus: mossTtsService.currentStatus,
      serviceMessage: mossTtsService.currentStatusMessage,
      ready: mossTtsService.isReady,
      download: {
        phase: dl.phase,
        progress: dl.progress,
        message: dl.message,
        error: dl.error,
      },
      modelsExist: modelExist,
    });
  });

  /**
   * POST /v1/stt — 语音转文字
   */
  r.post('/v1/stt', async (req: Request, res: Response) => {
    const config = getTtsConfig();
    const startTime = Date.now();

    try {
      let audioBuffer: Buffer;
      let contentType: string;

      if (req.is('multipart/form-data')) {
        const file = (req as any).file || (req.files as any)?.[0];
        if (!file) {
          res.status(400).json({ error: 'No audio file provided' });
          return;
        }
        audioBuffer = file.buffer;
        contentType = file.mimetype || 'audio/wav';
      } else if (Buffer.isBuffer(req.body)) {
        audioBuffer = req.body;
        contentType = req.headers['content-type'] || 'audio/wav';
      } else {
        res.status(400).json({ error: 'No audio data provided. Send raw audio or multipart file.' });
        return;
      }

      if (config.provider === 'none' || !config.apiKey) {
        res.json({
          text: '',
          note: '未配置 STT 提供商。前端已使用浏览器 Web Speech API 作为备用。',
          fallback: 'browser-api',
          duration: Date.now() - startTime,
        });
        return;
      }

      if (config.provider === 'openai') {
        const formData = new FormData();
        const blob = new Blob([audioBuffer], { type: contentType });
        formData.append('file', blob, `audio.${contentType.split('/')[1] || 'wav'}`);
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');

        const resp = await fetch(`${config.baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${config.apiKey}` },
          body: formData,
        });

        if (!resp.ok) {
          const errText = await resp.text();
          res.status(resp.status).json({ error: 'STT provider error', detail: errText, duration: Date.now() - startTime });
          return;
        }

        const data = await resp.json() as { text?: string; confidence?: number };
        res.json({ text: data.text || '', confidence: data.confidence || undefined, provider: config.provider, duration: Date.now() - startTime });
        return;
      }

      res.status(501).json({ error: 'STT not supported by configured provider', fallback: 'browser-api' });
    } catch (err: any) {
      res.status(500).json({ error: 'STT processing failed', detail: err.message, duration: Date.now() - startTime });
    }
  });

  return r;
}

/* ===== Helpers ===== */

function buildEdgeSsml(text: string, lang: string, voiceName: string, speed?: number): string {
  const rate = speed ? `${Math.round((speed - 1) * 100)}%` : '0%';
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">
    <voice name="${voiceName}">
      <prosody rate="${rate}">${escapeXml(text)}</prosody>
    </voice>
  </speak>`;
}

/**
 * 构建 Agnes/Azure TTS SSML
 * 支持情感、风格、角色扮演等高级功能
 */
function buildAgnesSsml(text: string, voiceName: string, locale: string, speed?: number, style?: string): string {
  const rate = speed ? `${Math.round((speed - 1) * 100)}%` : '0%';
  
  // 根据音色选择合适的风格
  const defaultStyles: Record<string, string> = {
    'zh-CN-XiaoxiaoNeural': 'general',
    'zh-CN-YunxiNeural': 'general',
    'zh-CN-YunjianNeural': 'news',
    'zh-CN-XiaoyiNeural': 'gentle',
    'zh-CN-YunyangNeural': 'professional',
    'zh-CN-XiaochenNeural': 'lively',
  };
  
  const effectiveStyle = style || defaultStyles[voiceName] || 'general';
  
  // 构建带风格的 SSML
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" 
    xmlns:mstts="https://www.w3.org/2001/mstts" 
    xml:lang="${locale}">
    <voice name="${voiceName}">
      <mstts:express-as style="${effectiveStyle}">
        <prosody rate="${rate}">${escapeXml(text)}</prosody>
      </mstts:express-as>
    </voice>
  </speak>`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
