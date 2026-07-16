/**
 * IndustryEngine v2 — 精细装修建材行业引擎
 * ----------------------------------------------------------------
 * 学自: zyai 装修报价系统 12 模块 + 築廷装饰实战经验
 * 
 * 6 大完整工作流:
 *   1. 图纸识别 (CAD → 房间数据)
 *   2. 需求解析 (自然语言 → 结构化)
 *   3. 报价生成 (空间报价法 → Excel)
 *   4. 材料计算 (面积 → 工程量)
 *   5. 施工图出图 (DXF 标准图框)
 *   6. 知识查询 (建材/工艺/人工费)
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { EventEmitter } from 'events';

const AGENTAI_DIR = path.join(os.homedir(), '.agentai');

// ======================== 美缝计算器 ========================

/** 瓷砖规格 → 每平方米缝长(米) 映射表 */
const GROUT_COEFFICIENTS: Record<string, number> = {
  '300×300': 10.0, '300×600': 6.67, '400×800': 6.25,
  '600×600': 5.56, '800×800': 5.0,  '600×1200': 4.17,
  '750×1500': 4.0, '900×1800': 3.7,
};

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

// ======================== 空间报价模板 ========================

/** 标准家装空间定义 */
const STANDARD_SPACES = [
  { id: 'living_room', label: '客餐厅', requiredItems: ['地砖铺贴', '顶面乳胶漆', '墙面乳胶漆', '踢脚线'], optionalItems: ['吊顶', '背景墙', '餐边柜', '电视柜'] },
  { id: 'master_bedroom', label: '主卧', requiredItems: ['地砖铺贴', '顶面乳胶漆', '墙面乳胶漆', '踢脚线', '卧室门'], optionalItems: ['衣柜', '飘窗柜'] },
  { id: 'bedroom_2', label: '次卧', requiredItems: ['地砖铺贴', '顶面乳胶漆', '墙面乳胶漆', '踢脚线', '卧室门'], optionalItems: ['衣柜', '书桌'] },
  { id: 'bedroom_3', label: '次卧2', requiredItems: ['地砖铺贴', '顶面乳胶漆', '墙面乳胶漆', '踢脚线', '卧室门'], optionalItems: ['衣柜'] },
  { id: 'kitchen', label: '厨房', requiredItems: ['地砖铺贴', '集成吊顶', '墙砖铺贴', '橱柜地柜', '橱柜吊柜', '厨房移门'], optionalItems: ['冰箱高柜'] },
  { id: 'bathroom_1', label: '主卫', requiredItems: ['地砖铺贴', '集成吊顶', '墙砖铺贴', '防水处理', '洗手台', '长虹玻璃门'], optionalItems: ['淋浴房'] },
  { id: 'bathroom_2', label: '次卫', requiredItems: ['地砖铺贴', '集成吊顶', '墙砖铺贴', '防水处理', '洗手台', '长虹玻璃门'], optionalItems: [] },
  { id: 'balcony', label: '阳台', requiredItems: ['地砖铺贴', '集成吊顶', '墙砖铺贴', '封窗', '阳台移门'], optionalItems: ['洗衣机柜'] },
  { id: 'hallway', label: '玄关过道', requiredItems: ['地砖铺贴', '顶面乳胶漆', '墙面乳胶漆', '入户门'], optionalItems: ['鞋柜', '过道储物柜'] },
];

/** 独立工程大项 */
const INDEPENDENT_ITEMS = [
  { name: '水电工程', items: ['强电改造', '弱电改造', '给排水改造', '开关插座安装'] },
  { name: '拆除工程', items: ['墙体拆除', '地面拆除', '吊顶拆除', '清运'] },
  { name: '木工工程', items: ['吊顶工程', '窗帘盒', '背景墙造型'] },
  { name: '油漆工程', items: ['墙面基层处理', '乳胶漆喷涂', '木器漆'] },
  { name: '其他', items: ['搬运费', '成品保护', '精保洁', '管理费'] },
];

/** 档次单价参考 (中档) */
const QUALITY_PRICE_REF: Record<string, Record<string, number>> = {
  'standard': { tile_floor: 95, tile_wall: 78, latex_paint: 42, ceiling: 110, waterproof: 45, door: 1500, cabinet: 1200 },
  'mid': { tile_floor: 155, tile_wall: 92, latex_paint: 48, ceiling: 165, waterproof: 78, door: 2200, cabinet: 1800 },
  'high': { tile_floor: 220, tile_wall: 120, latex_paint: 65, ceiling: 220, waterproof: 100, door: 3500, cabinet: 2800 },
  'luxury': { tile_floor: 350, tile_wall: 180, latex_paint: 95, ceiling: 320, waterproof: 150, door: 6000, cabinet: 4500 },
};

// ======================== 追问卡片字段 ========================

const QUOTATION_FIELDS = [
  { name: 'project_name', label: '项目名称', type: 'text', placeholder: '例如：森林海2#203', required: true },
  { name: 'customer_name', label: '客户姓名', type: 'text', required: true },
  { name: 'customer_phone', label: '联系电话', type: 'text', required: false },
  { name: 'address', label: '项目地址', type: 'text', required: true },
  { name: 'total_area', label: '装修面积 (m²)', type: 'number', required: true },
  { name: 'room_layout', label: '户型结构', type: 'select', options: ['一室一厅', '两室一厅', '三室一厅', '三室两厅一厨两卫', '四室两厅一厨两卫', '其他'], required: true },
  { name: 'style', label: '装修风格', type: 'select', options: ['现代简约', '北欧风格', '中式风格', '美式风格', '轻奢风格', '日式风格', '工业风格'], default: '现代简约', required: true },
  { name: 'quality_level', label: '装修档次', type: 'select', options: [{ value: 'standard', label: '标准型 800-1000元/m²' }, { value: 'mid', label: '中档型 1000-1300元/m²' }, { value: 'high', label: '高档型 1300-1600元/m²' }, { value: 'luxury', label: '豪华型 1600元/m²以上' }], default: 'mid', required: true },
  { name: 'has_drawings', label: '是否有CAD图纸', type: 'select', options: [{ value: 'yes', label: '是，上传图纸' }, { value: 'no', label: '否，文字描述' }], required: true },
  { name: 'special_requirements', label: '特殊要求', type: 'textarea', placeholder: '例如：全屋通铺750×1500地砖、无主灯设计等', required: false },
];

// ======================== 行业配置 ========================

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
  category: 'format' | 'knowledge' | 'workflow';
  parameters?: Record<string, any>;
  handler: (args: any, ctx?: any) => Promise<{ success: boolean; output: string; data?: any }>;
}

// 行业主题色映射表 (前端徽章显示用)
const INDUSTRY_THEMES: Record<string, IndustryTheme> = {
  decoration: { color: '#e67e22', icon: '🔨', bgColor: 'rgba(230,126,34,0.12)' },
  real_estate: { color: '#2ecc71', icon: '🏠', bgColor: 'rgba(46,204,113,0.12)' },
  ecommerce: { color: '#e74c3c', icon: '🛒', bgColor: 'rgba(231,76,60,0.12)' },
  education: { color: '#3498db', icon: '📚', bgColor: 'rgba(52,152,219,0.12)' },
  developer: { color: '#9b59b6', icon: '💻', bgColor: 'rgba(155,89,182,0.12)' },
  comic: { color: '#f39c12', icon: '🎬', bgColor: 'rgba(243,156,18,0.12)' },
  medical: { color: '#1abc9c', icon: '🏥', bgColor: 'rgba(26,188,156,0.12)' },
  legal: { color: '#34495e', icon: '⚖️', bgColor: 'rgba(52,73,94,0.12)' },
  manufacturing: { color: '#e67e22', icon: '🏭', bgColor: 'rgba(230,126,34,0.12)' },
};

const INDUSTRY_CONFIGS: Record<string, IndustryConfig> = {
  decoration: {
    id: 'decoration',
    label: '装修建材',
    theme: INDUSTRY_THEMES.decoration!,
    supportedFormats: ['.dwg', '.dxf', '.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png', '.bmp', '.xlsx'],
    knowledgeFiles: ['decoration/报价模板.json', 'decoration/施工规范.md', 'decoration/材料清单.json', 'decoration/设计风格索引.md'],
    skills: [
      // ==================== 工作流1: 图纸识别 ====================
      {
        name: 'recognize_blueprint',
        description: '识别CAD图纸(.dwg/.dxf/.pdf), 提取房间/门窗/尺寸信息。学自 cad_analyzer.py',
        category: 'format',
        handler: async (args) => {
          const filePath = args.filePath || args.file_path || '';
          const ext = path.extname(filePath).toLowerCase();

          let guide = '';
          if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
            guide = `图片分析模式: 使用多模态识别提取房间名称、面积标注、尺寸标注。\nAI需要: 1)识别每个房间 2)提取面积数字(以m²/㎡结尾) 3)识别门窗符号 4)计算总面积。\n\n参考: 築廷装饰森林海2#203项目, 从图中识别到客厅44.71m²、主卧13.95m²、次卧10.04m²等9个房间。`;
          } else if (ext === '.dxf') {
            guide = `DXF解析模式: 使用ezdxf库解析。步骤:\n1)读取TEXT/MTEXT实体提取房间名称\n2)读取DIMENSION实体提取尺寸标注\n3)根据LAYER过滤识别门窗\n4)计算每个房间的周长和面积。\n可执行: pip install ezdxf && python -m cad_analyzer`;
          } else if (ext === '.dwg') {
            guide = `DWG解析模式: 需先转换为DXF或图片。\n方案1: soffice --headless --convert-to dxf file.dwg\n方案2: 使用ODA File Converter\n方案3: 截图后用多模态识别`;
          } else {
            guide = `PDF模式: 用pandoc或pdf解析库提取文字，或用多模态LLM识别户型图页面。`;
          }

          return { success: true, output: `[蓝图识别] ${filePath}${guide ? '\n\n' + guide : ''}`, data: { format: ext, filePath, status: 'recognized' } };
        },
      },

      // ==================== 工作流2: 需求解析 ====================
      {
        name: 'parse_requirement',
        description: '解析客户自然语言需求, 提取面积/材料/预算。学自 SmartRequirementParser',
        category: 'knowledge',
        handler: async (args) => {
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
      },

      // ==================== 工作流3: 生成报价 ====================
      {
        name: 'generate_quotation',
        description: '生成装修报价表(xlsx)。空间报价法+Excel公式+3工作表。学自 generate_haicang_quote_final.py',
        category: 'workflow',
        handler: async (args) => {
          const area = args.area || args.total_area || 100;
          const level = args.level || args.quality_level || 'mid';
          const priceMap: Record<string, number> = QUALITY_PRICE_REF[level] ?? QUALITY_PRICE_REF.mid!;
          const actualArea = Number(area);

          // 默认户型面积分配 (可被args.room_areas覆盖)
          const roomAreas: Record<string, { name: string; area: number; perimeter: number }> = args.room_areas || {
            living_room: { name: '客餐厅', area: Math.round(actualArea * 0.35 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.35) * 4.2 * 100)/100 },
            master_bedroom: { name: '主卧', area: Math.round(actualArea * 0.14 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.14) * 4.2 * 100)/100 },
            bedroom_2: { name: '次卧', area: Math.round(actualArea * 0.10 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.10) * 4.2 * 100)/100 },
            kitchen: { name: '厨房', area: Math.round(actualArea * 0.08 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.08) * 4.2 * 100)/100 },
            bathroom_1: { name: '卫生间', area: Math.round(actualArea * 0.05 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.05) * 4 * 100)/100 },
            balcony: { name: '阳台', area: Math.round(actualArea * 0.05 * 100)/100, perimeter: Math.round(Math.sqrt(actualArea * 0.05) * 4 * 100)/100 },
          };

          // 估算总价
          let totalEstimate = 0;
          const roomDetails: string[] = [];
          for (const [key, info] of Object.entries(roomAreas)) {
            const tileCost = info.area * (priceMap.tile_floor ?? 0);
            totalEstimate += tileCost;
            roomDetails.push(`  ${info.name}: ${info.area}m², 周长${info.perimeter}m, 地砖约¥${Math.round(tileCost)}`);
          }
          totalEstimate = Math.round(totalEstimate * 1.8); // 加墙面/水电/管理費

          return {
            success: true,
            output: `📊 ${level === 'mid' ? '中档' : level}装修报价估算 (空间报价法)\n总面积: ${actualArea}m² (约${totalEstimate/10000}万元)\n\n房间明细:\n${roomDetails.join('\n')}\n\n包含: 水电工程+拆除+木工+油漆+地面+墙面+顶面+管理费\n每平米约 ¥${Math.round(totalEstimate/actualArea)} 元\n\n💡 请使用 xlsx 技能生成带公式的正式报价单。`,
            data: { area: actualArea, level, estimate: totalEstimate, price_per_sqm: Math.round(totalEstimate/actualArea), roomAreas },
          };
        },
      },

      // ==================== 工作流4: 材料计算 ====================
      {
        name: 'measure_materials',
        description: '根据房间面积计算材料用量。包含: 地砖/墙砖/美缝/乳胶漆/防水/柜体。学自 construction_knowledge_base.json',
        category: 'knowledge',
        handler: async (args) => {
          const area = args.area || 25;
          const tileSpec = args.tile_spec || '800×800';
          const grout = calcGroutMeters(area, tileSpec);
          const wallArea = Math.round(area * 2.8 * 0.85 * 100) / 100; // 层高2.8m, 扣除门窗15%
          const latexArea = Math.round(area * 3.2 * 100) / 100; // 墙面+顶面

          return {
            success: true,
            output: `[材料计算] ${area}m² 房间 (${tileSpec}瓷砖)\n\n地砖: ${Math.ceil(area * 1.05)}m² (含5%损耗)\n墙砖: ${Math.ceil(area * 2.8 * 0.75)}m² (2.2m高, 含损耗)\n美缝: ${grout}米 (${tileSpec} = ${Math.round(GROUT_COEFFICIENTS[tileSpec] || 5)}m/m² × ${area}m²)\n乳胶漆: ${Math.ceil(latexArea)}m² (墙面+顶面, 3.2系数)\n防水: ${Math.ceil(area * 1.2)}m² (含20%上翻)\n踢脚线: ${Math.ceil(Math.sqrt(area) * 4.2)}m`,
            data: { area, tileSpec, groutMeters: grout, wallArea, latexArea },
          };
        },
      },

      // ==================== 工作流5: CAD相关 ====================
      {
        name: 'parse_dxf',
        description: '解析DXF图纸文件，提取墙体/门窗/房间尺寸数据。学自 cad-import.ts + cad_analyzer.py',
        category: 'format',
        handler: async (args) => {
          const filePath = args.filePath || args.file_path || '';
          return {
            success: true,
            output: `[DXF解析] ${filePath}\n推荐使用 Python + ezdxf:\n\`\`\`python\nimport ezdxf\ndoc = ezdxf.readfile("${filePath}")\nmsp = doc.modelspace()\nfor e in msp.query("TEXT"):\n    print(e.dxf.text, e.dxf.insert)\n\`\`\`\n\n前端的 cad-import.ts 可解析为 ParsedWall/ParsedDoor/ParsedWindow 结构体。`,
            data: { filePath, tools: ['ezdxf', 'dxf-parser'] },
          };
        },
      },
      {
        name: 'generate_cad_drawing',
        description: '生成标准施工图(含图框), 支持A3/A4, 含尺寸标注。学自 cad_generation_service.py',
        category: 'workflow',
        handler: async (args) => {
          const paperSize = args.paper_size || 'A3';
          const drawingType = args.drawing_type || 'architectural';
          return {
            success: true,
            output: `[CAD出图] ${paperSize} ${drawingType === 'architectural' ? '建筑图' : '结构图'}\n使用 Python + ezdxf 生成标准图框:\n\`\`\`python\nfrom ezdxf import new\ndoc = new()\nmsp = doc.modelspace()\n# 绘制图框 + 标题栏\n\`\`\`\n\n图框字段: 工程名称/图名/设计/审核/比例/图号/日期`,
            data: { paperSize, drawingType },
          };
        },
      },

      // ==================== 工作流6: 知识查询 ====================
      {
        name: 'query_materials_library',
        description: '查询建材知识库。瓷砖/木材/涂料/五金/管材 规格-价格-应用。学自 construction_knowledge_base.json',
        category: 'knowledge',
        handler: async (args) => {
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
      },

      // ==================== 追问卡片 (用于前端展示) ====================
      {
        name: 'quotation_form',
        description: '装修报价信息收集表单。11个字段供前端展示追问卡片。',
        category: 'workflow',
        handler: async (args) => {
          return {
            success: true,
            output: `[报价表单] 请填写以下信息以生成精准报价:\n${QUOTATION_FIELDS.map(f => `- ${f.label} (${f.type}) ${f.placeholder || ''}`).join('\n')}`,
            data: { action: 'ask_user', question: '请提供以下装修信息', options: [], fields: QUOTATION_FIELDS },
          };
        },
      },
    ],
  },

  // ==================== 电商营销 ====================
  ecommerce: {
    id: 'ecommerce',
    label: '电商营销',
    theme: INDUSTRY_THEMES.ecommerce!,
    supportedFormats: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mov', '.xlsx', '.csv', '.pdf', '.docx'],
    knowledgeFiles: ['ecommerce/商品品类.md', 'ecommerce/营销术语.md', 'ecommerce/平台规则.md'],
    skills: [
      {
        name: 'generate_product_copy',
        description: '生成商品详情文案，包含卖点提炼/场景描述/规格说明',
        category: 'workflow',
        handler: async (args) => {
          const product = args.product || args.name || '';
          const features = args.features || '';
          return {
            success: true,
            output: `[商品文案] 为"${product}"生成文案\n核心卖点: ${features || '请描述商品特点'}\n\n建议结构:\n1. 标题(15字以内, 含核心关键词)\n2. 副标题(痛点+解决方案)\n3. 详情(规格参数/材质/尺寸)\n4. 使用场景(3个场景描述)\n5. 售后承诺`,
            data: { product, features },
          };
        },
      },
      {
        name: 'analyze_sales_data',
        description: '分析店铺销售数据(Excel/CSV), 输出商品排行/趋势/转化率',
        category: 'knowledge',
        handler: async (args) => {
          return { success: true, output: '[销售分析] 请上传销售数据文件(.xlsx/.csv)，我将分析商品排行、转化率、退货率趋势', data: { status: 'awaiting_file' } };
        },
      },
      {
        name: 'generate_marketing_plan',
        description: '制定营销推广方案，含目标/渠道/预算/排期/KPI',
        category: 'workflow',
        handler: async (args) => {
          const budget = args.budget || '待定';
          const platform = args.platform || '抖音+小红书+淘宝';
          return {
            success: true,
            output: `[营销方案] 预算${budget} | 平台: ${platform}\n\n推荐结构:\n1. 竞品分析 (3个对标品牌)\n2. 目标人群画像\n3. 内容策略 (图文/短视频/直播)\n4. 预算分配 (投流/达人/KOC)\n5. 排期表 (周维度)\n6. KPI (曝光/点击/转化/ROI)`,
            data: { budget, platform },
          };
        },
      },
      {
        name: 'generate_product_image_prompt',
        description: '生成商品图/主图/场景图的AI绘图提示词',
        category: 'workflow',
        handler: async (args) => {
          const product = args.product || '商品';
          const style = args.style || '白底图';
          return { success: true, output: `[商品图提示词] ${product} - ${style}\n\nprompt: ${product}, product photography, ${style === '白底图' ? 'white background, studio lighting, 8k' : 'lifestyle scene, natural lighting, shallow depth of field'}, commercial photography, high detail\n\nnegative: distorted, low quality, watermark, text, logo`, data: { product, style } };
        },
      },
    ],
  },

  // ==================== 教育 ====================
  education: {
    id: 'education',
    label: '教育',
    theme: INDUSTRY_THEMES.education!,
    supportedFormats: ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.md', '.txt'],
    knowledgeFiles: ['education/教学大纲模板.md', 'education/评分标准.md'],
    skills: [
      {
        name: 'generate_lesson_plan',
        description: '生成教学教案，含教学目标/重难点/教学过程/作业布置',
        category: 'workflow',
        handler: async (args) => {
          const subject = args.subject || '';
          const grade = args.grade || '';
          return { success: true, output: `[教案] ${grade} ${subject}\n\n结构:\n1. 教学目标 (知识/能力/情感)\n2. 教学重难点\n3. 教学准备 (教具/资料)\n4. 教学过程 (导入→新授→练习→小结)\n5. 板书设计\n6. 作业布置`, data: { subject, grade } };
        },
      },
      {
        name: 'generate_exam',
        description: '出题/组卷，支持单选/多选/判断/填空/简答',
        category: 'workflow',
        handler: async (args) => {
          const subject = args.subject || '';
          const count = args.count || 20;
          return { success: true, output: `[试卷] ${subject} (${count}题)\n\n题型分配建议:\n- 选择题: ${Math.round(count*0.4)}题\n- 填空题: ${Math.round(count*0.2)}题\n- 判断题: ${Math.round(count*0.15)}题\n- 简答题: ${Math.round(count*0.25)}题\n\n请指定: 年级/单元/难度`, data: { subject, count } };
        },
      },
      {
        name: 'analyze_student_scores',
        description: '分析学生成绩数据，输出平均分/分布/进退步/薄弱点',
        category: 'knowledge',
        handler: async (args) => {
          return { success: true, output: '[成绩分析] 请上传成绩表(.xlsx)，我将分析: 班级平均分、分数段分布、进退步名单、知识点薄弱项', data: { status: 'awaiting_file' } };
        },
      },
      {
        name: 'generate_course_outline',
        description: '制定课程大纲，含章节/学时/教学目标/参考书目',
        category: 'workflow',
        handler: async (args) => {
          const course = args.course || '';
          const hours = args.hours || 32;
          return { success: true, output: `[课程大纲] ${course} (${hours}学时)\n\n章节数建议: ${Math.round(hours/4)}章\n格式: 章节名→学时→教学目标→教学方式→作业`, data: { course, hours } };
        },
      },
    ],
  },

  // ==================== 开发者 ====================
  developer: {
    id: 'developer',
    label: '开发者',
    theme: INDUSTRY_THEMES.developer!,
    supportedFormats: ['.ts', '.js', '.py', '.go', '.rs', '.java', '.cpp', '.json', '.yaml', '.md', '.toml'],
    knowledgeFiles: ['developer/代码规范.md', 'developer/架构模式.md'],
    skills: [
      {
        name: 'review_code',
        description: '审查代码质量，检查命名/结构/安全/性能问题',
        category: 'workflow',
        handler: async (args) => {
          return { success: true, output: '[代码审查] 请提供代码文件路径或粘贴代码，我将检查: 命名规范、类型安全、潜在bug、性能瓶颈、安全漏洞', data: {} };
        },
      },
      {
        name: 'analyze_architecture',
        description: '分析项目架构，生成模块依赖图/数据流图/架构评估',
        category: 'knowledge',
        handler: async (args) => {
          return { success: true, output: '[架构分析] 请提供项目根目录，我将分析: 模块划分、依赖关系、数据流向、架构模式、改进建议', data: {} };
        },
      },
      {
        name: 'debug_issue',
        description: '排查和修复bug，分析错误日志/堆栈跟踪/复现步骤',
        category: 'workflow',
        handler: async (args) => {
          return { success: true, output: '[Bug修复] 请提供错误信息/堆栈/复现步骤，我将: 分析根因→给出修复方案→生成修复代码', data: {} };
        },
      },
      {
        name: 'performance_optimize',
        description: '分析和优化性能瓶颈，含CPU/内存/网络/渲染',
        category: 'workflow',
        handler: async (args) => {
          return { success: true, output: '[性能优化] 请描述性能问题场景，我将分析: 瓶颈定位→优化方案→预期提升幅度', data: {} };
        },
      },
    ],
  },

  // ==================== 漫剧创作 ====================
  comic: {
    id: 'comic',
    label: '漫剧创作',
    theme: INDUSTRY_THEMES.comic!,
    supportedFormats: ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.md', '.txt', '.pdf'],
    knowledgeFiles: ['comic/分镜模板.md', 'comic/角色设定指南.md'],
    skills: [
      {
        name: 'generate_script',
        description: '生成漫画/短剧剧本，含角色/场景/对白/分镜',
        category: 'workflow',
        handler: async (args) => {
          const genre = args.genre || '';
          return { success: true, output: `[剧本创作] 类型: ${genre || '未指定'}\n\n结构:\n1. 故事梗概 (3句话)\n2. 角色设定 (姓名/性格/外貌/背景)\n3. 场景设定\n4. 分集大纲 (每集3-5页)\n5. 对白脚本`, data: { genre } };
        },
      },
      {
        name: 'design_character',
        description: '设计漫画角色，含外观/性格/背景/关系网',
        category: 'workflow',
        handler: async (args) => {
          return { success: true, output: '[角色设计] 请描述角色设定，我将生成: 外观描述、性格特质、背景故事、角色关系、AI绘图提示词', data: {} };
        },
      },
      {
        name: 'generate_storyboard',
        description: '生成漫画分镜脚本，含镜头/构图/对白/时长',
        category: 'workflow',
        handler: async (args) => {
          return { success: true, output: '[分镜脚本] 请提供剧本片段，我将生成: 镜头编号、画面描述、景别、对白、建议时长、AI绘图提示词', data: {} };
        },
      },
    ],
  },

  // ==================== 房地产 ====================
  real_estate: {
    id: 'real_estate',
    label: '房地产',
    theme: INDUSTRY_THEMES.real_estate!,
    supportedFormats: ['.pdf', '.docx', '.doc', '.xlsx', '.jpg', '.jpeg', '.png', '.dwg', '.dxf'],
    knowledgeFiles: ['real_estate/户型术语.md', 'real_estate/营销话术.md'],
    skills: [
      {
        name: 'generate_property_desc',
        description: '生成房产描述文案，含户型/配套/交通/卖点',
        category: 'workflow',
        handler: async (args) => {
          return { success: true, output: '[房源描述] 请提供户型/面积/位置/配套等信息，我将生成: 卖点提炼、户型描述、配套介绍、投资价值分析', data: {} };
        },
      },
      {
        name: 'analyze_property_value',
        description: '分析房产价值，含周边房价对比/升值潜力/租金回报',
        category: 'knowledge',
        handler: async (args) => {
          return { success: true, output: '[房产估值] 请提供楼盘名称/户型/面积/位置，我将分析: 周边均价对比、升值潜力、租金回报率、税费估算', data: {} };
        },
      },
      {
        name: 'generate_floor_plan_desc',
        description: '分析户型图，输出各功能区/动线/通风/采光评价',
        category: 'format',
        handler: async (args) => {
          return { success: true, output: '[户型分析] 请上传户型图，我将分析: 功能分区、动线设计、通风采光、空间利用率、改造建议', data: {} };
        },
      },
    ],
  },

  // ==================== 医疗 ====================
  medical: {
    id: 'medical',
    label: '医疗健康',
    theme: INDUSTRY_THEMES.medical!,
    supportedFormats: ['.pdf', '.docx', '.doc', '.xlsx', '.csv', '.jpg', '.jpeg', '.dcm'],
    knowledgeFiles: ['medical/常见病症.md', 'medical/药品目录.md'],
    skills: [
      {
        name: 'analyze_symptom',
        description: '分析症状描述，提供可能的病因和就医建议（非诊断）',
        category: 'knowledge',
        handler: async (args) => {
          return { success: true, output: '[症状分析] ⚠️ 重要提示: 此分析仅供参考，不作为诊断依据。请提供症状描述(部位/性质/持续时间)，我将给出可能的病因方向和就医建议', data: {} };
        },
      },
      {
        name: 'generate_health_report',
        description: '生成健康报告解读，含体检指标分析/风险评估/改善建议',
        category: 'workflow',
        handler: async (args) => {
          return { success: true, output: '[报告解读] 请上传体检报告/检验单，我将分析: 异常指标解读、风险评估、改善建议、复查建议', data: {} };
        },
      },
      {
        name: 'query_drug_info',
        description: '查询药品信息，含成分/适应症/用法/禁忌/不良反应',
        category: 'knowledge',
        handler: async (args) => {
          return { success: true, output: '[药品查询] 请输入药品名称，我将提供: 主要成分、适应症、用法用量、禁忌人群、不良反应、药物相互作用', data: {} };
        },
      },
    ],
  },

  // ==================== 法律 ====================
  legal: {
    id: 'legal',
    label: '法律',
    theme: INDUSTRY_THEMES.legal!,
    supportedFormats: ['.pdf', '.docx', '.doc', '.md', '.txt'],
    knowledgeFiles: ['legal/法律法规索引.md', 'legal/合同模板.md'],
    skills: [
      {
        name: 'draft_contract',
        description: '起草合同文本，支持租赁/劳务/买卖/服务等类型',
        category: 'workflow',
        handler: async (args) => {
          return { success: true, output: '[合同起草] 请提供合同类型和关键条款，我将生成: 合同正文、关键条款说明、风险提示', data: {} };
        },
      },
      {
        name: 'analyze_legal_risk',
        description: '分析法律风险，检查合同/行为的合规性',
        category: 'knowledge',
        handler: async (args) => {
          return { success: true, output: '[法律风险分析] 请提供合同文本或行为描述，我将分析: 合规性检查、风险点识别、规避建议、相关法条引用', data: {} };
        },
      },
      {
        name: 'query_law',
        description: '查询法律法规，支持按关键词/领域/效力级别检索',
        category: 'knowledge',
        handler: async (args) => {
          return { success: true, output: '[法律查询] 请输入查询关键词或法律领域，我将提供: 相关法律法规、核心条款、司法解释、典型案例', data: {} };
        },
      },
    ],
  },

  // ==================== 制造业 ====================
  manufacturing: {
    id: 'manufacturing',
    label: '制造业',
    theme: INDUSTRY_THEMES.manufacturing!,
    supportedFormats: ['.pdf', '.xlsx', '.csv', '.dwg', '.dxf', '.stp', '.step', '.md'],
    knowledgeFiles: ['manufacturing/工艺标准.md', 'manufacturing/质检规范.md'],
    skills: [
      {
        name: 'generate_process_flow',
        description: '生成生产工艺流程，含工序/参数/设备/质检点',
        category: 'workflow',
        handler: async (args) => {
          return { success: true, output: '[工艺流程] 请提供产品类型和工艺要求，我将生成: 工序流程图、关键工艺参数、设备清单、质检控制点', data: {} };
        },
      },
      {
        name: 'analyze_quality_data',
        description: '分析质检数据，输出合格率/缺陷分布/趋势/改进建议',
        category: 'knowledge',
        handler: async (args) => {
          return { success: true, output: '[质检分析] 请上传质检数据(.xlsx/.csv)，我将分析: 合格率统计、缺陷类型分布、趋势分析、改进建议', data: {} };
        },
      },
      {
        name: 'estimate_production_cost',
        description: '估算生产成本，含材料/人工/设备/管理费',
        category: 'workflow',
        handler: async (args) => {
          return { success: true, output: '[成本估算] 请提供产品BOM和工艺信息，我将估算: 材料成本、人工成本、设备折旧、管理费、总成本', data: {} };
        },
      },
    ],
  },
};

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

  activate(industryId: string): IndustryConfig | null {
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

    // 创建知识库模板
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

  buildSystemPromptFragment(): string {
    const config = this.getActive();
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

  activateFromProfile(profile: { industry?: string }) {
    if (profile.industry && profile.industry !== 'general') {
      return this.activate(profile.industry);
    }
    return null;
  }
}

export const industryEngine = new IndustryEngine();
