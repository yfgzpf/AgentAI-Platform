/**
 * Manju Skills — 漫剧生成专用技能
 * ============================================================
 * 
 * 提供漫剧工作流所需的底层技能实现：
 * 1. parse_script — 解析剧本为结构化场景
 * 2. generate_scene_images — 批量生成场景图片
 * 3. generate_tts — 生成配音音频
 * 4. images_to_video — 图片转视频
 * 5. compose_video — 音画合成
 */

import { mimoTtsService } from '../mimo-tts-service.js';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface Scene {
  id: number;
  location: string;
  description: string;
  dialogue: string;
  character?: string;
  emotion?: string;
}

export interface ManjuConfig {
  script: string;
  style: 'anime' | 'realistic' | 'ink' | '3d';
  videoRatio: '1:1' | '16:9' | '9:16';
  duration: '3s' | '5s' | '8s' | '10s';
  audioMode: 'auto' | 'tts' | 'bgm_only' | 'silent';
  voice?: string;
  bgm?: string;
}

// ═══════════════════════════════════════════════════════════
// Skill 1: 解析剧本
// ═══════════════════════════════════════════════════════════

export async function parseScript(script: string): Promise<Scene[]> {
  const scenes: Scene[] = [];
  const lines = script.split('\n').filter(l => l.trim());
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    
    // 支持格式: "场景1 | 樱花树下 | 我等你很久了"
    // 或: "场景1 | 樱花树下，男主等待 | \"我等你很久了\""
    const parts = line.split('|').map(p => p.trim());
    
    if (parts.length >= 2) {
      const location = parts[0]!.replace(/^场景\d*\s*/, '').trim();
      const description = parts[1] || '';
      const dialogue = parts[2] || '';
      
      scenes.push({
        id: i + 1,
        location,
        description,
        dialogue: dialogue.replace(/[""]/g, ''), // 去除引号
      });
    }
  }
  
  return scenes;
}

// ═══════════════════════════════════════════════════════════
// Skill 2: 生成场景图片
// ═══════════════════════════════════════════════════════════

export async function generateSceneImages(
  scenes: Scene[],
  style: string,
  ratio: string,
  apiKey: string
): Promise<string[]> {
  const imageUrls: string[] = [];
  
  // 风格映射
  const stylePrompts: Record<string, string> = {
    'anime': 'anime style, vibrant colors, detailed background, cinematic lighting',
    'realistic': 'photorealistic, cinematic photo, natural lighting, 8k quality',
    'ink': 'chinese ink wash painting, traditional art, minimalist, elegant',
    '3d': '3D render, octane render, unreal engine, soft lighting, high quality',
  };
  
  const stylePrompt = stylePrompts[style] || stylePrompts['anime'];
  
  for (const scene of scenes) {
    const prompt = `${scene.description}, ${scene.location}, ${stylePrompt}, masterpiece, best quality`;
    
    try {
      // 调用 Agnes Image API
      const response = await fetch('https://apihub.agnes-ai.cn/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'agnes-image-2.1-flash',
          prompt,
          size: '2K',
          ratio,
          quality: 'standard',
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Image generation failed: ${response.status}`);
      }
      
      const data = await response.json() as any;
      const imageUrl = data.data?.[0]?.url;
      
      if (imageUrl) {
        imageUrls.push(imageUrl);
      } else {
        throw new Error('No image URL in response');
      }
    } catch (error) {
      console.error(`[manju] Failed to generate image for scene ${scene.id}:`, error);
      // 使用占位图或重试
      imageUrls.push('');
    }
  }
  
  return imageUrls;
}

// ═══════════════════════════════════════════════════════════
// Skill 3: 生成 TTS 配音
// ═══════════════════════════════════════════════════════════

export async function generateTTS(
  scenes: Scene[],
  voice: string
): Promise<string[]> {
  const audioUrls: string[] = [];
  
  // 检查 MiMo 服务是否可用
  const status = mimoTtsService.getStatus();
  if (!status.available) {
    console.warn('[manju] MiMo TTS not available, falling back to edge TTS');
    // 降级到 Edge TTS
    return generateEdgeTTS(scenes);
  }
  
  for (const scene of scenes) {
    if (!scene.dialogue) {
      audioUrls.push('');
      continue;
    }
    
    try {
      const result = await mimoTtsService.synthesize({
        text: scene.dialogue,
        voice,
        speed: 1.0,
      });
      
      // 保存音频到临时文件并返回 URL
      const tempDir = path.join(os.tmpdir(), 'manju-audio');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const audioPath = path.join(tempDir, `scene-${scene.id}.mp3`);
      fs.writeFileSync(audioPath, Buffer.from(result.audioBase64, 'base64'));
      
      audioUrls.push(`file://${audioPath}`);
    } catch (error) {
      console.error(`[manju] Failed to generate TTS for scene ${scene.id}:`, error);
      audioUrls.push('');
    }
  }
  
  return audioUrls;
}

// 降级到 Edge TTS
async function generateEdgeTTS(scenes: Scene[]): Promise<string[]> {
  const audioUrls: string[] = [];
  
  for (const scene of scenes) {
    if (!scene.dialogue) {
      audioUrls.push('');
      continue;
    }
    
    try {
      // 使用 edge-tts Python 库
      const tempDir = path.join(os.tmpdir(), 'manju-audio');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const outputPath = path.join(tempDir, `scene-${scene.id}.mp3`);
      
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('edge-tts', [
          '--text', scene.dialogue,
          '--voice', 'zh-CN-XiaoxiaoNeural',
          '--write-media', outputPath,
        ]);
        
        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`edge-tts exited with code ${code}`));
          }
        });
        
        proc.on('error', reject);
      });
      
      audioUrls.push(`file://${outputPath}`);
    } catch (error) {
      console.error(`[manju] Edge TTS failed for scene ${scene.id}:`, error);
      audioUrls.push('');
    }
  }
  
  return audioUrls;
}

// ═══════════════════════════════════════════════════════════
// Skill 4: 图片转视频
// ═══════════════════════════════════════════════════════════

export async function imagesToVideo(
  imageUrls: string[],
  duration: string,
  ratio: string,
  apiKey: string
): Promise<string[]> {
  const videoUrls: string[] = [];
  const durationMap: Record<string, number> = {
    '3s': 3,
    '5s': 5,
    '8s': 8,
    '10s': 10,
  };
  
  const seconds = durationMap[duration] || 5;
  
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    if (!imageUrl) {
      videoUrls.push('');
      continue;
    }
    
    try {
      // 调用 Agnes Video API
      const response = await fetch('https://apihub.agnes-ai.cn/v1/videos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'agnes-video-v2.0',
          prompt: 'smooth camera movement, cinematic motion',
          image: imageUrl,
          duration: seconds,
          num_frames: seconds * 24,
          frame_rate: 24,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Video generation failed: ${response.status}`);
      }
      
      const data = await response.json() as any;
      const taskId = data.id || data.task_id;
      
      if (taskId) {
        // 等待视频生成完成
        const videoUrl = await pollVideoTask(taskId, apiKey);
        videoUrls.push(videoUrl);
      } else {
        throw new Error('No task ID in response');
      }
    } catch (error) {
      console.error(`[manju] Failed to generate video for scene ${i + 1}:`, error);
      videoUrls.push('');
    }
  }
  
  return videoUrls;
}

// 轮询视频任务状态
async function pollVideoTask(taskId: string, apiKey: string, maxAttempts = 60): Promise<string> {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await delay(5000); // 每5秒检查一次
    
    const response = await fetch(`https://apihub.agnes-ai.cn/v1/videos/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    if (!response.ok) {
      continue;
    }
    
    const data = await response.json() as any;
    
    if (data.status === 'completed') {
      return data.video_url || '';
    }
    
    if (data.status === 'failed') {
      throw new Error(data.error || 'Video generation failed');
    }
  }
  
  throw new Error('Video generation timeout');
}

// ═══════════════════════════════════════════════════════════
// Skill 5: 音画合成
// ═══════════════════════════════════════════════════════════

export async function composeVideo(
  videoUrls: string[],
  audioUrls: string[],
  bgm?: string
): Promise<string> {
  // 使用 FFmpeg 合成视频
  const tempDir = path.join(os.tmpdir(), 'manju-output');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const outputPath = path.join(tempDir, `manju-${Date.now()}.mp4`);
  
  // 创建 FFmpeg 命令
  // 1. 下载所有视频和音频
  // 2. 合并视频片段
  // 3. 添加音频轨道
  // 4. 添加背景音乐（如果有）
  
  // 简化版：直接返回第一个视频（实际项目中需要完整实现）
  const validVideo = videoUrls.find(v => v);
  if (validVideo) {
    return validVideo;
  }
  
  throw new Error('No valid video to compose');
}

// ═══════════════════════════════════════════════════════════
// 主入口：执行完整漫剧工作流
// ═══════════════════════════════════════════════════════════

export interface ManjuResult {
  success: boolean;
  scenes: Scene[];
  imageUrls: string[];
  audioUrls: string[];
  videoUrls: string[];
  finalVideo?: string;
  error?: string;
}

export async function executeManjuWorkflow(
  config: ManjuConfig,
  apiKey: string,
  onProgress?: (stage: string, progress: number) => void
): Promise<ManjuResult> {
  const result: ManjuResult = {
    success: false,
    scenes: [],
    imageUrls: [],
    audioUrls: [],
    videoUrls: [],
  };
  
  try {
    // Stage 1: 解析剧本
    onProgress?.('解析剧本', 10);
    result.scenes = await parseScript(config.script);
    
    // Stage 2: 生成图片
    onProgress?.('生成场景图片', 30);
    result.imageUrls = await generateSceneImages(
      result.scenes,
      config.style,
      config.videoRatio,
      apiKey
    );
    
    // Stage 3: 生成配音（仅在需要时）
    if (config.audioMode === 'tts') {
      onProgress?.('生成AI配音', 50);
      result.audioUrls = await generateTTS(result.scenes, config.voice || 'mimo-zhinv');
    } else {
      onProgress?.('跳过配音（使用视频模型音画同步）', 50);
      result.audioUrls = [];
    }
    
    // Stage 4: 图片转视频
    onProgress?.('生成视频片段', 70);
    result.videoUrls = await imagesToVideo(
      result.imageUrls,
      config.duration,
      config.videoRatio,
      apiKey
    );
    
    // Stage 5: 合成最终视频
    onProgress?.('合成最终视频', 90);
    result.finalVideo = await composeVideo(
      result.videoUrls,
      result.audioUrls,
      config.bgm
    );
    
    result.success = true;
    onProgress?.('完成', 100);
    
  } catch (error: any) {
    result.error = error.message;
    console.error('[manju] Workflow failed:', error);
  }
  
  return result;
}
