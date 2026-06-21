---
name: decoration-quote
description: "装修行业全能技能：报价生成、方案书生成、施工排期、材料算量、效果图生成。从CAD/PDF图纸提取户型数据，按空间报价法生成Excel预算表。含方案书DOCX生成、甘特图施工进度、品牌推荐。"
---

# 装修行业全能技能

## 能力概览

| 能力 | 触发词 | 输出 |
|------|--------|------|
| 报价生成 | 报价/预算/多少钱 | Excel 报价单 |
| 方案书生成 | 方案书/设计方案/客户方案 | DOCX 方案书 |
| 施工排期 | 排期/进度/工期/甘特图 | Excel 甘特图 |
| 材料算量 | 算量/用量/几片/多少 | 计算结果 + 推荐 |
| 效果图 | 效果图/设计图/参考图 | AI 生成图片 |
| 施工规范 | 规范/标准/验收/注意事项 | 文字回答 |

## 上下文文件

每次执行装修相关任务前，使用 `read_file` 读取以下文件：

```bash
read_file skills/decoration-quote/legend-recognition.json   # 图例识别
read_file skills/decoration-quote/price-reference.json       # 价格参考表
read_file skills/decoration-quote/quotation-template.json    # 报价表Excel样式
read_file skills/decoration-quote/proposal-template.json     # 方案书DOCX模板
read_file skills/decoration-quote/construction-schedule.json  # 施工排期标准
```

## 流程一: 报价生成

### Step 1: 图例识别

读取图纸文件(.dwg/.dxf/.pdf/.jpg)后：

1. 对照 `legend-recognition.json` 中的图例分类识别每个元素
2. **中文标注优先**: 图纸有中文标注时直接使用，不猜测
3. 尺寸单位: mm，面积单位: m²
4. 门编号规则: M+宽+高 (如M0921=宽900×高2100)
5. 窗编号规则: C+宽+高 (如C1215=宽1200×高1500)

**图例不明时的处理**:

当AI无法确定某图例含义时，停止并触发追问表单：

```json
{
  "action": "ask_user",
  "question": "无法识别图纸中的以下图例，请协助确认",
  "options": [],
  "fields": [
    { "field": "legend_page", "label": "图例所在页码或位置", "type": "text", "voice": true },
    { "field": "legend_shape", "label": "图例外观(形状/线条/填充/颜色)", "type": "textarea", "voice": true },
    { "field": "legend_nearby_text", "label": "图例旁边的文字标注是什么?", "type": "text", "voice": true },
    { "field": "legend_guess", "label": "AI猜测可能是", "type": "select", "options": ["墙体(承重)", "墙体(非承重)", "平开门", "推拉门", "窗", "飘窗", "衣柜", "橱柜", "洗手台", "马桶", "浴缸", "插座", "开关", "灯具", "排水管", "给水管", "防水层", "吊顶", "其他"] },
    { "field": "legend_size", "label": "附近是否有尺寸标注? 数字是多少?", "type": "text", "voice": true }
  ],
  "voice_support": true
}
```

**voice_support说明**: 前端展示追问卡片时，所有 `voice: true` 的字段显示语音输入按钮，调用 `window.SpeechRecognition` API 录音转文字。

### Step 2: 户型数据提取

从识别结果中提取:
- 房间名称(对照 `legend-recognition.json` 的 `room_keywords`)
- 房间面积(搜索 m²/㎡ 标记)
- 门窗尺寸(门: M编号, 窗: C编号)
- 柜体标注(搜索 "衣柜/鞋柜/橱柜" + 尺寸数字)

### Step 3: 报价生成

1. 从 `price-reference.json` 中查找对应单价
2. 根据 `quotation-template.json` 的样式生成数据
3. 按空间+项目类别组织
4. 使用 `xlsx` 技能生成带公式的Excel文件

**关键计算规则**:
- 地面损耗: 面积 × 1.05
- 墙面面积: 周长 × 2.8m × 0.85
- 乳胶漆: 地面面积 × 3.2
- 美缝: 面积 × 对应系数(见 `price-reference.json` 的 `grout_coefficients`)
- 衣柜: 宽度(m) × 2.4m (标准高度) = 投影面积(m²)

### Step 4: 文件输出

将生成的Excel文件保存到工作区目录，并在右侧文件树展示。用户点击可预览/下载。

## 成功案例

### 招商湾湖臻境3号楼1801
- 面积: 136.95m², 4室
- 合同总价: ¥98,367.76 (¥717.81/m²)
- 10大项: 水电/拆除/砌墙/防水/瓦工/木工/油漆/门窗/安装/其他

## 流程二: 方案书生成

当用户说"方案书/设计方案/客户方案"时执行：

### Step 1: 信息收集

读取 `proposal-template.json` 中 `collect_fields` 的必填项，检查是否已知：
- customer_name（客户姓名）
- project_name（项目名称）
- area（面积）
- style（风格）
- quality_level（档次）

缺少任何必填项时，调用 `ask_user` 追问。

### Step 2: 生成方案书

按 `proposal-template.json` 的 `document_structure.sections` 顺序生成内容：

1. **封面**: 公司名+项目名+客户名+日期
2. **公司简介**: 使用默认模板或用户自定义
3. **设计理念**: 根据 `style_keywords` 生成 200-300 字描述
4. **空间规划**: 按每个房间生成方案描述
5. **主材推荐**: 根据 `quality_level` 推荐品牌（参考 `brand_recommendations`）
6. **预算概览**: 从 `price-reference.json` 计算费用汇总
7. **施工周期**: 从 `construction-schedule.json` 计算总工期
8. **质保承诺**: 使用模板质保条款
9. **效果图**: 调用 `generate_image` 生成 1-2 张风格效果图

### Step 3: 输出文件

使用 `docx` 技能或 `write_file` 生成 DOCX 文件：
```
{project_name}_装修方案书.docx
```

## 流程三: 施工排期

当用户说"排期/进度/工期/甘特图"时执行：

### Step 1: 确认面积和工程范围

### Step 2: 计算工期

从 `construction-schedule.json` 读取：
1. 根据面积查 `area_factor` 获得调整系数
2. 每阶段工期 = base_days × factor
3. 按 `depends_on` 排列先后顺序
4. 计算开始/结束日期（从用户指定的开工日算起）

### Step 3: 生成甘特图 Excel

使用 `xlsx` 技能生成包含：
- Sheet1: 施工进度表（阶段/工作内容/天数/日期/备注）
- Sheet2: 横道图（甘特图可视化）
- 关键里程碑标注: 水电验收/闭水试验/竣工验收

```
{project_name}_施工进度表.xlsx
```

## 流程四: 材料算量

当用户说"算量/用量/几片/多少"时执行：

### 常用算量公式
- **地砖片数**: 面积 ÷ (砖长×砖宽) × 1.05(损耗)
- **墙砖面积**: 周长 × 层高(2.8m) × 0.85(扣门窗)
- **乳胶漆面积**: 地面面积 × 3.2
- **美缝长度**: 地砖面积 × 系数(800x800=6.7米/m², 600x1200=7.2米/m²)
- **木地板**: 面积 × 1.08(损耗)
- **踢脚线**: 周长 - 门洞宽度

### 输出格式
计算后给出：数量 + 推荐品牌 + 价格区间 + 注意事项

## 流程五: 效果图生成

当用户说"效果图/设计图/参考图"时执行：

1. 确认: 房间(客厅/卧室/厨房等) + 风格 + 面积
2. 构建详细 prompt（含风格关键词、色彩、材质、光线）
3. 调用 `generate_image` 生成
4. 文件通知用户可点击查看
