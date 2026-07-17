/**
 * Media Generation Tools - AI可调用的多媒体生成工具
 * 
 * 工具列表：
 * 1. generate_image - 生成图像
 * 2. generate_video - 生成视频（参考漫剧系统）
 * 3. generate_3d_model - 生成3D模型（Tripo3D）
 * 4. get_generation_status - 查询生成状态
 * 5. download_generated_media - 下载生成的媒体
 */

import { getMediaGenerationCore, Tripo3DClient } from './media-generation-core.js';

// ═══════════════════════════════════════════════════════════
// 工具1: 生成图像
// ═══════════════════════════════════════════════════════════

export async function generate_image(args: {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  style?: string;
  model?: string;
}): Promise<{
  success: boolean;
  message: string;
  taskId?: string;
  estimatedTime?: number;
}> {
  console.log('[AI Tool] generate_image:', args.prompt);

  try {
    const core = getMediaGenerationCore();
    
    const task = await core.createTask({
      type: 'image',
      prompt: args.prompt,
      negativePrompt: args.negativePrompt,
      params: {
        width: args.width || 1024,
        height: args.height || 1024,
        style: args.style,
        model: args.model || 'sdxl',
      },
    });

    return {
      success: true,
      message: '图像生成任务已创建',
      taskId: task.id,
      estimatedTime: 30, // 秒
    };
  } catch (error: any) {
    return {
      success: false,
      message: `创建失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具2: 生成视频（参考漫剧系统）
// ═══════════════════════════════════════════════════════════

export async function generate_video(args: {
  prompt: string;
  imageUrl?: string; // 图生视频
  duration?: number; // 秒
  fps?: number;
  resolution?: '720p' | '1080p';
  style?: string;
}): Promise<{
  success: boolean;
  message: string;
  taskId?: string;
  estimatedTime?: number;
}> {
  console.log('[AI Tool] generate_video:', args.prompt);

  try {
    const core = getMediaGenerationCore();
    
    const task = await core.createTask({
      type: 'video',
      prompt: args.prompt,
      params: {
        imageUrl: args.imageUrl,
        duration: args.duration || 5,
        fps: args.fps || 24,
        resolution: args.resolution || '720p',
        style: args.style,
      },
    });

    return {
      success: true,
      message: '视频生成任务已创建',
      taskId: task.id,
      estimatedTime: args.duration ? args.duration * 10 : 60, // 估算时间
    };
  } catch (error: any) {
    return {
      success: false,
      message: `创建失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具3: 生成3D模型（Tripo3D）
// ═══════════════════════════════════════════════════════════

export async function generate_3d_model(args: {
  prompt?: string;      // 文生3D
  imageUrl?: string;    // 图生3D
  style?: 'pbr' | 'normal';
  texture?: boolean;
  autoDownload?: boolean;
}): Promise<{
  success: boolean;
  message: string;
  taskId?: string;
  estimatedTime?: number;
}> {
  console.log('[AI Tool] generate_3d_model:', args.prompt || args.imageUrl);

  // 验证参数
  if (!args.prompt && !args.imageUrl) {
    return {
      success: false,
      message: '需要提供prompt（文生3D）或imageUrl（图生3D）',
    };
  }

  try {
    const core = getMediaGenerationCore();
    
    const task = await core.createTask({
      type: '3d',
      prompt: args.prompt || '3D model',
      imageUrl: args.imageUrl,
      params: {
        style: args.style || 'pbr',
        texture: args.texture !== false,
        autoDownload: args.autoDownload !== false,
      },
    });

    return {
      success: true,
      message: `3D模型生成任务已创建（${args.imageUrl ? '图生3D' : '文生3D'}）`,
      taskId: task.id,
      estimatedTime: 180, // Tripo3D通常需要2-3分钟
    };
  } catch (error: any) {
    return {
      success: false,
      message: `创建失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具4: 查询生成状态
// ═══════════════════════════════════════════════════════════

export async function get_generation_status(args: {
  taskId: string;
}): Promise<{
  success: boolean;
  message: string;
  status?: {
    id: string;
    type: string;
    status: string;
    progress: number;
    result?: any;
    error?: string;
    createdAt: number;
    updatedAt: number;
  };
}> {
  console.log('[AI Tool] get_generation_status:', args.taskId);

  try {
    const core = getMediaGenerationCore();
    const task = core.getTask(args.taskId);

    if (!task) {
      return {
        success: false,
        message: '任务不存在',
      };
    }

    return {
      success: true,
      message: `任务状态: ${task.status}`,
      status: {
        id: task.id,
        type: task.type,
        status: task.status,
        progress: task.progress,
        result: task.result,
        error: task.error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `查询失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具5: 下载生成的媒体
// ═══════════════════════════════════════════════════════════

export async function download_generated_media(args: {
  taskId: string;
  savePath?: string;
}): Promise<{
  success: boolean;
  message: string;
  localPath?: string;
}> {
  console.log('[AI Tool] download_generated_media:', args.taskId);

  try {
    const core = getMediaGenerationCore();
    const task = core.getTask(args.taskId);

    if (!task) {
      return {
        success: false,
        message: '任务不存在',
      };
    }

    if (task.status !== 'completed') {
      return {
        success: false,
        message: `任务未完成，当前状态: ${task.status}`,
      };
    }

    if (!task.result?.urls || task.result.urls.length === 0) {
      return {
        success: false,
        message: '没有可下载的文件',
      };
    }

    // 对于3D模型，下载第一个文件（主模型）
    const url = task.result.urls[0];
    const tripoClient = new Tripo3DClient();
    
    const savePath = args.savePath || `./downloads/${task.id}.glb`;
    const localPath = await tripoClient.downloadModel(url, savePath);

    return {
      success: true,
      message: '下载成功',
      localPath,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `下载失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具6: 批量生成（高级功能）
// ═══════════════════════════════════════════════════════════

export async function batch_generate(args: {
  type: 'image' | 'video' | '3d';
  prompts: string[];
  commonParams?: Record<string, any>;
}): Promise<{
  success: boolean;
  message: string;
  taskIds?: string[];
}> {
  console.log('[AI Tool] batch_generate:', args.type, args.prompts.length, '个任务');

  try {
    const core = getMediaGenerationCore();
    const taskIds: string[] = [];

    for (const prompt of args.prompts) {
      const task = await core.createTask({
        type: args.type,
        prompt,
        params: args.commonParams,
      });
      taskIds.push(task.id);
    }

    return {
      success: true,
      message: `已创建 ${taskIds.length} 个生成任务`,
      taskIds,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `批量创建失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具注册表
// ═══════════════════════════════════════════════════════════

export const MEDIA_GENERATION_TOOLS = {
  generate_image,
  generate_video,
  generate_3d_model,
  get_generation_status,
  download_generated_media,
  batch_generate,
};

// 工具定义（用于AI识别）
export const MEDIA_GENERATION_TOOL_DEFINITIONS = [
  {
    name: 'generate_image',
    description: '生成图像，支持文生图',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图像描述' },
        negativePrompt: { type: 'string', description: '负面描述' },
        width: { type: 'number', description: '宽度' },
        height: { type: 'number', description: '高度' },
        style: { type: 'string', description: '风格' },
        model: { type: 'string', description: '模型名称' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description: '生成视频，支持文生视频和图生视频',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频描述' },
        imageUrl: { type: 'string', description: '参考图片URL（图生视频）' },
        duration: { type: 'number', description: '时长（秒）' },
        fps: { type: 'number', description: '帧率' },
        resolution: { type: 'string', enum: ['720p', '1080p'] },
        style: { type: 'string', description: '风格' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_3d_model',
    description: '生成3D模型，支持文生3D和图生3D（Tripo3D）',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '3D模型描述（文生3D）' },
        imageUrl: { type: 'string', description: '参考图片URL（图生3D）' },
        style: { type: 'string', enum: ['pbr', 'normal'], description: '渲染风格' },
        texture: { type: 'boolean', description: '是否生成纹理' },
        autoDownload: { type: 'boolean', description: '是否自动下载' },
      },
    },
  },
  {
    name: 'get_generation_status',
    description: '查询生成任务状态',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'download_generated_media',
    description: '下载生成的媒体文件',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        savePath: { type: 'string', description: '保存路径' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'batch_generate',
    description: '批量生成媒体',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['image', 'video', '3d'] },
        prompts: { type: 'array', items: { type: 'string' } },
        commonParams: { type: 'object' },
      },
      required: ['type', 'prompts'],
    },
  },
];
