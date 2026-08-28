---
name: smart-quotation
description: 智能报价表生成器 v2.0。支持从瓷砖排版结果自动导入工程量，价格库可更新，三档报价，Excel导出带数据来源标注。
version: 2.0.0
metadata:
  category: decoration
  tags: [quotation, quote, pricing, excel, 报价, 报价单, 单价, 工程量]
  author: AgentAI Team
  requires:
    bins: [python3]
    python_packages: [openpyxl, pandas]
  riskLevel: low
  triggers:
    - "生成.*报价"
    - "报价单.*生成"
    - "学习.*报价"
    - "上传.*报价表"
    - "报价.*模板"
    - "制作.*报价单"
    - "导出.*报价"
    - "更新.*价格"
    - "查看.*价格"
---

# 智能报价表生成器 v2.0 💰

## 核心能力

### 1. 工程量自动导入
- 从 `tile-layout-generator` 的输出文件自动读取瓷砖铺贴面积、用量、成本
- 支持手动输入面积/数量
- 混合模式：排版导入 + 手动补充

### 2. 价格库管理
- 内置默认三档价格（经济/标准/豪华）
- 支持运行时更新任意项目单价
- 价格覆盖存储在 `price-library.json`

### 3. 三档报价
- economy: 经济型 (800-1200元/m²)
- standard: 舒适型 (1500-2500元/m²)
- luxury: 豪华型 (3000元/m²+)

### 4. 数据来源标注
- Excel 报价单新增"数据来源"列
- 标注每个项目数据来自"排版导入"还是"估算"
- 便于审核和追溯

## 输入参数

### generate 模式

| 参数 | 类型 | 说明 |
|------|------|------|
| mode | string | "generate" |
| quantities | object | 工程量数据（可选，如有 tile_layout_file） |
| tier | string | economy/standard/luxury |
| tile_layout_file | string | 瓷砖排版结果文件路径 |
| project_info | object | 客户名、地址等 |
| template_id | string | 学习模板ID |

### price 模式

| 参数 | 类型 | 说明 |
|------|------|------|
| mode | string | "price" |
| action | string | view/update/reset |
| category | string | 分类（update必填） |
| name | string | 项目名（update必填） |
| prices | object | {economy, standard, luxury} |

## 数据流

```
tile-layout-generator
  → layout_result.json (含 tile_layout_output)
    → smart-quotation (tile_layout_file 参数)
      → 自动填充地砖面积、瓷砖用量、瓷砖成本
        → quotation.xlsx (带数据来源标注)
```
