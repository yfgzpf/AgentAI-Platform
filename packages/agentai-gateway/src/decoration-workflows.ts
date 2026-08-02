/**
 * 建材装饰 AI 报价系统 - 完整工作流示例
 * 
 * 基于 zyai 装修报价系统实战经验，整合：
 * 1. CAD/DXF 图纸解析 → 提取户型数据
 * 2. 知识库检索 → 匹配最新价格模块
 * 3. 智能报价生成 → 标准表格样式输出
 * 4. 可视化生成 → 45度俯视图、封页、PPT
 * 
 * 后期可扩展: GPT 模型、豆包生图能力
 */

// ═══════════════════════════════════════════════════════════
// 场景1: 完整报价流程（从图纸到 PPT）
// ═══════════════════════════════════════════════════════════

/**
 * 用户指令: "我有个户型图在 C:\projects\floorplan.dxf，帮我生成报价"
 * 
 * AI 执行流程:
 * 
 * 步骤1: 解析 CAD 图纸
 * parse_cad_drawing({
 *   filePath: "C:\\projects\\floorplan.dxf",
 *   outputFormat: "markdown"
 * })
 * → 返回房间列表和面积数据
 * 
 * 步骤2: 搜索知识库获取最新价格
 * industry_insight({action: "profile", industry_id: "decoration"})
 * knowledge_import({name: "2024年建材价格表", industry: "decoration", content: "..."})
 * 
 * 步骤3: 生成智能报价
 * generate_quotation({
 *   totalArea: 86.3,
 *   roomLayout: "三室两厅",
 *   style: "现代简约",
 *   qualityLevel: "mid",
 *   customerName: "张三",
 *   projectName: "森林海2#203",
 *   includeKnowledgeSearch: true
 * })
 * → 返回标准报价表格（含知识库参考来源）
 * 
 * 步骤4: 生成 45 度俯视图
 * generate_45_degree_view({
 *   rooms: [
 *     {name: "客餐厅", area: 35.5},
 *     {name: "主卧", area: 18.2},
 *     ...
 *   ],
 *   title: "森林海2#203 户型图"
 * })
 * → 返回 SVG 代码，可用 render_widget 内联显示
 * 
 * 步骤5: 生成报价封页
 * generate_quotation_cover({
 *   projectName: "森林海2#203 装修工程",
 *   customerName: "张三",
 *   totalAmount: 128500,
 *   style: "professional"
 * })
 * → 返回 16:9 SVG 封面
 * 
 * 步骤6: 生成报价 PPT
 * generate_quotation_ppt({
 *   quotation: {...},  // 步骤3的结果
 *   coverData: {...},  // 步骤5的结果
 *   includeSlides: ["cover", "overview", "details", "summary"]
 * })
 * → 返回 officecli 调用指令
 * 
 * 步骤7: 执行 PPT 生成
 * officecli({
 *   action: "create",
 *   file: "报价单-森林海2#203.pptx"
 * })
 * officecli({
 *   action: "add",
 *   file: "报价单-森林海2#203.pptx",
 *   path: "/slide[1]",
 *   type: "shape",
 *   prop: {text: "森林海2#203 装修工程", fontSize: 32, bold: true}
 * })
 * ... (添加更多幻灯片)
 */

// ═══════════════════════════════════════════════════════════
// 场景2: 快速报价（无图纸，文字描述）
// ═══════════════════════════════════════════════════════════

/**
 * 用户指令: "三室两厅，86平米，现代简约风格，中档装修，客户张三"
 * 
 * AI 执行流程:
 * 
 * 步骤1: 直接生成报价
 * generate_quotation({
 *   totalArea: 86,
 *   roomLayout: "三室两厅",
 *   style: "现代简约",
 *   qualityLevel: "mid",
 *   customerName: "张三",
 *   projectName: "未命名项目",
 *   includeKnowledgeSearch: true
 * })
 * 
 * 步骤2: 生成户型可视化（可选）
 * generate_45_degree_view({
 *   rooms: [
 *     {name: "客餐厅", area: 35},
 *     {name: "主卧", area: 18},
 *     {name: "次卧", area: 14},
 *     {name: "厨房", area: 8},
 *     {name: "卫生间", area: 11}
 *   ],
 *   title: "86㎡ 三室两厅户型图"
 * })
 */

// ═══════════════════════════════════════════════════════════
// 场景3: 知识库驱动的精准报价
// ═══════════════════════════════════════════════════════════

/**
 * 用户指令: "导入这份价格表到知识库，然后根据它生成报价"
 * 
 * AI 执行流程:
 * 
 * 步骤1: 导入知识库
 * knowledge_import({
 *   name: "2024年Q4建材装饰价格表",
 *   industry: "decoration",
 *   content: `
 *     一、基础工程
 *     1. 墙体拆除: 35元/m²
 *     2. 墙面找平: 28元/m²
 *     
 *     二、水电工程
 *     1. 强电改造: 65元/m
 *     2. 弱电改造: 55元/m
 *     
 *     三、泥水工程
 *     1. 地砖铺贴: 95元/m² (标准档)
 *     2. 墙砖铺贴: 78元/m²
 *     ...
 *   `
 * })
 * 
 * 步骤2: 生成报价（自动检索知识库）
 * generate_quotation({
 *   totalArea: 86,
 *   roomLayout: "三室两厅",
 *   style: "现代简约",
 *   qualityLevel: "mid",
 *   customerName: "李四",
 *   projectName: "小区A-1001",
 *   includeKnowledgeSearch: true  // ← 关键参数
 * })
 * 
 * → 报价结果会包含 knowledgeSources 字段，显示参考了哪些知识库文档
 */

// ═══════════════════════════════════════════════════════════
// 场景4: 后期扩展 - GPT/豆包生图能力接入
// ═══════════════════════════════════════════════════════════

/**
 * 未来扩展计划:
 * 
 * 1. 接入 GPT-4o 图像生成
 *    - 根据户型数据生成真实感效果图
 *    - 提示词模板: "Modern minimalist living room, 86sqm, three bedrooms, photorealistic, 4K"
 *    
 * 2. 接入豆包生图能力
 *    - 豆包在中文场景理解上有优势
 *    - 可用于生成中式风格、轻奢风格的效果图
 *    
 * 3. AI 自动索要密钥
 *    LLM 提示词:
 *    "为了生成高质量的装修效果图，我需要接入图像生成模型。
 *     请提供您的 OpenAI API Key 或豆包 API Key，我将安全存储并仅用于此目的。"
 *    
 * 4. 实现方案:
 *    - 新增工具: generate_interior_rendering(args: {roomType, style, imageUrl?})
 *    - 调用 GPT-4o/DALL-E 或豆包 API
 *    - 返回效果图 URL 或 Base64
 *    - 可嵌入 PPT 或单独发送给用户
 */

// ═══════════════════════════════════════════════════════════
// 知识库集成说明
// ═══════════════════════════════════════════════════════════

/**
 * 知识库查询流程:
 * 
 * 1. 用户导入行业文档
 *    knowledge_import({
 *      name: "某装饰公司报价规范",
 *      industry: "decoration",
 *      content: fs.readFileSync("报价规范.pdf", "utf-8")
 *    })
 * 
 * 2. AI 自动生成报价时检索知识库
 *    generate_quotation({
 *      ...,
 *      includeKnowledgeSearch: true
 *    })
 *    → 内部调用 searchKnowledgeBase()
 *    → 返回匹配的报价段落
 * 
 * 3. 报价结果标注来源
 *    quotation.knowledgeSources = [
 *      {
 *        docName: "某装饰公司报价规范",
 *        snippet: "地砖铺贴: 人工费45元/m² + 材料费50元/m² = 95元/m²"
 *      }
 *    ]
 * 
 * 4. 用户可追溯价格来源，确保准确性
 */

// ═══════════════════════════════════════════════════════════
// 表格样式规范
// ═══════════════════════════════════════════════════════════

/**
 * 报价单标准表格样式（参照行业标准）:
 * 
 * | 类别 | 项目 | 单位 | 数量 | 单价(元) | 总价(元) | 备注 |
 * |------|------|------|------|----------|----------|------|
 * | 客餐厅 | 地砖铺贴 | m² | 35.5 | 155 | 5502.5 | 含材料和人工 |
 * | 客餐厅 | 顶面乳胶漆 | m² | 35.5 | 48 | 1704 | 喷涂工艺 |
 * | ... | ... | ... | ... | ... | ... | ... |
 * 
 * 费用汇总:
 * - 小计: ¥58,500
 * - 税费 (3%): ¥1,755
 * - 总计: ¥60,255
 * 
 * 注: 最终价格以实际测量为准
 */

// ═══════════════════════════════════════════════════════════
// 45度俯视图规范
// ═══════════════════════════════════════════════════════════

/**
 * 等轴测投影 (Isometric Projection) 规范:
 * 
 * 1. 视角: 45度俯视
 * 2. 比例: 保持真实面积比例
 * 3. 颜色: 不同房间用不同颜色区分
 * 4. 标注: 显示房间名称和面积
 * 5. 输出: SVG 格式（可内联显示或下载）
 * 
 * 示例输出:
 * ┌─────────────────────────────────┐
 * │         45度俯视图              │
 * ├─────────────────────────────────┤
 * │  ┌──────┐  ┌──────┐            │
 * │  │客餐厅 │ │ 主卧  │  35.5m²   │
 * │  │35.5m²│  │18.2m²│            │
 * │  └──────┘  └──────┘            │
 * │  ┌──────┐  ┌──────┐            │
 * │  │次卧  │  │ 厨房  │  14.8m²   │
 * │  │14.8m²│  │ 8.5m² │            │
 * │  └──────┘  └──────┘            │
 * └─────────────────────────────────┘
 */

export const DECORATION_WORKFLOW_EXAMPLES = {
  full_workflow: `
用户: "解析 C:\\projects\\floorplan.dxf 并生成报价"
AI:
  1. parse_cad_drawing({filePath: "C:\\projects\\floorplan.dxf"})
     → 返回: {rooms: [...], totalArea: 86.3}
  
  2. generate_quotation({
       totalArea: 86.3,
       roomLayout: "三室两厅",
       style: "现代简约",
       qualityLevel: "mid",
       customerName: "张三",
       projectName: "森林海2#203"
     })
     → 返回: 标准报价表格
  
  3. generate_45_degree_view({
       rooms: [...],
       title: "森林海2#203 户型图"
     })
     → 返回: SVG 代码
  
  4. generate_quotation_cover({
       projectName: "森林海2#203 装修工程",
       customerName: "张三",
       totalAmount: 128500
     })
     → 返回: 16:9 封面 SVG
  
  5. generate_quotation_ppt({
       quotation: {...},
       coverData: {...}
     })
     → 返回: officecli 调用指令
  
  6. officecli({action: "create", file: "报价单.pptx"})
     ... (生成完整 PPT)
  `,
  
  quick_quote: `
用户: "86平三室两厅，现代简约，中档装修"
AI:
  1. generate_quotation({
       totalArea: 86,
       roomLayout: "三室两厅",
       style: "现代简约",
       qualityLevel: "mid",
       includeKnowledgeSearch: true
     })
     → 返回: 报价表格
  `,
  
  kb_driven: `
用户: "导入价格表并生成报价"
AI:
  1. knowledge_import({
       name: "2024报价表",
       industry: "decoration",
       content: "..."
     })
  
  2. generate_quotation({
       ...,
       includeKnowledgeSearch: true
     })
     → 返回: 带知识来源的报价
  `,
};
