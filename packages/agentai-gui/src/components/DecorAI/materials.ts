/**
 * 建筑装饰材料数据库 v1.0
 * 
 * 包含真实材料规格、价格区间、适用场景
 * 支持设计师快速选材和预算估算
 */

export interface Material {
  id: string;
  name: string;
  category: 'floor' | 'wall' | 'ceiling' | 'furniture' | 'lighting' | 'hardware' | 'soft';
  subCategory: string;
  priceRange: { min: number; max: number; unit: string };
  specs: string[];
  brands: string[];
  features: string[];
  applicableStyles: string[];
  images?: string[];
  description: string;
}

export interface MaterialPackage {
  id: string;
  name: string;
  style: string;
  spaceType: 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'office';
  area: number;
  materials: { materialId: string; quantity: number; unit: string }[];
  totalPrice: { min: number; max: number };
  laborCost: { min: number; max: number };
  timeline: string;
}

// ==================== 地板材料 ====================
export const FLOOR_MATERIALS: Material[] = [
  {
    id: 'floor-001',
    name: '实木复合地板',
    category: 'floor',
    subCategory: '木地板',
    priceRange: { min: 180, max: 450, unit: '元/㎡' },
    specs: ['15mm厚', 'E0级环保', '橡木/胡桃木/柚木'],
    brands: ['圣象', '大自然', '德尔', '菲林格尔'],
    features: ['脚感舒适', '保温性好', '可翻新'],
    applicableStyles: ['modern', 'nordic', 'new-chinese', 'japanese'],
    description: '表层实木+多层基材，稳定性好，适合地暖',
  },
  {
    id: 'floor-002',
    name: '强化复合地板',
    category: 'floor',
    subCategory: '木地板',
    priceRange: { min: 80, max: 200, unit: '元/㎡' },
    specs: ['12mm厚', '耐磨AC3-AC5级', '高密度基材'],
    brands: ['圣象', '大自然', '升达', '菲林格尔'],
    features: ['耐磨耐刮', '性价比高', '易清洁'],
    applicableStyles: ['modern', 'nordic', 'industrial'],
    description: '高密度纤维板+耐磨层，最经济实用的选择',
  },
  {
    id: 'floor-003',
    name: '微水泥',
    category: 'floor',
    subCategory: '艺术地坪',
    priceRange: { min: 280, max: 600, unit: '元/㎡' },
    specs: ['3-5mm厚', '无缝一体', '防水防霉'],
    brands: ['西卡', '马贝', '雷帝', '国产优质'],
    features: ['无缝一体', '极简美学', '可墙地一体'],
    applicableStyles: ['modern', 'wabi-sabi', 'minimalist-luxury', 'industrial'],
    description: '水泥基艺术涂料，墙地一体，极简风格首选',
  },
  {
    id: 'floor-004',
    name: '大理石瓷砖',
    category: 'floor',
    subCategory: '瓷砖',
    priceRange: { min: 150, max: 800, unit: '元/㎡' },
    specs: ['900x1800mm', '通体大理石', '釉面砖'],
    brands: ['马可波罗', '东鹏', '蒙娜丽莎', '诺贝尔'],
    features: ['纹理逼真', '耐磨易洁', '高端大气'],
    applicableStyles: ['modern', 'french', 'art-deco', 'minimalist-luxury'],
    description: '仿大理石纹理瓷砖，大规格铺贴效果佳',
  },
  {
    id: 'floor-005',
    name: 'SPC石塑地板',
    category: 'floor',
    subCategory: '新型材料',
    priceRange: { min: 60, max: 150, unit: '元/㎡' },
    specs: ['4-6mm厚', '100%防水', '锁扣安装'],
    brands: ['LG', '阿姆斯壮', '国产优质'],
    features: ['完全防水', '零甲醛', '安装快捷'],
    applicableStyles: ['modern', 'industrial'],
    description: '石粉+PVC复合材料，防水防潮，适合厨卫',
  },
  {
    id: 'floor-006',
    name: '人字拼实木地板',
    category: 'floor',
    subCategory: '木地板',
    priceRange: { min: 350, max: 800, unit: '元/㎡' },
    specs: ['450x75x15mm', '橡木/黑胡桃', '人字拼/鱼骨拼'],
    brands: ['书香门地', '久盛', '天格'],
    features: ['法式优雅', '视觉延伸', '高端定制'],
    applicableStyles: ['french', 'art-deco', 'new-chinese'],
    description: '经典人字拼法，法式风格必备元素',
  },
];

// ==================== 墙面材料 ====================
export const WALL_MATERIALS: Material[] = [
  {
    id: 'wall-001',
    name: '乳胶漆',
    category: 'wall',
    subCategory: '涂料',
    priceRange: { min: 30, max: 120, unit: '元/㎡' },
    specs: ['五合一', '抗甲醛', '可擦洗'],
    brands: ['立邦', '多乐士', '都芳', '芬琳'],
    features: ['色彩丰富', '易翻新', '性价比高'],
    applicableStyles: ['modern', 'nordic', 'all'],
    description: '最基础的墙面处理方式，色彩选择丰富',
  },
  {
    id: 'wall-002',
    name: '艺术涂料',
    category: 'wall',
    subCategory: '艺术漆',
    priceRange: { min: 150, max: 500, unit: '元/㎡' },
    specs: ['天鹅绒', '水泥纹理', '金属质感'],
    brands: ['威罗', '瓦帕茵特', '国产艺术漆'],
    features: ['纹理独特', '质感高级', '个性定制'],
    applicableStyles: ['wabi-sabi', 'modern', 'industrial', 'minimalist-luxury'],
    description: '手工批刮纹理，每面墙都是独一无二',
  },
  {
    id: 'wall-003',
    name: '木饰面',
    category: 'wall',
    subCategory: '木质',
    priceRange: { min: 200, max: 800, unit: '元/㎡' },
    specs: ['科定板', '天然木皮', '科技木'],
    brands: ['科定', '木里木外', '图森'],
    features: ['温润质感', '护墙耐用', '高端定制'],
    applicableStyles: ['new-chinese', 'modern', 'nordic', 'japanese'],
    description: 'KD板或天然木皮，提升空间质感',
  },
  {
    id: 'wall-004',
    name: '岩板',
    category: 'wall',
    subCategory: '石材',
    priceRange: { min: 400, max: 2000, unit: '元/㎡' },
    specs: ['1200x2400mm', '3mm/6mm/12mm', '进口/国产'],
    brands: ['拉米娜', '德赛斯', '蒙娜丽莎', '新明珠'],
    features: ['超大规格', '耐高温', '零渗透'],
    applicableStyles: ['modern', 'minimalist-luxury', 'industrial'],
    description: '超大规格陶瓷薄板，适合背景墙和台面',
  },
  {
    id: 'wall-005',
    name: '护墙板/PU线条',
    category: 'wall',
    subCategory: '造型',
    priceRange: { min: 180, max: 600, unit: '元/㎡' },
    specs: ['石膏线', 'PU线', '实木线'],
    brands: ['银桥', '华椢', '定制'],
    features: ['法式优雅', '立体层次', '遮丑收边'],
    applicableStyles: ['french', 'art-deco', 'new-chinese'],
    description: '法式风格必备，墙面立体造型',
  },
  {
    id: 'wall-006',
    name: '格栅板',
    category: 'wall',
    subCategory: '木质',
    priceRange: { min: 150, max: 400, unit: '元/㎡' },
    specs: ['竖格栅', '波浪板', '长城板'],
    brands: ['定制'],
    features: ['线条感强', '声学优化', '现代简约'],
    applicableStyles: ['modern', 'new-chinese', 'minimalist-luxury'],
    description: '竖向线条拉伸空间高度，现代风格常用',
  },
];

// ==================== 吊顶材料 ====================
export const CEILING_MATERIALS: Material[] = [
  {
    id: 'ceil-001',
    name: '石膏板吊顶',
    category: 'ceiling',
    subCategory: '基础吊顶',
    priceRange: { min: 120, max: 300, unit: '元/㎡' },
    specs: ['9.5mm石膏板', '轻钢龙骨', '平顶/造型顶'],
    brands: ['龙牌', '可耐福', '圣戈班'],
    features: ['平整度高', '易造型', '隔音隔热'],
    applicableStyles: ['all'],
    description: '最主流的吊顶方式，可做各种造型',
  },
  {
    id: 'ceil-002',
    name: '蜂窝大板',
    category: 'ceiling',
    subCategory: '集成吊顶',
    priceRange: { min: 200, max: 500, unit: '元/㎡' },
    specs: ['1200x2400mm', '铝蜂窝芯', '集成电器'],
    brands: ['友邦', '奥普', '楚楚'],
    features: ['无缝拼接', '集成照明', '易检修'],
    applicableStyles: ['modern', 'kitchen', 'bathroom'],
    description: '厨卫吊顶新选择，大规格更美观',
  },
  {
    id: 'ceil-003',
    name: '悬浮吊顶+灯带',
    category: 'ceiling',
    subCategory: '无主灯',
    priceRange: { min: 280, max: 600, unit: '元/㎡' },
    specs: ['悬浮落差', '线性灯带', '见光不见灯'],
    brands: ['定制'],
    features: ['现代极简', '氛围感强', '视觉延伸'],
    applicableStyles: ['modern', 'minimalist-luxury'],
    description: '网红悬浮吊顶，配合无主灯设计',
  },
];

// ==================== 家具材料 ====================
export const FURNITURE_MATERIALS: Material[] = [
  {
    id: 'fur-001',
    name: '定制衣柜',
    category: 'furniture',
    subCategory: '柜类',
    priceRange: { min: 800, max: 3000, unit: '元/㎡投影' },
    specs: ['颗粒板', '多层板', '欧松板', '实木'],
    brands: ['索菲亚', '欧派', '尚品宅配', '好莱客'],
    features: ['空间利用', '个性定制', '整体统一'],
    applicableStyles: ['all'],
    description: '全屋定制核心，投影面积计价',
  },
  {
    id: 'fur-002',
    name: '橱柜',
    category: 'furniture',
    subCategory: '柜类',
    priceRange: { min: 1500, max: 5000, unit: '元/延米' },
    specs: ['石英石台面', '多层板柜体', 'PET门板'],
    brands: ['欧派', '金牌', '志邦', '博洛尼'],
    features: ['功能分区', '五金配件', '耐用易洁'],
    applicableStyles: ['all'],
    description: '厨房核心，延米计价含台面',
  },
  {
    id: 'fur-003',
    name: '真皮沙发',
    category: 'furniture',
    subCategory: '软体',
    priceRange: { min: 5000, max: 30000, unit: '元/套' },
    specs: ['头层牛皮', '全青皮', '磨砂皮'],
    brands: ['顾家', '芝华仕', '左右', 'MD'],
    features: ['舒适耐用', '质感高级', '易清洁'],
    applicableStyles: ['modern', 'french', 'minimalist-luxury'],
    description: '客厅C位，头层牛皮最佳',
  },
];

// ==================== 灯光材料 ====================
export const LIGHTING_MATERIALS: Material[] = [
  {
    id: 'light-001',
    name: '磁吸轨道灯',
    category: 'lighting',
    subCategory: '无主灯',
    priceRange: { min: 200, max: 600, unit: '元/米' },
    specs: ['20mm/35mm轨道', '泛光灯/格栅灯/射灯'],
    brands: ['西顿', '企一', '雷士', '欧普'],
    features: ['灵活调节', '模块化', '现代极简'],
    applicableStyles: ['modern', 'minimalist-luxury'],
    description: '无主灯核心，可自由组合灯具',
  },
  {
    id: 'light-002',
    name: '防眩射灯',
    category: 'lighting',
    subCategory: '无主灯',
    priceRange: { min: 80, max: 300, unit: '元/个' },
    specs: ['深杯防眩', '可调角度', '显指Ra>90'],
    brands: ['西顿', '企一', '雷士'],
    features: ['见光不见灯', '重点照明', '高显色'],
    applicableStyles: ['modern', 'minimalist-luxury'],
    description: '重点照明必备，深杯防眩不刺眼',
  },
  {
    id: 'light-003',
    name: '线性灯带',
    category: 'lighting',
    subCategory: '氛围灯',
    priceRange: { min: 50, max: 150, unit: '元/米' },
    specs: ['COB灯带', '铝槽', '调光调色'],
    brands: ['西顿', '欧普', '飞利浦'],
    features: ['氛围营造', '间接照明', '视觉延伸'],
    applicableStyles: ['modern', 'minimalist-luxury', 'cyberpunk'],
    description: '氛围照明首选，见光不见灯',
  },
];

// ==================== 快速选材函数 ====================

/** 根据风格推荐材料套餐 */
export function getMaterialPackageByStyle(style: string, area: number = 100): MaterialPackage {
  const packages: Record<string, Partial<MaterialPackage>> = {
    modern: {
      name: '现代简约套餐',
      materials: [
        { materialId: 'floor-002', quantity: area * 0.7, unit: '㎡' },
        { materialId: 'wall-001', quantity: area * 2.5, unit: '㎡' },
        { materialId: 'ceil-003', quantity: area * 0.8, unit: '㎡' },
        { materialId: 'light-001', quantity: area * 0.3, unit: '米' },
        { materialId: 'fur-001', quantity: area * 0.4, unit: '㎡投影' },
      ],
      timeline: '45-60天',
    },
    french: {
      name: '法式轻奢套餐',
      materials: [
        { materialId: 'floor-006', quantity: area * 0.7, unit: '㎡' },
        { materialId: 'wall-005', quantity: area * 0.3, unit: '㎡' },
        { materialId: 'wall-001', quantity: area * 2.2, unit: '㎡' },
        { materialId: 'fur-003', quantity: 1, unit: '套' },
      ],
      timeline: '60-90天',
    },
    wabi: {
      name: '侘寂风套餐',
      materials: [
        { materialId: 'floor-003', quantity: area * 0.8, unit: '㎡' },
        { materialId: 'wall-002', quantity: area * 2.5, unit: '㎡' },
        { materialId: 'fur-001', quantity: area * 0.3, unit: '㎡投影' },
      ],
      timeline: '60-80天',
    },
  };

  const pkg = packages[style] || packages.modern;
  
  // 计算总价
  let minTotal = 0, maxTotal = 0;
  pkg.materials?.forEach(m => {
    const material = getMaterialById(m.materialId);
    if (material) {
      minTotal += material.priceRange.min * m.quantity;
      maxTotal += material.priceRange.max * m.quantity;
    }
  });

  return {
    id: `pkg-${style}-${area}`,
    style,
    spaceType: 'living',
    area,
    totalPrice: { min: minTotal, max: maxTotal },
    laborCost: { min: area * 400, max: area * 800 },
    ...pkg,
  } as MaterialPackage;
}

/** 根据ID获取材料 */
export function getMaterialById(id: string): Material | undefined {
  const allMaterials = [
    ...FLOOR_MATERIALS,
    ...WALL_MATERIALS,
    ...CEILING_MATERIALS,
    ...FURNITURE_MATERIALS,
    ...LIGHTING_MATERIALS,
  ];
  return allMaterials.find(m => m.id === id);
}

/** 根据风格获取推荐材料 */
export function getMaterialsByStyle(style: string): Material[] {
  const allMaterials = [
    ...FLOOR_MATERIALS,
    ...WALL_MATERIALS,
    ...CEILING_MATERIALS,
    ...FURNITURE_MATERIALS,
    ...LIGHTING_MATERIALS,
  ];
  return allMaterials.filter(m => 
    m.applicableStyles.includes(style) || m.applicableStyles.includes('all')
  );
}

/** 获取材料分类列表 */
export function getMaterialsByCategory(category: Material['category']): Material[] {
  const allMaterials = [
    ...FLOOR_MATERIALS,
    ...WALL_MATERIALS,
    ...CEILING_MATERIALS,
    ...FURNITURE_MATERIALS,
    ...LIGHTING_MATERIALS,
  ];
  return allMaterials.filter(m => m.category === category);
}
