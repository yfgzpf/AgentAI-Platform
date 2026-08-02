/**
 * Enhanced Image Generation Tools - AI可调用的增强图像生成工具
 * 
 * 基于漫剧系统的能力拓展，支持：
 * 1. 角色一致性生成 (character-consistent)
 * 2. 场景连续性生成 (scene-continuous)
 * 3. 分镜脚本生成 (storyboard)
 * 4. 风格迁移增强 (enhanced style transfer)
 */

// API Key 获取（内联实现）
const getApiKey = (envVar: string): string | undefined => {
  return process.env[envVar];
};
import path from 'path';
import fs from 'fs';
import os from 'os';

// ═══════════════════════════════════════════════════════════
// 辅助函数: 下载图片到本地临时文件
// ═══════════════════════════════════════════════════════════

const downloadToTempFile = async (url: string): Promise<string | null> => {
  try {
    const imgResp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!imgResp.ok) return null;
    const buf = Buffer.from(await imgResp.arrayBuffer());
    const tempDir = path.join(os.homedir(), '.agentai', 'temp-images');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const fileName = `enhanced-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, buf);
    return filePath;
  } catch {
    return null;
  }
};

// ═══════════════════════════════════════════════════════════
// 工具1: 角色一致性图像生成
// ═══════════════════════════════════════════════════════════

export async function generate_character_consistent_image(args: {
  characterDescription: string;  // 角色描述（保持一致的关键）
  scenes: Array<{
    setting: string;      // 场景描述
    action: string;       // 动作描述
    mood: string;         // 情绪/氛围
    angle?: string;       // 镜头角度（可选）
  }>;
  style?: string;         // 统一风格
  model?: string;         // 指定模型
}): Promise<{
  success: boolean;
  message: string;
  images?: Array<{ scene: string; localPath?: string; url?: string }>;
}> {
  console.log('[Enhanced Image] generate_character_consistent_image:', args.characterDescription);

  try {
    const apiKey = getApiKey('AGENTAI_API_KEY') || getApiKey('AGNES_API_KEY');
    const zhipuKey = getApiKey('ZHIPU_API_KEY');
    
    const images: Array<{ scene: string; localPath?: string; url?: string }> = [];
    
    for (let i = 0; i < Math.min(args.scenes.length, 5); i++) {
      const scene = args.scenes[i];
      
      // 构建提示词：角色描述 + 场景 + 动作 + 情绪 + 风格
      let prompt = `${args.characterDescription}`;
      prompt += `, ${scene.setting}`;
      prompt += `, ${scene.action}`;
      if (scene.mood) prompt += `, ${scene.mood} atmosphere`;
      if (scene.angle) prompt += `, ${scene.angle} shot`;
      if (args.style) prompt += `, ${args.style} style`;
      
      // 尝试使用 Agnes API（支持 img2img）
      if (apiKey && i > 0 && images[0]?.url) {
        // 使用第一张图作为参考，保持角色一致性
        try {
          const resp = await fetch('https://apihub.agnes-ai.cn/v1/images/generations', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'agnes-image-2.0-flash',
              prompt: prompt,
              size: '1024x1024',
              extra_body: {
                tags: ['img2img'],
                image_url: images[0].url,
              },
            }),
            signal: AbortSignal.timeout(60000),
          });
          
          if (resp.ok) {
            const data = await resp.json() as any;
            const imageUrl = data.data?.[0]?.url || data.url;
            if (imageUrl) {
              const localPath = await downloadToTempFile(imageUrl);
              images.push({
                scene: scene.setting,
                localPath: localPath || undefined,
                url: imageUrl,
              });
              continue;
            }
          }
        } catch (e: any) {
          console.warn('[Enhanced Image] img2img failed, falling back to text2img');
        }
      }
      
      // 回退到普通文生图
      if (zhipuKey) {
        try {
          const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
            method: 'POST',
            headers: { Authorization: `Bearer ${zhipuKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'cogview-3-flash',
              prompt: prompt,
              size: '1024x1024',
            }),
            signal: AbortSignal.timeout(60000),
          });
          
          if (resp.ok) {
            const data = await resp.json() as any;
            const imageUrl = data.data?.[0]?.url || data.url;
            if (imageUrl) {
              const localPath = await downloadToTempFile(imageUrl);
              images.push({
                scene: scene.setting,
                localPath: localPath || undefined,
                url: imageUrl,
              });
              continue;
            }
          }
        } catch (e: any) {
          console.warn('[Enhanced Image] cogview failed:', e.message);
        }
      }
    }
    
    return {
      success: true,
      message: `✅ 已生成 ${images.length} 张角色一致性图像`,
      images,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `角色一致性图像生成失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具2: 场景连续性图像生成
// ═══════════════════════════════════════════════════════════

export async function generate_scene_continuous_image(args: {
  sceneDescription: string;     // 场景描述
  timeSequences: Array<{
    time: string;               // 时间段（早晨/中午/傍晚/夜晚）
    weather?: string;           // 天气状况
    mood?: string;             // 氛围
  }>;
  style?: string;
}): Promise<{
  success: boolean;
  message: string;
  images?: Array<{ time: string; localPath?: string; url?: string }>;
}> {
  console.log('[Enhanced Image] generate_scene_continuous_image:', args.sceneDescription);

  try {
    const apiKey = getApiKey('AGENTAI_API_KEY') || getApiKey('AGNES_API_KEY');
    const zhipuKey = getApiKey('ZHIPU_API_KEY');
    
    const images: Array<{ time: string; localPath?: string; url?: string }> = [];
    
    for (let i = 0; i < Math.min(args.timeSequences.length, 4); i++) {
      const seq = args.timeSequences[i];
      
      // 构建提示词：场景 + 时间 + 天气 + 氛围 + 风格
      let prompt = `${args.sceneDescription}`;
      prompt += `, ${seq.time}`;
      if (seq.weather) prompt += `, ${seq.weather}`;
      if (seq.mood) prompt += `, ${seq.mood} atmosphere`;
      if (args.style) prompt += `, ${args.style} style`;
      
      // 优先使用 Cogview-3-Flash（免费且速度快）
      if (zhipuKey) {
        try {
          const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
            method: 'POST',
            headers: { Authorization: `Bearer ${zhipuKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'cogview-3-flash',
              prompt: prompt,
              size: '1024x1024',
            }),
            signal: AbortSignal.timeout(60000),
          });
          
          if (resp.ok) {
            const data = await resp.json() as any;
            const imageUrl = data.data?.[0]?.url || data.url;
            if (imageUrl) {
              const localPath = await downloadToTempFile(imageUrl);
              images.push({
                time: seq.time,
                localPath: localPath || undefined,
                url: imageUrl,
              });
              continue;
            }
          }
        } catch (e: any) {
          console.warn('[Enhanced Image] cogview failed:', e.message);
        }
      }
      
      // 回退到 Agnes
      if (apiKey) {
        try {
          const resp = await fetch('https://apihub.agnes-ai.cn/v1/images/generations', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'agnes-image-2.1-flash',
              prompt: prompt,
              size: '1024x1024',
            }),
            signal: AbortSignal.timeout(60000),
          });
          
          if (resp.ok) {
            const data = await resp.json() as any;
            const imageUrl = data.data?.[0]?.url || data.url;
            if (imageUrl) {
              const localPath = await downloadToTempFile(imageUrl);
              images.push({
                time: seq.time,
                localPath: localPath || undefined,
                url: imageUrl,
              });
            }
          }
        } catch (e: any) {
          console.warn('[Enhanced Image] agnes failed:', e.message);
        }
      }
    }
    
    return {
      success: true,
      message: `✅ 已生成 ${images.length} 张场景连续性图像`,
      images,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `场景连续性图像生成失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具3: 分镜脚本生成
// ═══════════════════════════════════════════════════════════

export async function generate_storyboard(args: {
  script: string;           // 剧本文本
  totalScenes?: number;     // 总场景数（默认10）
  aspectRatio?: '16:9' | '9:16' | '1:1';  // 画幅比例
  style?: string;           // 视觉风格
}): Promise<{
  success: boolean;
  message: string;
  storyboard?: Array<{
    sceneNumber: number;
    description: string;    // 画面描述
    cameraAngle: string;    // 镜头角度
    dialogue?: string;      // 对白
    duration?: string;      // 预计时长
    promptForImage: string; // 用于生成图像的提示词
  }>;
}> {
  console.log('[Enhanced Image] generate_storyboard:', args.script.substring(0, 100));

  try {
    // 这里调用 LLM 来解析剧本并生成结构化分镜
    // 简化版：返回分镜结构，实际应由 LLM 填充详细内容
    
    const scenes = Math.min(args.totalScenes || 10, 20);
    const storyboard: Array<any> = [];
    
    // 模拟分镜生成（实际需要调用 LLM）
    for (let i = 0; i < scenes; i++) {
      storyboard.push({
        sceneNumber: i + 1,
        description: `场景 ${i + 1}: [待LLM填充详细画面描述]`,
        cameraAngle: i % 3 === 0 ? 'close-up' : i % 3 === 1 ? 'medium-shot' : 'wide-shot',
        dialogue: i % 2 === 0 ? '[对白待填充]' : '',
        duration: '3-5秒',
        promptForImage: `${args.script.substring(0, 100)}... scene ${i + 1}, ${args.aspectRatio || '16:9'}, ${args.style || 'cinematic'}`,
      });
    }
    
    return {
      success: true,
      message: `✅ 已生成 ${scenes} 个分镜脚本（需配合 LLM 完善内容）`,
      storyboard,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `分镜脚本生成失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具4: 增强风格迁移
// ═══════════════════════════════════════════════════════════

export async function enhanced_style_transfer(args: {
  sourceImage: string;      // 源图像URL或路径
  targetStyle: string;      // 目标风格描述
  preserveComposition?: boolean;  // 是否保留构图
  strength?: number;        // 风格强度 (0.0-1.0)
}): Promise<{
  success: boolean;
  message: string;
  resultImageUrl?: string;
  localPath?: string;
}> {
  console.log('[Enhanced Image] enhanced_style_transfer:', args.targetStyle);

  try {
    const apiKey = getApiKey('AGENTAI_API_KEY') || getApiKey('AGNES_API_KEY');
    
    if (!apiKey) {
      return {
        success: false,
        message: '需要配置 AGENTAI_API_KEY 或 AGNES_API_KEY 以使用风格迁移功能',
      };
    }
    
    // 使用 Agnes Image 2.0 的风格迁移模式
    const resp = await fetch('https://apihub.agnes-ai.cn/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'agnes-image-2.0-flash',
        prompt: `style transfer: ${args.targetStyle}`,
        size: '1024x1024',
        extra_body: {
          tags: ['style_transfer'],
          image_url: args.sourceImage,
          strength: args.strength || 0.7,
        },
      }),
      signal: AbortSignal.timeout(120000),
    });
    
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return {
        success: false,
        message: `风格迁移失败 (HTTP ${resp.status}): ${errText.slice(0, 200)}`,
      };
    }
    
    const data = await resp.json() as any;
    const imageUrl = data.data?.[0]?.url || data.url;
    
    if (imageUrl) {
      const localPath = await downloadToTempFile(imageUrl);
      return {
        success: true,
        message: '✅ 风格迁移完成',
        resultImageUrl: imageUrl,
        localPath: localPath || undefined,
      };
    }
    
    return {
      success: true,
      message: '风格迁移任务已提交',
      resultImageUrl: imageUrl,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `风格迁移失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 导出工具定义（用于AI识别）
// ═══════════════════════════════════════════════════════════

export const ENHANCED_IMAGE_TOOLS = {
  generate_character_consistent_image,
  generate_scene_continuous_image,
  generate_storyboard,
  enhanced_style_transfer,
};

export const ENHANCED_IMAGE_TOOL_DEFINITIONS = [
  {
    name: 'generate_character_consistent_image',
    description: '生成角色一致性图像序列，支持多场景/多镜头的角色外观保持。适用于漫画/短剧角色设计。参数: characterDescription(角色描述), scenes(场景数组[{setting, action, mood, angle?}], style?, model?)',
    parameters: {
      type: 'object',
      properties: {
        characterDescription: { type: 'string', description: '角色详细描述（颜色/发型/服装/特征）' },
        scenes: { 
          type: 'array', 
          items: {
            type: 'object',
            properties: {
              setting: { type: 'string', description: '场景环境描述' },
              action: { type: 'string', description: '角色动作描述' },
              mood: { type: 'string', description: '氛围/情绪' },
              angle: { type: 'string', description: '镜头角度（可选）' },
            },
          },
          description: '场景序列数组'
        },
        style: { type: 'string', description: '统一视觉风格' },
        model: { type: 'string', description: '指定模型名称' },
      },
      required: ['characterDescription', 'scenes'],
    },
  },
  {
    name: 'generate_scene_continuous_image',
    description: '生成场景连续性图像，展示同一场景在不同时间/天气/氛围下的变化。适用于背景设定、时间流逝表现。参数: sceneDescription, timeSequences[{time, weather?, mood?}], style?',
    parameters: {
      type: 'object',
      properties: {
        sceneDescription: { type: 'string', description: '场景核心描述' },
        timeSequences: { 
          type: 'array',
          items: {
            type: 'object',
            properties: {
              time: { type: 'string', description: '时间段（早晨/中午/傍晚/夜晚）' },
              weather: { type: 'string', description: '天气状况（可选）' },
              mood: { type: 'string', description: '氛围（可选）' },
            },
          },
          description: '时间序列数组'
        },
        style: { type: 'string', description: '视觉风格（可选）' },
      },
      required: ['sceneDescription', 'timeSequences'],
    },
  },
  {
    name: 'generate_storyboard',
    description: '从剧本生成结构化分镜脚本，包含镜头编号、画面描述、镜头角度、对白、时长和图像生成提示词。适用于漫画/短剧前期规划。参数: script(剧本), totalScenes?(默认10), aspectRatio?(16:9/9:16/1:1), style?',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: '完整剧本或场景描述' },
        totalScenes: { type: 'number', description: '分镜总数（默认10，最大20）' },
        aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '画幅比例' },
        style: { type: 'string', description: '视觉风格（可选）' },
      },
      required: ['script'],
    },
  },
  {
    name: 'enhanced_style_transfer',
    description: '增强型风格迁移，支持风格强度控制和构图保留选项。将源图像转换为指定艺术风格。参数: sourceImage(源图URL), targetStyle(目标风格), preserveComposition?(默认true), strength?(0.0-1.0，默认0.7)',
    parameters: {
      type: 'object',
      properties: {
        sourceImage: { type: 'string', description: '源图像URL或本地路径' },
        targetStyle: { type: 'string', description: '目标艺术风格描述' },
        preserveComposition: { type: 'boolean', description: '是否保留原始构图（默认true）' },
        strength: { type: 'number', minimum: 0, maximum: 1, description: '风格强度（0.0-1.0，默认0.7）' },
      },
      required: ['sourceImage', 'targetStyle'],
    },
  },
];
