/**
 * 模型能力扩展方案 - GPT/豆包生图接入指南
 * 
 * 目标: 提升 AI 报价系统的视觉效果
 * - 从户型图生成真实感装修效果图
 * - 自动生成封面图片、宣传物料
 * - 支持多种艺术风格（现代/中式/轻奢）
 */

// ═══════════════════════════════════════════════════════════
// 方案1: 接入 OpenAI GPT-4o / DALL-E 3
// ═══════════════════════════════════════════════════════════

/**
 * 优势:
 * - 图像质量高，支持多种风格
 * - 理解复杂提示词能力强
 * - 可生成 1024x1024 或 1792x1024 高清图片
 * 
 * 实现步骤:
 * 
 * 1. 用户配置 API Key
 *    LLM 提示用户: "为了生成高质量的装修效果图，请提供您的 OpenAI API Key"
 *    → 安全存储在环境变量 OPENAI_API_KEY
 * 
 * 2. 新增工具定义
 *    generate_interior_rendering({
 *      roomType: "living_room",      // 房间类型
 *      style: "modern_minimalist",   // 风格
 *      area: 35.5,                   // 面积
 *      imageCount: 2                 // 生成数量
 *    })
 * 
 * 3. 调用 OpenAI API
 *    POST https://api.openai.com/v1/images/generations
 *    Body: {
 *      model: "dall-e-3",
 *      prompt: "Modern minimalist living room, 35.5 square meters, 
 *               white walls, wooden floor, large window with natural light,
 *               IKEA furniture, photorealistic, 4K quality",
 *      size: "1792x1024",
 *      quality: "hd"
 *    }
 * 
 * 4. 返回图片 URL 或 Base64
 */

const OPENAI_CONFIG = {
  apiUrl: 'https://api.openai.com/v1/images/generations',
  models: {
    dall_e_3: {
      max_size: '1792x1024',
      supported_styles: ['vivid', 'natural'],
      price_per_image: 0.08,  // USD
    },
    dall_e_2: {
      max_size: '1024x1024',
      supported_styles: ['photorealistic', 'painting', 'animation'],
      price_per_image: 0.02,
    },
  },
};

// ═══════════════════════════════════════════════════════════
// 方案2: 接入字节跳动豆包生图
// ═══════════════════════════════════════════════════════════

/**
 * 优势:
 * - 中文场景理解更好
 * - 中式风格、轻奢风格表现优秀
 * - 可能提供免费额度
 * 
 * 实现步骤:
 * 
 * 1. 用户配置 API Key
 *    LLM 提示用户: "请提供豆包 API Key（在字节跳动控制台获取）"
 *    → 安全存储在环境变量 DOUBAO_API_KEY
 * 
 * 2. 调用豆包图像生成 API
 *    POST https://api.douyin.com/v1/images/generate
 *    Body: {
 *      model: "doubao-image-v1",
 *      prompt: "现代简约风格客厅，35平米，白色墙面，木地板，
 *               大窗户自然光，宜家家具，写实风格，4K画质",
 *      size: "1792x1024",
 *      negative_prompt: "text, watermark, low quality"
 *    }
 * 
 * 3. 轮询查询生成状态
 *    GET https://api.douyin.com/v1/images/task/{task_id}
 */

const DOUBAO_CONFIG = {
  apiUrl: 'https://api.douyin.com/v1/images/generate',
  queryUrl: 'https://api.douyin.com/v1/images/task/{task_id}',
  models: {
    doubao_image_v1: {
      max_size: '2048x2048',
      supported_styles: ['写实', '插画', '水彩', '油画', '动漫'],
      chinese_prompt_support: true,
    },
  },
};

// ═══════════════════════════════════════════════════════════
// 方案3: 接入 Stable Diffusion (本地部署)
// ═══════════════════════════════════════════════════════════

/**
 * 优势:
 * - 完全免费，无 API 调用限制
 * - 可自定义模型（Checkpoint/LoRA）
 * - 支持 ControlNet 精确控制构图
 * 
 * 实现方式:
 * 
 * 1. 本地部署 SD WebUI 或 ComfyUI
 *    git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui
 *    
 * 2. 下载装修相关模型
 *    - RealisticVision (写实风格)
 *    - DreamShaper (通用高质量)
 *    - decoration_lora.safetensors (自定义 LoRA)
 *    
 * 3. 调用本地 API
 *    POST http://127.0.0.1:7860/sdapi/v1/txt2img
 *    Body: {
 *      prompt: "interior design, modern living room, ...",
 *      negative_prompt: "ugly, blurry, low quality",
 *      steps: 30,
 *      cfg_scale: 7,
 *      width: 1024,
 *      height: 1024
 *    }
 */

const LOCAL_SD_CONFIG = {
  apiUrl: 'http://127.0.0.1:7860/sdapi/v1/txt2img',
  recommended_models: [
    {name: 'RealisticVision V5.1', type: 'checkpoint', use_case: '写实照片级'},
    {name: 'DreamShaper V8', type: 'checkpoint', use_case: '通用高质量'},
    {name: 'decoration_lora.safetensors', type: 'lora', use_case: '装修专用'},
  ],
};

// ═══════════════════════════════════════════════════════════
// 集成到报价系统的流程
// ═══════════════════════════════════════════════════════════

/**
 * 完整工作流（接入生图能力后）:
 * 
 * 用户: "帮我生成这个户型的装修效果图"
 * 
 * AI 执行流程:
 * 
 * 1. parse_cad_drawing({filePath: "floorplan.dxf"})
 *    → 提取房间数据
 * 
 * 2. generate_quotation({...})
 *    → 生成报价单
 * 
 * 3. generate_interior_rendering({
 *      roomType: "living_room",
 *      style: "modern_minimalist",
 *      area: 35.5,
 *      imageCount: 2,
 *      provider: "doubao"  // 或 "openai", "local_sd"
 *    })
 *    → 调用选定的图像生成 API
 *    → 返回效果图 URL
 * 
 * 4. generate_45_degree_view({...})
 *    → 生成户型俯视图
 * 
 * 5. generate_quotation_cover({
 *      ...,
 *      backgroundImage: renderedImageUrl  // 使用生成的效果图作为背景
 *    })
 *    → 生成带效果图的封面
 * 
 * 6. generate_quotation_ppt({...})
 *    → 将效果图嵌入 PPT
 * 
 * 7. 交付物:
 *    - 报价单 PDF
 *    - 户型俯视图 SVG
 *    - 装修效果图 PNG (2-3张)
 *    - 演示 PPTX
 */

// ═══════════════════════════════════════════════════════════
// LLM 提示词模板（索要 API Key）
// ═══════════════════════════════════════════════════════════

const API_KEY_REQUEST_PROMPTS = {
  openai: `
为了生成高质量的装修效果图，我需要接入 OpenAI 的图像生成模型（DALL-E 3）。

请提供您的 OpenAI API Key，我将：
1. 安全存储在环境变量中
2. 仅用于图像生成任务
3. 不会泄露给第三方

获取方式: https://platform.openai.com/api-keys
  `,
  
  doubao: `
为了生成更符合中文审美的装修效果图，我建议接入字节跳动豆包的图像生成能力。

请提供豆包 API Key，我将：
1. 安全存储在环境变量中
2. 仅用于图像生成任务
3. 支持中文提示词，效果更好

获取方式: 字节跳动控制台 → 豆包 API
  `,
  
  local_sd: `
如果您有高性能 GPU（RTX 3090/4090），我建议本地部署 Stable Diffusion。

优势:
- 完全免费，无调用限制
- 可自定义模型和风格
- 数据完全本地化，隐私性好

部署指南:
1. 安装 Python 3.10+
2. git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui
3. 启动后访问 http://localhost:7860
4. 下载装修相关模型文件

需要我提供详细的部署步骤吗？
  `,
};

// ═══════════════════════════════════════════════════════════
// 价格参考
// ═══════════════════════════════════════════════════════════

/**
 * 各平台图像生成费用:
 * 
 * OpenAI DALL-E 3:
 * - Standard (1024x1024): $0.02/张
 * - HD (1792x1024): $0.08/张
 * 
 * 豆包 (假设):
 * - 免费额度: 100张/月
 * - 超出部分: ¥0.1/张
 * 
 * 本地 SD:
 * - 电费: ~¥0.01/张
 * - 硬件折旧: 一次性投入 ¥15000+
 * 
 * 建议:
 * - 初期使用豆包免费额度测试
 * - 需要高质量时调用 OpenAI
 * - 大量生成时部署本地 SD
 */

export const MODEL_EXTENSION_PLAN = {
  openai: OPENAI_CONFIG,
  doubao: DOUBAO_CONFIG,
  local_sd: LOCAL_SD_CONFIG,
  prompts: API_KEY_REQUEST_PROMPTS,
};
