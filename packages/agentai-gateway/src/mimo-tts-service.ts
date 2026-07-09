/**
 * MIMO TTS Service - 小米MIMO商业TTS服务
 * 
 * 支持：
 * - 高品质语音合成
 * - 多种音色选择
 * - 长文本自动分段
 * 
 * API文档：https://api.xiaomimimo.com/v1
 */

import { OpenAI } from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface MimoTtsOptions {
  text: string;
  voice?: string;  // 音色ID
  speed?: number;  // 语速 0.5-2.0
  pitch?: number;  // 音调 0.5-2.0
  volume?: number; // 音量 0.5-2.0
}

export interface MimoTtsResult {
  audioBase64: string;
  audioUrl?: string;
  duration: number;
  format: string;
  sampleRate: number;
}

export class MimoTtsService {
  private client: OpenAI | null = null;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  
  // 可用音色列表
  public readonly voices = [
    { id: 'mimo-zhinan', name: '米男', gender: 'male', description: '成熟稳重男声' },
    { id: 'mimo-zhinv', name: '米女', gender: 'female', description: '温柔知性女声' },
    { id: 'mimo-yujie', name: '御姐', gender: 'female', description: '成熟魅力女声' },
    { id: 'mimo-qingnian', name: '青年', gender: 'male', description: '阳光活力男声' },
    { id: 'mimo-shaonv', name: '少女', gender: 'female', description: '甜美可爱女声' },
    { id: 'mimo-laonian', name: '老年', gender: 'male', description: '慈祥老年男声' },
    { id: 'mimo-tongnian', name: '童年', gender: 'female', description: '天真童声' },
    { id: 'mimo-dianshang', name: '电商', gender: 'female', description: '专业电商主播声' },
  ];

  // 内置专用密钥
  private readonly BUILT_IN_API_KEY = 'sk-cp5szr1336c4uhfnwdbjpl4p8x9ydelvaz6wl42qv57vne49';

  constructor() {
    // 优先使用环境变量，否则使用内置密钥
    this.apiKey = process.env.MIMO_API_KEY || this.BUILT_IN_API_KEY;
    this.baseUrl = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1';
    this.model = process.env.MIMO_MODEL || 'mimo-tts-v2.5';
    
    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseUrl,
      });
    }
  }

  /**
   * 检查服务是否可用
   */
  get isAvailable(): boolean {
    return !!this.client && !!this.apiKey;
  }

  /**
   * 获取服务状态
   */
  getStatus(): { available: boolean; message: string } {
    if (!this.apiKey) {
      return { 
        available: false, 
        message: '未配置 MIMO_API_KEY 环境变量' 
      };
    }
    if (!this.client) {
      return { 
        available: false, 
        message: 'MIMO 客户端初始化失败' 
      };
    }
    return { 
      available: true, 
      message: 'MIMO TTS 服务就绪' 
    };
  }

  /**
   * 合成语音
   */
  async synthesize(options: MimoTtsOptions): Promise<MimoTtsResult> {
    if (!this.client) {
      throw new Error('MIMO TTS 服务未初始化');
    }

    const { text, voice = 'mimo-zhinv', speed = 1.0, pitch = 1.0, volume = 1.0 } = options;

    // 限制文本长度（MIMO有长度限制）
    const maxLength = 1000;
    const truncatedText = text.length > maxLength ? text.slice(0, maxLength) + '...' : text;

    try {
      const startTime = Date.now();

      // 调用MIMO TTS API
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: truncatedText,
          }
        ],
        extra_body: {
          tts_options: {
            voice: voice,
            speed: speed,
            pitch: pitch,
            volume: volume,
            format: 'mp3',
            sample_rate: 24000,
          }
        }
      });

      // 从响应中提取音频数据
      // 注意：实际API响应格式可能需要根据MIMO文档调整
      const audioData = await this.extractAudioFromResponse(completion);

      return {
        audioBase64: audioData.base64,
        duration: Date.now() - startTime,
        format: 'mp3',
        sampleRate: 24000,
      };

    } catch (error: any) {
      console.error('[MIMO TTS] 合成失败:', error);
      throw new Error(`MIMO TTS 合成失败: ${error.message}`);
    }
  }

  /**
   * 从API响应中提取音频数据
   * 注意：这里需要根据实际MIMO API响应格式调整
   */
  private async extractAudioFromResponse(completion: any): Promise<{ base64: string; url?: string }> {
    // 如果MIMO返回的是base64编码的音频
    if (completion.audio?.data) {
      return { base64: completion.audio.data };
    }

    // 如果MIMO返回的是音频URL
    if (completion.audio?.url) {
      // 下载音频并转换为base64
      const audioUrl = completion.audio.url;
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return { base64, url: audioUrl };
    }

    // 如果响应中包含choices（OpenAI标准格式）
    if (completion.choices?.[0]?.message?.audio?.data) {
      return { base64: completion.choices[0].message.audio.data };
    }

    throw new Error('无法从响应中提取音频数据');
  }

  /**
   * 流式合成（用于长文本）
   */
  async *synthesizeStream(options: MimoTtsOptions): AsyncGenerator<Buffer> {
    const { text, voice = 'mimo-zhinv' } = options;
    
    // 将长文本分段
    const segments = this.segmentText(text, 500);
    
    for (const segment of segments) {
      const result = await this.synthesize({
        text: segment,
        voice,
      });
      
      yield Buffer.from(result.audioBase64, 'base64');
    }
  }

  /**
   * 文本分段
   */
  private segmentText(text: string, maxLength: number): string[] {
    const segments: string[] = [];
    const sentences = text.split(/([。！？.!?])/);
    
    let currentSegment = '';
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if ((currentSegment + sentence).length > maxLength && currentSegment.length > 0) {
        segments.push(currentSegment.trim());
        currentSegment = sentence;
      } else {
        currentSegment += sentence;
      }
    }
    
    if (currentSegment.trim()) {
      segments.push(currentSegment.trim());
    }
    
    return segments;
  }

  /**
   * 获取可用音色列表
   */
  getVoices() {
    return this.voices;
  }

  /**
   * 预览音色（生成示例音频）
   */
  async previewVoice(voiceId: string): Promise<MimoTtsResult> {
    const sampleText = '你好，我是小米MIMO语音助手，很高兴为您服务。';
    return this.synthesize({
      text: sampleText,
      voice: voiceId,
    });
  }
}

// 单例导出
export const mimoTtsService = new MimoTtsService();
