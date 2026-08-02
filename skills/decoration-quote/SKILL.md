---
name: decoration-quote
description: "装修施工图识别与报价生成技能。从CAD/PDF图纸提取户型数据，识别图例(墙体/门窗/设备/水电)，按空间报价法生成带Excel公式的专业预算表。含11字段追问表单。"
---

# 装修施工图识别与报价生成

## 执行流程

收到用户装修报价请求时，按以下步骤执行：

### Step 0: 加载上下文文件

每次生成报价前，使用 `read_file` 读取以下3个文件，将其内容注入上下文：

```bash
read_file skills/decoration-quote/legend-recognition.json   # 图例识别
read_file skills/decoration-quote/price-reference.json       # 价格表
read_file skills/decoration-quote/quotation-template.json    # 报价表样式
```

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
