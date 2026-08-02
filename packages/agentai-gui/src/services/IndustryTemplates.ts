/**
 * IndustryTemplates — 行业提示词模板库
 * 学自: zyai 装修设计模块 + 装饰AI智能报价系统
 */
export interface IndustryTemplate {
  id: string;
  label: string;
  icon: string;
  description: string;
  /** 生图提示词后缀 */
  imageSuffix: string;
  /** 视频提示词后缀 */
  videoSuffix: string;
  /** 需要加载的技能 */
  requiredSkills: string[];
  /** 知识问卷 (自动记忆) */
  knowledgeQuestions: string[];
}

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    id: 'general', label: '通用', icon: '🌐', description: '无需行业定向, 使用通用技能',
    imageSuffix: 'high quality, detailed',
    videoSuffix: 'cinematic, smooth motion',
    requiredSkills: [],
    knowledgeQuestions: [],
  },
  {
    id: 'developer', label: '开发者', icon: '💻', description: '代码开发/调试/架构设计, 跳过行业问卷',
    imageSuffix: 'code screenshot, dark theme, syntax highlighted',
    videoSuffix: 'coding tutorial, screen recording',
    requiredSkills: ['代码生成', '调试分析', '架构设计', '代码审查'],
    knowledgeQuestions: [],
  },
  {
    id: 'decoration', label: '装修建材', icon: '🏠', description: '家装设计/建材报价/效果图/施工图',
    imageSuffix: 'interior design, architectural visualization, 8k render, natural lighting',
    videoSuffix: 'architectural walkthrough, interior tour, smooth camera movement',
    requiredSkills: ['室内设计', '3D建模', '施工图生成', '报价计算'],
    knowledgeQuestions: [
      '您主要做的是家装还是工装?',
      '您的目标客户群体是什么? (业主/设计师/施工队)',
      '您常用的设计风格有哪些? (现代/中式/欧式/日式)',
      '您是否需要自动报价功能? 主要涉及哪些材料?',
      '您是否需要3D效果图/全景图生成?',
    ],
  },
  {
    id: 'comic', label: '漫剧创作', icon: '🎬', description: '漫画/短剧/动画全流程创作',
    imageSuffix: 'anime style, manga illustration, vibrant colors, clean lineart',
    videoSuffix: 'anime animation, 24fps, smooth keyframe interpolation',
    requiredSkills: ['剧本创作', '角色设计', '分镜生成', '视频合成'],
    knowledgeQuestions: [
      '您创作的主要类型是什么? (漫画/短剧/动画)',
      '您的目标平台是什么? (抖音/B站/YouTube)',
      '您偏好的风格是什么? (日系/国风/美漫/韩漫)',
      '您是否需要AI辅助剧本创作?',
      '您是否需要角色一致性和场景连贯性保障?',
    ],
  },
  {
    id: 'ecommerce', label: '电商营销', icon: '🛒', description: '商品图/广告视频/社交媒体内容',
    imageSuffix: 'product photography, commercial lighting, white background, 8k',
    videoSuffix: 'product showcase, commercial ad, smooth product rotation',
    requiredSkills: ['商品拍摄', '广告文案', '社交媒体运营', '数据分析'],
    knowledgeQuestions: [
      '您主要经营什么品类?',
      '您的销售渠道是什么? (淘宝/抖音/独立站)',
      '您是否需要批量生成商品图?',
      '您是否需要短视频广告模板?',
      '您的品牌调性是什么? (高端/平价/年轻/传统)',
    ],
  },
  {
    id: 'education', label: '教育培训', icon: '📚', description: '课件/教学视频/知识付费内容',
    imageSuffix: 'educational illustration, clean design, infographic style',
    videoSuffix: 'educational video, clear presentation, smooth transitions',
    requiredSkills: ['课件制作', '知识管理', '内容分发', '学员管理'],
    knowledgeQuestions: [
      '您教授的学科领域是什么?',
      '您的教学形式是什么? (录播/直播/图文)',
      '您的目标学员是什么群体? (K12/成人/企业)',
      '您是否需要自动生成课件?',
      '您是否需要题库和考试系统?',
    ],
  },
  {
    id: 'realestate', label: '房产中介', icon: '🏘️', description: '房源展示/VR看房/楼盘宣传',
    imageSuffix: 'real estate photography, wide angle, bright natural light, HDR',
    videoSuffix: 'property tour, drone aerial view, smooth walkthrough',
    requiredSkills: ['VR全景', '楼盘展示', '客户管理', '数据分析'],
    knowledgeQuestions: [
      '您主要做新房还是二手房?',
      '您的房源类型是什么? (住宅/商业/别墅)',
      '您是否需要VR全景看房功能?',
      '您是否需要自动生成房源描述?',
      '您的客户管理需求是什么?',
    ],
  },
  {
    id: 'medical', label: '医疗健康', icon: '🏥', description: '医学影像/健康咨询/病历管理',
    imageSuffix: 'medical illustration, anatomical accuracy, clean professional',
    videoSuffix: 'medical animation, educational, clear visualization',
    requiredSkills: ['医学知识库', '影像分析', '隐私保护', '合规审查'],
    knowledgeQuestions: [
      '您的医疗领域是什么? (临床/医美/康复/中医)',
      '您是否需要医学影像分析功能?',
      '您的合规要求是什么? (HIPAA/个人信息保护法)',
      '您是否需要患者管理系统?',
    ],
  },
  {
    id: 'legal', label: '法律服务', icon: '⚖️', description: '合同审查/法律咨询/文书生成',
    imageSuffix: 'professional legal imagery, clean office, formal',
    videoSuffix: 'professional presentation, clear and formal',
    requiredSkills: ['法律知识库', '合同审查', '文书生成', '合规检查'],
    knowledgeQuestions: [
      '您主要处理什么类型的案件? (民事/刑事/商事/知识产权)',
      '您是否需要合同审查和生成功能?',
      '您的客户群体是什么? (个人/企业/政府)',
      '您是否需要案例检索和法律知识库?',
    ],
  },
];

/** 根据行业ID获取模板 */
export function getIndustryTemplate(id: string): IndustryTemplate | undefined {
  return INDUSTRY_TEMPLATES.find(t => t.id === id);
}

/** 获取所有行业选项 */
export function getIndustryOptions() {
  return INDUSTRY_TEMPLATES.map(t => ({ value: t.id, label: `${t.icon} ${t.label}`, desc: t.description }));
}
