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
// 6. 网页内容摘要工作流
// ═══════════════════════════════════════════════════════════

export const webSummaryWorkflow: PresetWorkflow = {
  name: 'web-summary',
  description: '网页内容摘要 — 抓取URL→提取正文→摘要→关键点',
  category: 'content',
  icon: '🌐',
  triggers: ['网页摘要', 'URL摘要', '文章总结', '网页提取'],
  estimatedTime: 3,
  requiredKeys: [],

  parameters: [
    {
      name: 'url',
      label: '网页链接',
      type: 'string',
      required: true,
      placeholder: 'https://example.com/article',
      description: '要提取摘要的网页 URL',
    },
    {
      name: 'summaryLength',
      label: '摘要长度',
      type: 'select',
      required: true,
      default: 'medium',
      options: [
        { label: '简短 (100字以内)', value: 'short' },
        { label: '中等 (300字左右)', value: 'medium' },
        { label: '详细 (800字左右)', value: 'long' },
      ],
    },
    {
      name: 'extractKeyPoints',
      label: '提取关键点',
      type: 'boolean',
      required: false,
      default: true,
    },
  ],

  examples: [
    {
      title: '新闻文章摘要',
      description: '提取一篇新闻文章的核心内容',
      input: {
        url: 'https://example.com/news/ai-breakthrough',
        summaryLength: 'medium',
        extractKeyPoints: true,
      },
    },
  ],

  stages: [
    {
      id: 'fetch_page',
      type: 'skill',
      skill: 'fetch_page',
      output: 'page_content',
      params: {
        url: '{{input.url}}',
      },
    },
    {
      id: 'extract_text',
      type: 'skill',
      skill: 'extract_text',
      input: 'page_content',
      output: 'article_text',
    },
    {
      id: 'generate_summary',
      type: 'skill',
      skill: 'generate_summary',
      input: 'article_text',
      output: 'summary',
      params: {
        length: '{{input.summaryLength}}',
      },
    },
    {
      id: 'extract_key_points',
      type: 'skill',
      skill: 'extract_key_points',
      input: 'article_text',
      output: 'key_points',
      params: {
        enabled: '{{input.extractKeyPoints}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 7. 周报/日报生成工作流
// ═══════════════════════════════════════════════════════════

export const workReportWorkflow: PresetWorkflow = {
  name: 'work-report',
  description: '工作日报/周报 — 工作内容→结构化总结→下周计划',
  category: 'content',
  icon: '📋',
  triggers: ['周报', '日报', '工作总结', '工作汇报'],
  estimatedTime: 3,
  requiredKeys: [],

  parameters: [
    {
      name: 'reportType',
      label: '报告类型',
      type: 'select',
      required: true,
      default: 'weekly',
      options: [
        { label: '日报', value: 'daily' },
        { label: '周报', value: 'weekly' },
        { label: '月报', value: 'monthly' },
      ],
    },
    {
      name: 'workItems',
      label: '本期工作内容',
      type: 'text',
      required: true,
      placeholder: '列出你这段时间做的主要工作，每行一项...',
      description: '简要描述完成的任务、进展和结果',
    },
    {
      name: 'challenges',
      label: '遇到的问题',
      type: 'text',
      required: false,
      placeholder: '遇到哪些困难和挑战？',
    },
    {
      name: 'style',
      label: '报告风格',
      type: 'select',
      required: true,
      default: 'professional',
      options: [
        { label: '专业正式', value: 'professional' },
        { label: '简洁要点', value: 'concise' },
        { label: '数据导向', value: 'data_driven' },
      ],
    },
  ],

  examples: [
    {
      title: '技术团队周报',
      description: '生成一份研发团队的周报',
      input: {
        reportType: 'weekly',
        workItems: '完成了用户登录模块开发\n修复了3个线上Bug\n参与了需求评审会议',
        challenges: '第三方API不稳定导致测试受阻',
        style: 'professional',
      },
    },
  ],

  stages: [
    {
      id: 'analyze_work',
      type: 'skill',
      skill: 'analyze_work',
      output: 'work_analysis',
      params: {
        items: '{{input.workItems}}',
        challenges: '{{input.challenges}}',
      },
    },
    {
      id: 'generate_report',
      type: 'skill',
      skill: 'generate_report',
      input: 'work_analysis',
      output: 'report',
      params: {
        type: '{{input.reportType}}',
        style: '{{input.style}}',
      },
    },
    {
      id: 'generate_plan',
      type: 'skill',
      skill: 'generate_plan',
      input: 'work_analysis',
      output: 'next_plan',
      params: {
        type: '{{input.reportType}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 8. 邮件撰写工作流
// ═══════════════════════════════════════════════════════════

export const emailComposeWorkflow: PresetWorkflow = {
  name: 'email-compose',
  description: '邮件撰写 — 要点输入→正式邮件→礼貌校对→发送建议',
  category: 'content',
  icon: '📧',
  triggers: ['写邮件', '邮件', '发邮件', 'business email'],
  estimatedTime: 2,
  requiredKeys: [],

  parameters: [
    {
      name: 'emailType',
      label: '邮件类型',
      type: 'select',
      required: true,
      default: 'business',
      options: [
        { label: '商务邮件', value: 'business' },
        { label: '求职邮件', value: 'job' },
        { label: '感谢信', value: 'thanks' },
        { label: '投诉邮件', value: 'complaint' },
        { label: '邀请函', value: 'invitation' },
      ],
    },
    {
      name: 'recipient',
      label: '收件人',
      type: 'string',
      required: false,
      placeholder: '如：王总 / HR / 客户',
    },
    {
      name: 'keyPoints',
      label: '邮件要点',
      type: 'text',
      required: true,
      placeholder: '想表达的核心内容，每行一个要点...',
    },
    {
      name: 'tone',
      label: '语气',
      type: 'select',
      required: true,
      default: 'professional',
      options: [
        { label: '正式专业', value: 'professional' },
        { label: '亲切友好', value: 'friendly' },
        { label: '严肃坚定', value: 'firm' },
      ],
    },
  ],

  examples: [
    {
      title: '商务合作邮件',
      description: '撰写一封商务合作邀请邮件',
      input: {
        emailType: 'business',
        recipient: '张总',
        keyPoints: '介绍公司产品\n提出合作意向\n希望安排面谈',
        tone: 'professional',
      },
    },
  ],

  stages: [
    {
      id: 'draft_email',
      type: 'skill',
      skill: 'draft_email',
      output: 'email_draft',
      params: {
        type: '{{input.emailType}}',
        recipient: '{{input.recipient}}',
        points: '{{input.keyPoints}}',
        tone: '{{input.tone}}',
      },
    },
    {
      id: 'polish_email',
      type: 'skill',
      skill: 'polish_email',
      input: 'email_draft',
      output: 'final_email',
      params: {
        tone: '{{input.tone}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 9. 会议纪要工作流
// ═══════════════════════════════════════════════════════════

export const meetingNotesWorkflow: PresetWorkflow = {
  name: 'meeting-notes',
  description: '会议纪要 — 记录整理→结构化提炼→待办分配→分发',
  category: 'content',
  icon: '🗒️',
  triggers: ['会议纪要', '会议记录', 'meeting notes', '会后整理'],
  estimatedTime: 3,
  requiredKeys: [],

  parameters: [
    {
      name: 'meetingTitle',
      label: '会议主题',
      type: 'string',
      required: true,
      placeholder: '如：Q3产品规划讨论会',
    },
    {
      name: 'rawNotes',
      label: '会议记录',
      type: 'text',
      required: true,
      placeholder: '粘贴会议中的记录、聊天内容或语音转文字...',
      description: '可以是零散的笔记、要点或录音转文字',
    },
    {
      name: 'participants',
      label: '参会人员',
      type: 'string',
      required: false,
      placeholder: '如：张三、李四、王五',
    },
    {
      name: 'outputFormat',
      label: '输出格式',
      type: 'select',
      required: true,
      default: 'markdown',
      options: [
        { label: 'Markdown', value: 'markdown' },
        { label: '纯文本', value: 'text' },
        { label: 'HTML', value: 'html' },
      ],
    },
  ],

  examples: [
    {
      title: '产品评审会议纪要',
      description: '整理产品评审会议的纪要',
      input: {
        meetingTitle: 'Q3产品规划讨论会',
        rawNotes: '讨论了新功能优先级\n张三建议先做支付\n李四认为登录优化更重要\n决定下周给出排期',
        participants: '张三、李四、王五',
        outputFormat: 'markdown',
      },
    },
  ],

  stages: [
    {
      id: 'parse_notes',
      type: 'skill',
      skill: 'parse_notes',
      output: 'parsed_items',
      params: {
        notes: '{{input.rawNotes}}',
      },
    },
    {
      id: 'structure_notes',
      type: 'skill',
      skill: 'structure_notes',
      input: 'parsed_items',
      output: 'structured_notes',
      params: {
        title: '{{input.meetingTitle}}',
        participants: '{{input.participants}}',
      },
    },
    {
      id: 'extract_todos',
      type: 'skill',
      skill: 'extract_todos',
      input: 'parsed_items',
      output: 'action_items',
    },
    {
      id: 'format_output',
      type: 'skill',
      skill: 'format_output',
      input: 'structured_notes',
      output: 'final_notes',
      params: {
        format: '{{input.outputFormat}}',
        todos: '{{action_items}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 10. 翻译校对工作流
// ═══════════════════════════════════════════════════════════

export const translateWorkflow: PresetWorkflow = {
  name: 'translate-proofread',
  description: '翻译校对 — 原文翻译→术语统一→语法校对→润色',
  category: 'content',
  icon: '🔄',
  triggers: ['翻译', '校对', 'translate', '中英互译'],
  estimatedTime: 3,
  requiredKeys: [],

  parameters: [
    {
      name: 'sourceText',
      label: '原文内容',
      type: 'text',
      required: true,
      placeholder: '粘贴需要翻译的文本...',
    },
    {
      name: 'sourceLang',
      label: '源语言',
      type: 'select',
      required: true,
      default: 'auto',
      options: [
        { label: '自动检测', value: 'auto' },
        { label: '中文', value: 'zh' },
        { label: '英文', value: 'en' },
        { label: '日文', value: 'ja' },
        { label: '韩文', value: 'ko' },
      ],
    },
    {
      name: 'targetLang',
      label: '目标语言',
      type: 'select',
      required: true,
      default: 'en',
      options: [
        { label: '中文', value: 'zh' },
        { label: '英文', value: 'en' },
        { label: '日文', value: 'ja' },
        { label: '韩文', value: 'ko' },
      ],
    },
    {
      name: 'domain',
      label: '领域',
      type: 'select',
      required: false,
      default: 'general',
      options: [
        { label: '通用', value: 'general' },
        { label: '技术/IT', value: 'tech' },
        { label: '法律', value: 'legal' },
        { label: '医学', value: 'medical' },
        { label: '商务', value: 'business' },
      ],
    },
  ],

  examples: [
    {
      title: '技术文档中英翻译',
      description: '将中文技术文档翻译为英文',
      input: {
        sourceText: '这个模块负责处理用户认证和权限管理。',
        sourceLang: 'zh',
        targetLang: 'en',
        domain: 'tech',
      },
    },
  ],

  stages: [
    {
      id: 'translate',
      type: 'skill',
      skill: 'translate',
      output: 'translation',
      params: {
        text: '{{input.sourceText}}',
        source: '{{input.sourceLang}}',
        target: '{{input.targetLang}}',
        domain: '{{input.domain}}',
      },
    },
    {
      id: 'proofread',
      type: 'skill',
      skill: 'proofread',
      input: 'translation',
      output: 'proofread_text',
      params: {
        domain: '{{input.domain}}',
      },
    },
    {
      id: 'polish',
      type: 'skill',
      skill: 'polish',
      input: 'proofread_text',
      output: 'final_text',
      params: {
        target: '{{input.targetLang}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 11. PPT大纲生成工作流
// ═══════════════════════════════════════════════════════════

export const pptOutlineWorkflow: PresetWorkflow = {
  name: 'ppt-outline',
  description: 'PPT大纲生成 — 主题分析→结构设计→每页内容→演讲备注',
  category: 'content',
  icon: '📊',
  triggers: ['PPT', '演示文稿', '幻灯片', 'presentation'],
  estimatedTime: 5,
  requiredKeys: [],

  parameters: [
    {
      name: 'topic',
      label: '演示主题',
      type: 'string',
      required: true,
      placeholder: '如：2024年度产品规划',
    },
    {
      name: 'audience',
      label: '目标受众',
      type: 'select',
      required: true,
      default: 'team',
      options: [
        { label: '团队内部', value: 'team' },
        { label: '公司高管', value: 'executive' },
        { label: '客户/合作方', value: 'client' },
        { label: '公开演讲', value: 'public' },
      ],
    },
    {
      name: 'slideCount',
      label: '幻灯片数量',
      type: 'select',
      required: true,
      default: 10,
      options: [
        { label: '5页 (简报)', value: 5 },
        { label: '10页 (标准)', value: 10 },
        { label: '20页 (详细)', value: 20 },
      ],
    },
    {
      name: 'includeNotes',
      label: '包含演讲备注',
      type: 'boolean',
      required: false,
      default: true,
    },
  ],

  examples: [
    {
      title: '产品发布演示',
      description: '生成一个新产品发布的PPT大纲',
      input: {
        topic: 'AgentAI Platform 2.0 发布',
        audience: 'client',
        slideCount: 10,
        includeNotes: true,
      },
    },
  ],

  stages: [
    {
      id: 'analyze_topic',
      type: 'skill',
      skill: 'analyze_topic',
      output: 'topic_analysis',
      params: {
        topic: '{{input.topic}}',
        audience: '{{input.audience}}',
      },
    },
    {
      id: 'design_structure',
      type: 'skill',
      skill: 'design_structure',
      input: 'topic_analysis',
      output: 'slide_structure',
      params: {
        count: '{{input.slideCount}}',
      },
    },
    {
      id: 'write_content',
      type: 'skill',
      skill: 'write_content',
      input: 'slide_structure',
      output: 'slide_content',
      params: {
        includeNotes: '{{input.includeNotes}}',
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 12. 头脑风暴工作流
// ═══════════════════════════════════════════════════════════

export const brainstormWorkflow: PresetWorkflow = {
  name: 'brainstorm',
  description: '头脑风暴 — 主题发散→多角度分析→方案对比→推荐',
  category: 'content',
  icon: '💡',
  triggers: ['头脑风暴', '创意', 'brainstorm', '想法', '点子'],
  estimatedTime: 4,
  requiredKeys: [],

  parameters: [
    {
      name: 'topic',
      label: '主题',
      type: 'string',
      required: true,
      placeholder: '如：如何提高用户留存率',
    },
    {
      name: 'perspectives',
      label: '分析角度',
      type: 'select',
      required: true,
      default: 'multi',
      options: [
        { label: '多角度全面分析', value: 'multi' },
        { label: '用户视角', value: 'user' },
        { label: '商业视角', value: 'business' },
        { label: '技术视角', value: 'tech' },
      ],
    },
    {
      name: 'ideaCount',
      label: '方案数量',
      type: 'select',
      required: true,
      default: 5,
      options: [
        { label: '3个', value: 3 },
        { label: '5个', value: 5 },
        { label: '10个', value: 10 },
      ],
    },
  ],

  examples: [
    {
      title: '增长策略头脑风暴',
      description: '为产品增长进行头脑风暴',
      input: {
        topic: '如何提高新用户注册转化率',
        perspectives: 'multi',
        ideaCount: 5,
      },
    },
  ],

  stages: [
    {
      id: 'diverge',
      type: 'skill',
      skill: 'diverge_ideas',
      output: 'raw_ideas',
      params: {
        topic: '{{input.topic}}',
        perspectives: '{{input.perspectives}}',
        count: '{{input.ideaCount}}',
      },
    },
    {
      id: 'analyze',
      type: 'skill',
      skill: 'analyze_ideas',
      input: 'raw_ideas',
      output: 'analyzed_ideas',
      params: {
        topic: '{{input.topic}}',
      },
    },
    {
      id: 'recommend',
      type: 'skill',
      skill: 'recommend_ideas',
      input: 'analyzed_ideas',
      output: 'recommendations',
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// 13. 项目方案生成工作流
// ═══════════════════════════════════════════════════════════

export const projectPlanWorkflow: PresetWorkflow = {
  name: 'project-plan',
  description: '项目方案 — 需求分析→技术选型→架构设计→排期规划',
  category: 'code',
  icon: '🏗️',
  triggers: ['项目方案', '技术方案', 'project plan', '架构设计'],
  estimatedTime: 8,
  requiredKeys: [],

  parameters: [
    {
      name: 'projectName',
      label: '项目名称',
      type: 'string',
      required: true,
      placeholder: '如：电商平台重构',
    },
    {
      name: 'requirements',
      label: '需求描述',
      type: 'text',
      required: true,
      placeholder: '描述项目的核心需求和目标...',
    },
    {
      name: 'techStack',
      label: '技术栈偏好',
      type: 'string',
      required: false,
      placeholder: '如：React + Node.js + PostgreSQL',
    },
    {
      name: 'timeline',
      label: '期望周期',
      type: 'select',
      required: true,
      default: '1month',
      options: [
        { label: '1周 (快速原型)', value: '1week' },
        { label: '1个月 (标准)', value: '1month' },
        { label: '3个月 (大型)', value: '3month' },
      ],
    },
  ],

  examples: [
    {
      title: '电商平台重构方案',
      description: '生成一个电商平台重构的技术方案',
      input: {
        projectName: '电商平台重构',
        requirements: '支持百万级日活\n微服务架构\n支持多端（Web/App/小程序）',
        techStack: 'React + Node.js + PostgreSQL + Redis',
        timeline: '3month',
      },
    },
  ],

  stages: [
    {
      id: 'analyze_requirements',
      type: 'skill',
      skill: 'analyze_requirements',
      output: 'req_analysis',
      params: {
        name: '{{input.projectName}}',
        requirements: '{{input.requirements}}',
      },
    },
    {
      id: 'tech_selection',
      type: 'skill',
      skill: 'tech_selection',
      input: 'req_analysis',
      output: 'tech_choices',
      params: {
        preference: '{{input.techStack}}',
      },
    },
    {
      id: 'architecture',
      type: 'skill',
      skill: 'design_architecture',
      input: 'tech_choices',
      output: 'architecture',
    },
    {
      id: 'schedule',
      type: 'skill',
      skill: 'create_schedule',
      input: 'architecture',
      output: 'project_schedule',
      params: {
        timeline: '{{input.timeline}}',
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
  webSummaryWorkflow,
  workReportWorkflow,
  emailComposeWorkflow,
  meetingNotesWorkflow,
  translateWorkflow,
  pptOutlineWorkflow,
  brainstormWorkflow,
  projectPlanWorkflow,
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
