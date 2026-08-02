// @ts-nocheck
/**
 * Preset Workflows — 预置工作流库
 * ============================================================
 * 
 * 提供开箱即用的工作流模板，用户可以直接使用或基于此定制。
 * 
 * 工作流类型:
 * 1. 漫剧生成 (Manju) — 音画同步视频生成
 * 2. 公众号运营 — 对标→写稿→配图→发布
 * 3. 数据分析报告 — 数据→分析→可视化→报告
 * 4. 代码审查 — 扫描→分析→修复建议
 * 5. 文档生成 — 大纲→内容→排版→导出
 * 
 * 每个工作流包含:
 * - 模板定义 (WorkflowTemplate)
 * - 参数Schema (用于表单生成)
 * - 示例数据
 */

import { WorkflowTemplate, WorkflowStage } from '../workflow-orchestrator.js';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface PresetWorkflow extends WorkflowTemplate {
  /** 工作流分类 */
  category: 'media' | 'content' | 'data' | 'code' | 'design';
  /** 图标 */
  icon: string;
  /** 参数Schema (用于前端表单) */
  parameters: WorkflowParameter[];
  /** 示例输入 */
  examples: WorkflowExample[];
  /** 预计执行时间 (分钟) */
  estimatedTime: number;
  /** 所需API密钥 */
  requiredKeys: string[];
}

export interface WorkflowParameter {
  name: string;
  label: string;
  type: 'string' | 'text' | 'number' | 'select' | 'boolean' | 'file';
  required: boolean;
  default?: any;
  options?: { label: string; value: any }[];
  placeholder?: string;
  description?: string;
}

export interface WorkflowExample {
  title: string;
  description: string;
  input: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════
// 1. 漫剧生成工作流 (Manju Video Generation)
// ═══════════════════════════════════════════════════════════

export const manjuWorkflow: PresetWorkflow = {
  name: 'manju-generator',
  description: '漫剧视频生成 — 脚本→分镜→生图→视频→配音→合成',
  category: 'media',
  icon: '🎬',
  triggers: ['漫剧', '视频生成', '音画同步', '短剧'],
  estimatedTime: 10,
  requiredKeys: ['AGENTAI_API_KEY'],  // MiMo TTS 有内置密钥，可选使用
  
  parameters: [
    {
      name: 'script',
      label: '剧本内容',
      type: 'text',
      required: true,
      placeholder: '输入漫剧剧本，每行一个场景...',
      description: '支持分镜格式：场景 | 描述 | 对白',
    },
    {
      name: 'style',
      label: '视觉风格',
      type: 'select',
      required: true,
      default: 'anime',
      options: [
        { label: '动漫风格', value: 'anime' },
        { label: '写实风格', value: 'realistic' },
        { label: '水墨风格', value: 'ink' },
        { label: '3D渲染', value: '3d' },
      ],
    },
    {
      name: 'videoRatio',
      label: '视频比例',
      type: 'select',
      required: true,
      default: '9:16',
      options: [
        { label: '竖屏 9:16 (抖音/快手)', value: '9:16' },
        { label: '横屏 16:9 (B站/YouTube)', value: '16:9' },
        { label: '方形 1:1 (小红书)', value: '1:1' },
      ],
    },
    {
      name: 'duration',
      label: '视频时长',
      type: 'select',
      required: true,
      default: '5s',
      options: [
        { label: '3秒', value: '3s' },
        { label: '5秒', value: '5s' },
        { label: '8秒', value: '8s' },
        { label: '10秒', value: '10s' },
      ],
    },
    {
      name: 'audioMode',
      label: '音频模式',
      type: 'select',
      required: true,
      default: 'auto',
      options: [
        { label: '自动（视频模型音画同步）', value: 'auto' },
        { label: 'AI配音（MiMo TTS）', value: 'tts' },
        { label: '仅背景音乐', value: 'bgm_only' },
        { label: '静音', value: 'silent' },
      ],
      description: '视频模型自带音画同步，如效果不佳可选择AI配音',
    },
    {
      name: 'voice',
      label: '配音音色（AI配音时有效）',
      type: 'select',
      required: false,
      default: 'mimo-zhinv',
      options: [
        { label: '米女（温柔女声）', value: 'mimo-zhinv' },
        { label: '米男（成熟男声）', value: 'mimo-zhinan' },
        { label: '御姐', value: 'mimo-yujie' },
        { label: '青年', value: 'mimo-qingnian' },
        { label: '少女', value: 'mimo-shaonv' },
      ],
    },
    {
      name: 'bgm',
      label: '背景音乐',
      type: 'select',
      required: false,
      default: 'none',
      options: [
        { label: '无', value: 'none' },
        { label: '浪漫', value: 'romantic' },
        { label: '悬疑', value: 'suspense' },
        { label: '欢快', value: 'happy' },
        { label: '悲伤', value: 'sad' },
      ],
    },
  ],

  examples: [
    {
      title: '浪漫爱情短剧',
      description: '生成一段30秒的浪漫爱情漫剧',
      input: {
        script: `场景1 | 樱花树下，男主等待 | "我等你很久了"
场景2 | 女主走来，微笑 | "让你久等了"
场景3 | 两人相视而笑 | "走吧，一起去未来"`,
        style: 'anime',
        voice: 'mimo-zhinan',
        videoRatio: '9:16',
        duration: '5s',
        bgm: 'romantic',
      },
    },
  ],

  stages: [
    // Stage 1: 解析剧本
    {
      id: 'parse_script',
      type: 'skill',
      skill: 'parse_script',
      output: 'scenes',
      params: {
        script: '{{input.script}}',
      },
    },
    // Stage 2: 生成场景图片
    {
      id: 'generate_scene_images',
      type: 'skill',
      skill: 'generate_scene_images',
      input: 'scenes',
      output: 'scene_images',
      params: {
        style: '{{input.style}}',
        ratio: '{{input.videoRatio}}',
      },
    },
    // Stage 3: 生成配音
    {
      id: 'generate_tts',
      type: 'skill',
      skill: 'generate_tts',
      input: 'scenes',
      output: 'audio_tracks',
      params: {
        voice: '{{input.voice}}',
        provider: 'mimo',
      },
    },
    // Stage 4: 图片转视频
    {
      id: 'images_to_video',
      type: 'skill',
      skill: 'images_to_video',
      input: 'scene_images',
      output: 'video_segments',
      params: {
        duration: '{{input.duration}}',
        ratio: '{{input.videoRatio}}',
      },
    },
    // Stage 5: 音画合成
    {
      id: 'compose_video',
      type: 'skill',
      skill: 'compose_video',
      input: 'video_segments',
      output: 'final_video',
      params: {
        audio: '{{audio_tracks}}',
        bgm: '{{input.bgm}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 2. 公众号运营工作流
// ═══════════════════════════════════════════════════════════

export const wechatArticleWorkflow: PresetWorkflow = {
  name: 'wechat-article',
  description: '公众号文章运营 — 对标→写稿→配图→发布',
  category: 'content',
  icon: '📝',
  triggers: ['公众号', '文章', '运营', '推文'],
  estimatedTime: 15,
  requiredKeys: ['DEEPSEEK_API_KEY'],

  parameters: [
    {
      name: 'topic',
      label: '文章主题',
      type: 'string',
      required: true,
      placeholder: '输入文章主题或关键词',
    },
    {
      name: 'referenceUrl',
      label: '对标文章链接',
      type: 'string',
      required: false,
      placeholder: 'https://mp.weixin.qq.com/...',
      description: '可选：提供参考文章链接进行对标分析',
    },
    {
      name: 'tone',
      label: '文章调性',
      type: 'select',
      required: true,
      default: 'professional',
      options: [
        { label: '专业严谨', value: 'professional' },
        { label: '轻松幽默', value: 'casual' },
        { label: '情感共鸣', value: 'emotional' },
        { label: '干货教程', value: 'tutorial' },
      ],
    },
    {
      name: 'wordCount',
      label: '字数',
      type: 'select',
      required: true,
      default: 1500,
      options: [
        { label: '800字 (短文)', value: 800 },
        { label: '1500字 (标准)', value: 1500 },
        { label: '2500字 (长文)', value: 2500 },
      ],
    },
    {
      name: 'includeImages',
      label: '自动生成配图',
      type: 'boolean',
      required: false,
      default: true,
    },
  ],

  examples: [
    {
      title: 'AI工具推荐文章',
      description: '生成一篇关于AI工具的公众号推文',
      input: {
        topic: '2024年最值得使用的10个AI工具',
        tone: 'tutorial',
        wordCount: 1500,
        includeImages: true,
      },
    },
  ],

  stages: [
    {
      skill: 'analyze_reference',
      output: 'reference_analysis',
      params: {
        url: '{{input.referenceUrl}}',
      },
    },
    {
      skill: 'generate_outline',
      input: 'reference_analysis',
      output: 'article_outline',
      params: {
        topic: '{{input.topic}}',
        tone: '{{input.tone}}',
        wordCount: '{{input.wordCount}}',
      },
    },
    {
      skill: 'write_article',
      input: 'article_outline',
      output: 'article_content',
      params: {
        tone: '{{input.tone}}',
      },
    },
    {
      skill: 'generate_images',
      output: 'article_images',
      params: {
        count: 3,
        style: 'article',
      },
    },
    {
      skill: 'format_for_wechat',
      input: 'article_content',
      output: 'formatted_article',
      params: {
        images: '{{article_images}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 3. 数据分析报告工作流
// ═══════════════════════════════════════════════════════════

export const dataAnalysisWorkflow: PresetWorkflow = {
  name: 'data-analysis-report',
  description: '数据分析报告 — 数据清洗→分析→可视化→报告',
  category: 'data',
  icon: '📊',
  triggers: ['数据分析', '报告', '可视化', '图表'],
  estimatedTime: 8,
  requiredKeys: [],

  parameters: [
    {
      name: 'dataSource',
      label: '数据源',
      type: 'file',
      required: true,
      description: '支持 CSV, Excel, JSON 格式',
    },
    {
      name: 'analysisGoal',
      label: '分析目标',
      type: 'text',
      required: true,
      placeholder: '描述你想从数据中发现什么...',
    },
    {
      name: 'chartTypes',
      label: '图表类型',
      type: 'select',
      required: true,
      default: 'auto',
      options: [
        { label: '自动选择', value: 'auto' },
        { label: '趋势图', value: 'line' },
        { label: '柱状图', value: 'bar' },
        { label: '饼图', value: 'pie' },
        { label: '散点图', value: 'scatter' },
      ],
    },
    {
      name: 'outputFormat',
      label: '输出格式',
      type: 'select',
      required: true,
      default: 'pptx',
      options: [
        { label: 'PPT演示文稿', value: 'pptx' },
        { label: 'Word文档', value: 'docx' },
        { label: 'PDF报告', value: 'pdf' },
        { label: 'HTML网页', value: 'html' },
      ],
    },
  ],

  examples: [
    {
      title: '销售数据分析',
      description: '分析季度销售数据并生成PPT报告',
      input: {
        analysisGoal: '分析Q3销售趋势，找出增长最快的产品线',
        chartTypes: 'auto',
        outputFormat: 'pptx',
      },
    },
  ],

  stages: [
    {
      skill: 'read_data',
      output: 'raw_data',
      params: {
        source: '{{input.dataSource}}',
      },
    },
    {
      skill: 'clean_data',
      input: 'raw_data',
      output: 'cleaned_data',
    },
    {
      skill: 'analyze_data',
      input: 'cleaned_data',
      output: 'analysis_results',
      params: {
        goal: '{{input.analysisGoal}}',
      },
    },
    {
      skill: 'create_charts',
      input: 'analysis_results',
      output: 'charts',
      params: {
        types: '{{input.chartTypes}}',
      },
    },
    {
      skill: 'generate_report',
      input: 'analysis_results',
      output: 'final_report',
      params: {
        format: '{{input.outputFormat}}',
        charts: '{{charts}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 4. 代码审查工作流
// ═══════════════════════════════════════════════════════════

export const codeReviewWorkflow: PresetWorkflow = {
  name: 'code-review',
  description: '代码审查 — 扫描→分析→修复建议→报告',
  category: 'code',
  icon: '🔍',
  triggers: ['代码审查', 'Code Review', '代码检查', '重构'],
  estimatedTime: 5,
  requiredKeys: [],

  parameters: [
    {
      name: 'codePath',
      label: '代码路径',
      type: 'string',
      required: true,
      placeholder: './src 或具体文件路径',
    },
    {
      name: 'language',
      label: '编程语言',
      type: 'select',
      required: true,
      default: 'typescript',
      options: [
        { label: 'TypeScript', value: 'typescript' },
        { label: 'JavaScript', value: 'javascript' },
        { label: 'Python', value: 'python' },
        { label: 'Java', value: 'java' },
        { label: 'Go', value: 'go' },
        { label: 'Rust', value: 'rust' },
      ],
    },
    {
      name: 'checkTypes',
      label: '检查类型',
      type: 'select',
      required: true,
      default: 'all',
      options: [
        { label: '全面检查', value: 'all' },
        { label: '仅安全漏洞', value: 'security' },
        { label: '仅性能问题', value: 'performance' },
        { label: '仅代码风格', value: 'style' },
      ],
    },
    {
      name: 'autoFix',
      label: '自动修复',
      type: 'boolean',
      required: false,
      default: false,
      description: '自动修复简单问题（如格式、未使用变量等）',
    },
  ],

  examples: [
    {
      title: '前端代码审查',
      description: '审查 React 组件代码',
      input: {
        codePath: './src/components',
        language: 'typescript',
        checkTypes: 'all',
        autoFix: true,
      },
    },
  ],

  stages: [
    {
      skill: 'scan_code',
      output: 'code_files',
      params: {
        path: '{{input.codePath}}',
        language: '{{input.language}}',
      },
    },
    {
      skill: 'analyze_code',
      input: 'code_files',
      output: 'issues',
      params: {
        checkTypes: '{{input.checkTypes}}',
      },
    },
    {
      skill: 'generate_fixes',
      input: 'issues',
      output: 'fixes',
      params: {
        autoFix: '{{input.autoFix}}',
      },
    },
    {
      skill: 'create_review_report',
      input: 'issues',
      output: 'review_report',
      params: {
        fixes: '{{fixes}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 5. 文档生成工作流
// ═══════════════════════════════════════════════════════════

export const documentGenerationWorkflow: PresetWorkflow = {
  name: 'document-generation',
  description: '文档生成 — 大纲→内容→排版→导出',
  category: 'content',
  icon: '📄',
  triggers: ['文档', '说明书', '手册', '生成文档'],
  estimatedTime: 10,
  requiredKeys: [],

  parameters: [
    {
      name: 'docType',
      label: '文档类型',
      type: 'select',
      required: true,
      default: 'api',
      options: [
        { label: 'API文档', value: 'api' },
        { label: '产品说明书', value: 'product' },
        { label: '技术方案', value: 'technical' },
        { label: '用户手册', value: 'manual' },
        { label: '项目报告', value: 'report' },
      ],
    },
    {
      name: 'topic',
      label: '文档主题',
      type: 'string',
      required: true,
      placeholder: '输入文档主题',
    },
    {
      name: 'sourceCode',
      label: '源码路径（API文档需要）',
      type: 'string',
      required: false,
      placeholder: './src',
    },
    {
      name: 'outputFormat',
      label: '输出格式',
      type: 'select',
      required: true,
      default: 'markdown',
      options: [
        { label: 'Markdown', value: 'markdown' },
        { label: 'Word', value: 'docx' },
        { label: 'PDF', value: 'pdf' },
        { label: 'HTML', value: 'html' },
      ],
    },
  ],

  examples: [
    {
      title: 'API文档生成',
      description: '从源码自动生成API文档',
      input: {
        docType: 'api',
        topic: 'AgentAI Platform API',
        sourceCode: './src',
        outputFormat: 'markdown',
      },
    },
  ],

  stages: [
    {
      skill: 'analyze_source',
      output: 'source_analysis',
      params: {
        path: '{{input.sourceCode}}',
      },
    },
    {
      skill: 'generate_outline',
      input: 'source_analysis',
      output: 'doc_outline',
      params: {
        docType: '{{input.docType}}',
        topic: '{{input.topic}}',
      },
    },
    {
      skill: 'write_content',
      input: 'doc_outline',
      output: 'doc_content',
    },
    {
      skill: 'format_document',
      input: 'doc_content',
      output: 'formatted_doc',
      params: {
        format: '{{input.outputFormat}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 工作流注册表
// ═══════════════════════════════════════════════════════════

export const PRESET_WORKFLOWS: PresetWorkflow[] = [
  manjuWorkflow,
  wechatArticleWorkflow,
  dataAnalysisWorkflow,
  codeReviewWorkflow,
  documentGenerationWorkflow,
];

/** 按分类获取工作流 */
export function getWorkflowsByCategory(category: PresetWorkflow['category']) {
  return PRESET_WORKFLOWS.filter(w => w.category === category);
}

/** 根据名称获取工作流 */
export function getWorkflowByName(name: string): PresetWorkflow | undefined {
  return PRESET_WORKFLOWS.find(w => w.name === name);
}

/** 搜索工作流 */
export function searchWorkflows(query: string): PresetWorkflow[] {
  const lower = query.toLowerCase();
  return PRESET_WORKFLOWS.filter(w => 
    w.name.toLowerCase().includes(lower) ||
    w.description.toLowerCase().includes(lower) ||
    w.triggers.some(t => t.toLowerCase().includes(lower))
  );
}

/** 获取所有分类 */
export function getCategories(): { id: PresetWorkflow['category']; name: string; icon: string }[] {
  return [
    { id: 'media', name: '媒体生成', icon: '🎬' },
    { id: 'content', name: '内容创作', icon: '✍️' },
    { id: 'data', name: '数据分析', icon: '📊' },
    { id: 'code', name: '代码开发', icon: '💻' },
    { id: 'design', name: '设计创作', icon: '🎨' },
  ];
}

export default PRESET_WORKFLOWS;
