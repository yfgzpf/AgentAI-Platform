/**
 * IndustryEngine v2 — 多行业知识引擎
 * =================================================================
 * 数据源: 2026-08-28 从 ~690 行内联硬编码迁入 industry-data/ JSON 配置
 *   - constants.json        → 静态常量 (美缝系数/空间模板/报价/字段)
 *   - themes.json           → 行业主题色
 *   - industry-meta.json    → 行业元数据 (标签/格式/知识库/技能定义)
 *   技能 handler 仍保留在 TypeScript 中 (无法 JSON 序列化)
 *
 * 6 大完整工作流:
 *   1. 图纸识别 (CAD → 房间数据)
 *   2. 需求解析 (自然语言 → 结构化)
 *   3. 报价生成 (空间报价法 → Excel)
 *   4. 材料计算 (面积 → 工程量)
 *   5. 施工图出图 (DXF 标准图框)
 *   6. 知识查询 (建材/工艺/人工费)
 * =================================================================
 * 学自: zyai 装修报价系统 12 模块 + 築廷装饰实战经验
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, 'industry-data');

// ======================== JSON 数据加载 ========================

/** 从 JSON 文件加载数据 */
function loadJSON<T>(filename: string): T {
  const fp = path.join(DATA_DIR, filename);
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as T;
  } catch (e: any) {
    console.warn(`[industry-engine] failed to load ${filename}:`, e?.message);
    return {} as T;
  }
}

interface ConstantsData {
  GROUT_COEFFICIENTS: Record<string, number>;
  STANDARD_SPACES: Array<{ id: string; label: string; requiredItems: string[]; optionalItems: string[] }>;
  INDEPENDENT_ITEMS: Array<{ name: string; items: string[] }>;
  QUALITY_PRICE_REF: Record<string, Record<string, number>>;
  QUOTATION_FIELDS: Array<{ name: string; label: string; type: string; placeholder?: string; required?: boolean; default?: any; options?: any[] }>;
}

interface IndustryMeta {
  id: string;
  label: string;
  themeId: string;
  supportedFormats: string[];
  knowledgeFiles: string[];
  skills: Array<{ name: string; description: string; category: string }>;
}

interface IndustryMetaMap {
  [key: string]: IndustryMeta;
}

// 加载 JSON 数据
const _constants = loadJSON<ConstantsData>('constants.json');
const _themes = loadJSON<Record<string, IndustryTheme>>('themes.json');
const _meta = loadJSON<IndustryMetaMap>('industry-meta.json');

const GROUT_COEFFICIENTS = _constants.GROUT_COEFFICIENTS || {};
const STANDARD_SPACES = _constants.STANDARD_SPACES || [];
const INDEPENDENT_ITEMS = _constants.INDEPENDENT_ITEMS || [];
const QUALITY_PRICE_REF = _constants.QUALITY_PRICE_REF || {};
const QUOTATION_FIELDS = _constants.QUOTATION_FIELDS || [];
const INDUSTRY_THEMES = _themes;

const AGENTAI_DIR = path.join(os.homedir(), '.agentai');

// ======================== 美缝计算器 ========================

function parseTileSpec(spec: string): [number, number] | null {
  const m = spec.match(/(\d+)×(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]!), parseInt(m[2]!)];
}

function calcGroutMeters(area: number, tileSpec: string): number {
  let coef = GROUT_COEFFICIENTS[tileSpec];
  if (!coef) {
    const dims = parseTileSpec(tileSpec);
    if (dims) coef = (1 / (dims[0]/1000 * dims[1]/1000)) * ((dims[0] + dims[1])/1000 * 2);
    else coef = 5.0;
  }
  return Math.round(area * coef * 100) / 100;
}

// ======================== 类型定义 ========================

export interface IndustryTheme {
  color: string;        // 主题色 (hex)
  icon: string;         // 图标 emoji
  bgColor: string;      // 背景色 (hex, 半透明)
}

export interface IndustryConfig {
  id: string;
  label: string;
  theme: IndustryTheme;
  supportedFormats: string[];
  knowledgeFiles: string[];
  skills: IndustrySkillDef[];
}

export interface IndustrySkillDef {
  name: string;
  description: string;
  category: 'format' | 'knowledge' | 'workflow' | 'tcm-diagnostic' | 'tcm-classic' | 'tcm-case' | 'tcm-herb' | 'tcm-wellness';
  parameters?: Record<string, any>;
  handler: (args: any, ctx?: any) => Promise<{ success: boolean; output: string; data?: any }>;
}

// ======================== 技能 Handler 工厂 ========================

/** 根据技能名返回对应的 handler 函数 */
function getSkillHandler(name: string): ((args: any, ctx?: any) => Promise<{ success: boolean; output: string; data?: any }>) | null {
  const handlers: Record<string, (args: any, ctx?: any) => Promise<{ success: boolean; output: string; data?: any }>> = {

    // ==================== 装修: 图纸识别 ====================
    recognize_blueprint: async (args) => {
      const filePath = args.filePath || args.file_path || '';
      const ext = path.extname(filePath).toLowerCase();
      let guide = '';
      if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
        guide = '图片分析模式: 使用多模态识别提取房间名称、面积标注、尺寸标注。\nAI需要: 1)识别每个房间 2)提取面积数字(以m²/㎡结尾) 3)识别门窗符号 4)计算总面积。\n\n参考: 築廷装饰森林海2#203项目, 从图中识别到客厅44.71m²、主卧13.95m²、次卧10.04m²等9个房间。';
      } else if (ext === '.dxf') {
        guide = 'DXF解析模式: 使用ezdxf库解析。步骤:\n1)读取TEXT/MTEXT实体提取房间名称\n2)读取DIMENSION实体提取尺寸标注\n3)根据LAYER过滤识别门窗\n4)计算每个房间的周长和面积。\n可执行: pip install ezdxf && python -m cad_analyzer';
      } else if (ext === '.dwg') {
        guide = 'DWG解析模式: 需先转换为DXF或图片。\n方案1: soffice --headless --convert-to dxf file.dwg\n方案2: 使用ODA File Converter\n方案3: 截图后用多模态识别';
      } else {
        guide = 'PDF模式: 用pandoc或pdf解析库提取文字，或用多模态LLM识别户型图页面。';
      }
      return { success: true, output: `[蓝图识别] ${filePath}${guide ? '\n\n' + guide : ''}`, data: { format: ext, filePath, status: 'recognized' } };
    },

    // ==================== 装修: 需求解析 ====================
    parse_requirement: async (args) => {
      const text = args.text || args.query || '';
      const patterns = { area: /(\d+\.?\d*)\s*[平米㎡]/g, price: /(\d+\.?\d*)\s*[万元块]/g, room: /(客厅|餐厅|主卧|次卧|儿童房|厨房|卫生间|阳台|玄关|过道)/g, material: /(瓷砖|地板|乳胶漆|橱柜|衣柜|断桥铝|木门|大理石|石英石|岩板)/g };
      const result: Record<string, any> = {};
      const areaMatches = [...text.matchAll(patterns.area)].map(m => parseFloat(m[1]!));
      const priceMatches = [...text.matchAll(patterns.price)].map(m => parseFloat(m[1]!));
      const rooms = [...new Set(text.match(patterns.room))];
      const materials = [...new Set(text.match(patterns.material))];
      if (areaMatches.length > 0) result.total_area_hint = areaMatches;
      if (priceMatches.length > 0) result.budget_hint = priceMatches;
      if (rooms.length > 0) result.rooms = rooms;
      if (materials.length > 0) result.materials = materials;
      return { success: true, output: `[需求解析] ${JSON.stringify(result, null, 2)}${Object.keys(result).length === 0 ? '\n未提取到结构化数据，需要追问客户。' : ''}`, data: result };
    },

    // ==================== 装修: 生成报价 ====================
    generate_quotation: async (args) => {
      const area = args.area || args.total_area || 100;
      const level = args.level || args.quality_level || 'mid';
      const priceMap: Record<string, number> = QUALITY_PRICE_REF[level] ?? QUALITY_PRICE_REF.mid!;
      const actualArea = Number(area);
      const roomAreas: Record<string, { name: string; area: number; perimeter: number }> = args.room_areas || {
        living_room: { name: '客餐厅', area: Math.round(actualArea * 0.35 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.35) * 4.2 * 100)/100 },
        master_bedroom: { name: '主卧', area: Math.round(actualArea * 0.14 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.14) * 4.2 * 100)/100 },
        bedroom_2: { name: '次卧', area: Math.round(actualArea * 0.10 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.10) * 4.2 * 100)/100 },
        kitchen: { name: '厨房', area: Math.round(actualArea * 0.08 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.08) * 4.2 * 100)/100 },
        bathroom_1: { name: '卫生间', area: Math.round(actualArea * 0.05 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.05) * 4 * 100)/100 },
        balcony: { name: '阳台', area: Math.round(actualArea * 0.05 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.05) * 4 * 100)/100 },
      };
      let totalEstimate = 0;
      const roomDetails: string[] = [];
      for (const [_key, info] of Object.entries(roomAreas)) {
        const tileCost = info.area * (priceMap.tile_floor ?? 0);
        totalEstimate += tileCost;
        roomDetails.push(`  ${info.name}: ${info.area}m², 周长${info.perimeter}m, 地砖约¥${Math.round(tileCost)}`);
      }
      totalEstimate = Math.round(totalEstimate * 1.8);
      return {
        success: true,
        output: `📊 ${level === 'mid' ? '中档' : level}装修报价估算 (空间报价法)\n总面积: ${actualArea}m² (约${totalEstimate/10000}万元)\n\n房间明细:\n${roomDetails.join('\n')}\n\n包含: 水电工程+拆除+木工+油漆+地面+墙面+顶面+管理费\n每平米约 ¥${Math.round(totalEstimate/actualArea)} 元\n\n💡 请使用 xlsx 技能生成带公式的正式报价单。`,
        data: { area: actualArea, level, estimate: totalEstimate, price_per_sqm: Math.round(totalEstimate/actualArea), roomAreas },
      };
    },

    // ==================== 装修: 材料计算 ====================
    measure_materials: async (args) => {
      const area = args.area || 25;
      const tileSpec = args.tile_spec || '800×800';
      const grout = calcGroutMeters(area, tileSpec);
      const wallArea = Math.round(area * 2.8 * 0.85 * 100) / 100;
      const latexArea = Math.round(area * 3.2 * 100) / 100;
      return {
        success: true,
        output: `[材料计算] ${area}m² 房间 (${tileSpec}瓷砖)\n\n地砖: ${Math.ceil(area * 1.05)}m² (含5%损耗)\n墙砖: ${Math.ceil(area * 2.8 * 0.75)}m² (2.2m高, 含损耗)\n美缝: ${grout}米 (${tileSpec} = ${Math.round(GROUT_COEFFICIENTS[tileSpec] || 5)}m/m² × ${area}m²)\n乳胶漆: ${Math.ceil(latexArea)}m² (墙面+顶面, 3.2系数)\n防水: ${Math.ceil(area * 1.2)}m² (含20%上翻)\n踢脚线: ${Math.ceil(Math.sqrt(area) * 4.2)}m`,
        data: { area, tileSpec, groutMeters: grout, wallArea, latexArea },
      };
    },

    // ==================== 装修: CAD ====================
    parse_dxf: async (args) => {
      const filePath = args.filePath || args.file_path || '';
      return {
        success: true,
        output: `[DXF解析] ${filePath}\n推荐使用 Python + ezdxf:\n\`\`\`python\nimport ezdxf\ndoc = ezdxf.readfile("${filePath}")\nmsp = doc.modelspace()\nfor e in msp.query("TEXT"):\n    print(e.dxf.text, e.dxf.insert)\n\`\`\`\n\n前端的 cad-import.ts 可解析为 ParsedWall/ParsedDoor/ParsedWindow 结构体。`,
        data: { filePath, tools: ['ezdxf', 'dxf-parser'] },
      };
    },
    generate_cad_drawing: async (args) => {
      const paperSize = args.paper_size || 'A3';
      const drawingType = args.drawing_type || 'architectural';
      return {
        success: true,
        output: `[CAD出图] ${paperSize} ${drawingType === 'architectural' ? '建筑图' : '结构图'}\n使用 Python + ezdxf 生成标准图框:\n\`\`\`python\nfrom ezdxf import new\ndoc = new()\nmsp = doc.modelspace()\n# 绘制图框 + 标题栏\n\`\`\`\n\n图框字段: 工程名称/图名/设计/审核/比例/图号/日期`,
        data: { paperSize, drawingType },
      };
    },

    // ==================== 装修: 知识查询 ====================
    query_materials_library: async (args) => {
      const query = (args.query || '').toLowerCase();
      const knowledge: Record<string, string> = {
        '瓷砖': '常见规格: 800×800, 750×1500, 600×1200, 900×1800\n抛釉砖: ¥80-150/m²(中档)\n岩板: ¥200-500/m²\n美缝: 聚脲 8-15元/米, 环氧 5-10元/米',
        '地板': '实木地板: ¥200-500/m²\n复合地板: ¥80-150/m²\n强化地板: ¥50-100/m²\n踢脚线: ¥15-30/m',
        '乳胶漆': '多乐士五合一: ¥48/m²(含人工)\n立邦净味: ¥42/m²\n芬琳进口: ¥78/m²\n计算: 地面面积 × 3.2 (墙面+顶面)',
        '防水': 'JS防水涂料: ¥45-78/m²\n聚氨酯防水: ¥60-100/m²\n卫生间: 墙面1.8m高+地面\n阳台: 地面+上翻30cm',
        '橱柜': '地柜: ¥1200-1800/m(中档)\n吊柜: ¥800-1200/m\n石英石台面: ¥400-800/m\n吸塑门板: ¥200-400/m',
        '衣柜': '定制衣柜: ¥800-1500/m²(投影面积)\n平开门衣柜: ¥1000-1800/m²\n推拉门衣柜: ¥1200-2000/m²',
        '吊顶': '石膏板吊顶: ¥165-185/m²(含轻钢龙骨)\n集成吊顶: ¥110/m²(铝扣板)\n边吊: ¥80-120/m',
        '门窗': '碳晶门(卧室): ¥1500-2200/套\n长虹玻璃门(卫生间): ¥1500-2000/套\n断桥铝窗: ¥500-800/m²\n750元/m²(中档)',
        '水电': '全屋水电改造: ¥6000-12000/套(100-130m²)\n强电改造: ¥35-45/m\n弱点改造: ¥25-35/m\nPPR给水管: ¥45-55/m',
      };
      let result = '建材知识库查询结果:\n\n';
      for (const [key, value] of Object.entries(knowledge)) {
        if (!query || key.includes(query) || value.includes(query)) {
          result += `### ${key}\n${value}\n\n`;
        }
      }
      if (result === '建材知识库查询结果:\n\n') result += `未找到"${query}"相关信息。可查询: 瓷砖/地板/乳胶漆/防水/橱柜/衣柜/吊顶/门窗/水电`;
      return { success: true, output: result, data: { query, found: result.includes('###') } };
    },

    // ==================== 装修: 追问表单 ====================
    quotation_form: async (args) => {
      return {
        success: true,
        output: `[报价表单] 请填写以下信息以生成精准报价:\n${QUOTATION_FIELDS.map((f: any) => `- ${f.label} (${f.type}) ${f.placeholder || ''}`).join('\n')}`,
        data: { action: 'ask_user', question: '请提供以下装修信息', options: [], fields: QUOTATION_FIELDS },
      };
    },

    // ==================== 电商 ====================
    generate_product_copy: async (args) => {
      const product = args.product || args.name || '';
      const features = args.features || '';
      return {
        success: true,
        output: `[商品文案] 为"${product}"生成文案\n核心卖点: ${features || '请描述商品特点'}\n\n建议结构:\n1. 标题(15字以内, 含核心关键词)\n2. 副标题(痛点+解决方案)\n3. 详情(规格参数/材质/尺寸)\n4. 使用场景(3个场景描述)\n5. 售后承诺`,
        data: { product, features },
      };
    },
    analyze_sales_data: async () => {
      return { success: true, output: '[销售分析] 请上传销售数据文件(.xlsx/.csv)，我将分析商品排行、转化率、退货率趋势', data: { status: 'awaiting_file' } };
    },
    generate_marketing_plan: async (args) => {
      const budget = args.budget || '待定';
      const platform = args.platform || '抖音+小红书+淘宝';
      return {
        success: true,
        output: `[营销方案] 预算${budget} | 平台: ${platform}\n\n推荐结构:\n1. 竞品分析 (3个对标品牌)\n2. 目标人群画像\n3. 内容策略 (图文/短视频/直播)\n4. 预算分配 (投流/达人/KOC)\n5. 排期表 (周维度)\n6. KPI (曝光/点击/转化/ROI)`,
        data: { budget, platform },
      };
    },
    generate_product_image_prompt: async (args) => {
      const product = args.product || '商品';
      const style = args.style || '白底图';
      return { success: true, output: `[商品图提示词] ${product} - ${style}\n\nprompt: ${product}, product photography, ${style === '白底图' ? 'white background, studio lighting, 8k' : 'lifestyle scene, natural lighting, shallow depth of field'}, commercial photography, high detail\n\nnegative: distorted, low quality, watermark, text, logo`, data: { product, style } };
    },

    // ==================== 教育 ====================
    generate_lesson_plan: async (args) => {
      const subject = args.subject || '';
      const grade = args.grade || '';
      return { success: true, output: `[教案] ${grade} ${subject}\n\n结构:\n1. 教学目标 (知识/能力/情感)\n2. 教学重难点\n3. 教学准备 (教具/资料)\n4. 教学过程 (导入→新授→练习→小结)\n5. 板书设计\n6. 作业布置`, data: { subject, grade } };
    },
    generate_exam: async (args) => {
      const subject = args.subject || '';
      const count = args.count || 20;
      return { success: true, output: `[试卷] ${subject} (${count}题)\n\n题型分配建议:\n- 选择题: ${Math.round(count*0.4)}题\n- 填空题: ${Math.round(count*0.2)}题\n- 判断题: ${Math.round(count*0.15)}题\n- 简答题: ${Math.round(count*0.25)}题\n\n请指定: 年级/单元/难度`, data: { subject, count } };
    },
    analyze_student_scores: async () => {
      return { success: true, output: '[成绩分析] 请上传成绩表(.xlsx)，我将分析: 班级平均分、分数段分布、进退步名单、知识点薄弱项', data: { status: 'awaiting_file' } };
    },
    generate_course_outline: async (args) => {
      const course = args.course || '';
      const hours = args.hours || 32;
      return { success: true, output: `[课程大纲] ${course} (${hours}学时)\n\n章节数建议: ${Math.round(hours/4)}章\n格式: 章节名→学时→教学目标→教学方式→作业`, data: { course, hours } };
    },

    // ==================== 开发者 ====================
    review_code: async () => {
      return { success: true, output: '[代码审查] 请提供代码文件路径或粘贴代码，我将检查: 命名规范、类型安全、潜在bug、性能瓶颈、安全漏洞', data: {} };
    },
    analyze_architecture: async () => {
      return { success: true, output: '[架构分析] 请提供项目根目录，我将分析: 模块划分、依赖关系、数据流向、架构模式、改进建议', data: {} };
    },
    debug_issue: async () => {
      return { success: true, output: '[Bug修复] 请提供错误信息/堆栈/复现步骤，我将: 分析根因→给出修复方案→生成修复代码', data: {} };
    },
    performance_optimize: async () => {
      return { success: true, output: '[性能优化] 请描述性能问题场景，我将分析: 瓶颈定位→优化方案→预期提升幅度', data: {} };
    },

    // ==================== 漫剧创作 ====================
    generate_script: async (args) => {
      const genre = args.genre || '';
      return { success: true, output: `[剧本创作] 类型: ${genre || '未指定'}\n\n结构:\n1. 故事梗概 (3句话)\n2. 角色设定 (姓名/性格/外貌/背景)\n3. 场景设定\n4. 分集大纲 (每集3-5页)\n5. 对白脚本`, data: { genre } };
    },
    design_character: async () => {
      return { success: true, output: '[角色设计] 请描述角色设定，我将生成: 外观描述、性格特质、背景故事、角色关系、AI绘图提示词', data: {} };
    },
    generate_storyboard: async () => {
      return { success: true, output: '[分镜脚本] 请提供剧本片段，我将生成: 镜头编号、画面描述、景别、对白、建议时长、AI绘图提示词', data: {} };
    },

    // ==================== 房地产 ====================
    generate_property_desc: async () => {
      return { success: true, output: '[房源描述] 请提供户型/面积/位置/配套等信息，我将生成: 卖点提炼、户型描述、配套介绍、投资价值分析', data: {} };
    },
    analyze_property_value: async () => {
      return { success: true, output: '[房产估值] 请提供楼盘名称/户型/面积/位置，我将分析: 周边均价对比、升值潜力、租金回报率、税费估算', data: {} };
    },
    generate_floor_plan_desc: async () => {
      return { success: true, output: '[户型分析] 请上传户型图，我将分析: 功能分区、动线设计、通风采光、空间利用率、改造建议', data: {} };
    },

    // ==================== 医疗 ====================
    analyze_symptom: async () => {
      return { success: true, output: '[症状分析] ⚠️ 重要提示: 此分析仅供参考，不作为诊断依据。请提供症状描述(部位/性质/持续时间)，我将给出可能的病因方向和就医建议', data: {} };
    },
    generate_health_report: async () => {
      return { success: true, output: '[报告解读] 请上传体检报告/检验单，我将分析: 异常指标解读、风险评估、改善建议、复查建议', data: {} };
    },
    query_drug_info: async () => {
      return { success: true, output: '[药品查询] 请输入药品名称，我将提供: 主要成分、适应症、用法用量、禁忌人群、不良反应、药物相互作用', data: {} };
    },
    tcm_diagnose: async () => {
      return { success: true, output: '[中医问诊] 请描述您的不适:\n\n我将按以下流程为您诊疗:\n1️⃣ 问诊 — 按中医十问歌(寒热/汗/头身/便溲/饮食/胸脘/耳聋/旧史)收集信息\n2️⃣ 舌诊 — 请描述舌质颜色、舌苔、舌体状态\n3️⃣ 辨证 — 八纲辨证 + 脏腑辨证 + 气血津液辨证\n4️⃣ 开方 — 经方/时方, 君臣佐使结构, 精确剂量\n5️⃣ 医嘱 — 煎服法 + 忌口 + 复诊建议\n\n⚠️ 仅供参考学习, 不替代线下医师面诊。', data: {} };
    },
    tcm_classic_search: async () => {
      return { success: true, output: '[古籍检索] 请输入关键词或病症名，我将从《伤寒论》《金匮要略》《黄帝内经》《温病条辨》等经典中检索相关条文，提供原文引用和白话解读。', data: {} };
    },
    tcm_case_match: async () => {
      return { success: true, output: '[医案匹配] 请提供当前的症状和证型信息，我将从历史医案库中匹配相似案例，展示名老中医的辨证逻辑和用药规律作为参考。', data: {} };
    },
    tcm_herb_query: async () => {
      return { success: true, output: '[药材/方剂查询] 请输入:\n- 药材名称 → 查询性味归经、功效主治、用法用量\n- 方剂名称 → 分析君臣佐使结构、加减变化\n⚠️ 含配伍禁忌检查(十八反/十九畏)', data: {} };
    },
    tcm_wellness_plan: async () => {
      return { success: true, output: '[养生调理] 请描述您的身体状况(易疲乏/怕冷/口干/体胖/情绪等)，我将根据王琦九分法辨识体质，制定个性化方案: 饮食调理、起居作息、功法推荐、季节养生要点。⚠️ 急性病症请及时就医。', data: {} };
    },

    // ==================== 法律 ====================
    draft_contract: async () => {
      return { success: true, output: '[合同起草] 请提供合同类型和关键条款，我将生成: 合同正文、关键条款说明、风险提示', data: {} };
    },
    analyze_legal_risk: async () => {
      return { success: true, output: '[法律风险分析] 请提供合同文本或行为描述，我将分析: 合规性检查、风险点识别、规避建议、相关法条引用', data: {} };
    },
    query_law: async () => {
      return { success: true, output: '[法律查询] 请输入查询关键词或法律领域，我将提供: 相关法律法规、核心条款、司法解释、典型案例', data: {} };
    },

    // ==================== 制造业 ====================
    generate_process_flow: async () => {
      return { success: true, output: '[工艺流程] 请提供产品类型和工艺要求，我将生成: 工序流程图、关键工艺参数、设备清单、质检控制点', data: {} };
    },
    analyze_quality_data: async () => {
      return { success: true, output: '[质检分析] 请上传质检数据(.xlsx/.csv)，我将分析: 合格率统计、缺陷类型分布、趋势分析、改进建议', data: {} };
    },
    estimate_production_cost: async () => {
      return { success: true, output: '[成本估算] 请提供产品BOM和工艺信息，我将估算: 材料成本、人工成本、设备折旧、管理费、总成本', data: {} };
    },
  };

  return handlers[name] || null;
}

// ======================== 构建 INDUSTRY_CONFIGS ========================

/** 从 JSON 元数据 + handler 工厂构建完整的行业配置 */
function buildIndustryConfigs(): Record<string, IndustryConfig> {
  const configs: Record<string, IndustryConfig> = {};

  for (const [id, meta] of Object.entries(_meta)) {
    const theme = INDUSTRY_THEMES[meta.themeId] || { color: '#999', icon: '📁', bgColor: 'rgba(0,0,0,0.1)' };
    const skills: IndustrySkillDef[] = [];

    for (const skillMeta of meta.skills) {
      const handler = getSkillHandler(skillMeta.name);
      if (handler) {
        skills.push({
          name: skillMeta.name,
          description: skillMeta.description,
          category: skillMeta.category as IndustrySkillDef['category'],
          handler,
        });
      }
    }

    configs[id] = {
      id: meta.id,
      label: meta.label,
      theme,
      supportedFormats: meta.supportedFormats,
      knowledgeFiles: meta.knowledgeFiles,
      skills,
    };
  }

  return configs;
}

const INDUSTRY_CONFIGS = buildIndustryConfigs();

// ======================== 公共函数 ========================

export function detectIndustryFileFormat(filePath: string): { industryId: string; ext: string; isSupported: boolean } {
  const ext = path.extname(filePath).toLowerCase();
  for (const [id, config] of Object.entries(INDUSTRY_CONFIGS)) {
    if (config.supportedFormats.includes(ext)) return { industryId: id, ext, isSupported: true };
  }
  return { industryId: 'general', ext, isSupported: false };
}

export function calcGroutMetersPublic(area: number, tileSpec: string): number {
  return calcGroutMeters(area, tileSpec);
}

export function getQualityPriceRef(level: string): Record<string, number> | null {
  return QUALITY_PRICE_REF[level] || null;
}

export function getQuotationFields() { return QUOTATION_FIELDS; }

export { STANDARD_SPACES, INDEPENDENT_ITEMS };

// ======================== IndustryEngine 类 ========================

export class IndustryEngine {
  private activeIndustry: string | null = null;
  private loadedSkills: Map<string, IndustrySkillDef> = new Map();

  async activate(industryId: string): Promise<IndustryConfig | null> {
    this.loadedSkills.clear();
    this.activeIndustry = industryId;
    const config = INDUSTRY_CONFIGS[industryId];
    if (!config) return null;

    for (const skill of config.skills) {
      this.loadedSkills.set(skill.name, skill);
    }

    // 确保知识库目录
    try {
      const kbDir = path.join(AGENTAI_DIR, 'knowledge', industryId);
      if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir, { recursive: true });
    } catch (kbDirErr: any) {
      console.warn('[industry-engine:activate] knowledge dir creation failed:', kbDirErr?.message);
    }

    // 创建知识库模板 + 自动加载到 RAG 引擎
    for (const kf of config.knowledgeFiles) {
      try {
        const fp = path.join(AGENTAI_DIR, 'knowledge', kf);
        const dir = path.dirname(fp);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(fp)) {
          const tmpl = kf.endsWith('.json') ? '{}' : kf.endsWith('.md') ? `# ${path.basename(kf, path.extname(kf))}\n` : '';
          try { fs.writeFileSync(fp, tmpl, 'utf-8'); } catch (tmplErr: any) {
            console.warn('[industry-engine:activate] template write failed for', fp, tmplErr?.message);
          }
        } else {
          try {
            const { getKnowledgeBase } = await import('./industry-knowledge-base.js');
            const kb = getKnowledgeBase();
            const content = fs.readFileSync(fp, 'utf-8');
            if (content && content.length > 10) {
              kb.addTextDocument(path.basename(kf), content, industryId, 'auto_discover', `行业知识库: ${kf}`);
              console.log(`[industry] RAG loaded: ${kf} (${content.length} chars)`);
            }
          } catch (ragErr: any) {
            console.warn('[industry-engine:activate] RAG load failed for', kf, ragErr?.message);
          }
        }
      } catch (kfErr: any) {
        console.warn('[industry-engine:activate] knowledge file init failed for', kf, kfErr?.message);
      }
    }

    console.log(`[industry] activated ${industryId}: ${config.skills.length} skills, ${config.supportedFormats.length} formats`);
    return config;
  }

  getActive(): IndustryConfig | null {
    if (!this.activeIndustry) return null;
    return INDUSTRY_CONFIGS[this.activeIndustry] || null;
  }

  getSkills(): IndustrySkillDef[] { return [...this.loadedSkills.values()]; }

  getSupportedFormats(): string[] {
    return this.getActive()?.supportedFormats || [];
  }

  getAllIndustries(): IndustryConfig[] {
    return Object.values(INDUSTRY_CONFIGS);
  }

  getIndustryTheme(industryId: string): IndustryTheme | null {
    return INDUSTRY_THEMES[industryId] || null;
  }

  getConfig(industryId: string): IndustryConfig | null {
    return INDUSTRY_CONFIGS[industryId] || null;
  }

  buildSystemPromptFragmentFor(industryId: string): string {
    const config = INDUSTRY_CONFIGS[industryId];
    if (!config) return '';

    const skillList = config.skills.map(s => `- **${s.name}**: ${s.description}`).join('\n');
    const formatList = config.supportedFormats.map(f => `- \`${f}\``).join('\n');

    return `
# 行业: ${config.label} (${config.theme.icon})
## 支持的文件格式
${formatList}

## 行业技能
${skillList}

## 行业规则
- 请根据当前行业 ${config.label} 的规范开展工作
- 使用行业技能完成专业任务
- 文件格式不符时告知用户支持的格式
`;
  }

  /** @deprecated 死代码, 保留兼容. 请使用 getConfig() 替代. */
  activateFromProfile(profile: { industry?: string }) {
    if (profile.industry && profile.industry !== 'general') {
      return this.activate(profile.industry);
    }
    return null;
  }
}

export const industryEngine = new IndustryEngine();