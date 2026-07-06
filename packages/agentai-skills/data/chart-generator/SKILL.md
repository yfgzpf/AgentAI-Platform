---
name: chart-generator
description: Generate beautiful charts and visualizations from data. Automatically creates bar charts, line charts, pie charts, and more as SVG for inline display.
description_zh: "从数据生成精美图表，自动创建柱状图/折线图/饼图等，以 SVG 格式内联显示"
description_en: "Generate beautiful charts from data: bar, line, pie, scatter charts as SVG"
version: 1.0.0
metadata:
  category: data
  tags:
    - chart
    - visualization
    - svg
    - data-viz
    - graph
    - plot
    - analytics
  author: AgentAI Team
  requires:
    bins:
      - python3
  parallelSafe: true
  riskLevel: low
  triggers:
    - "图表.*生成"
    - "可视化.*数据"
    - "[Bb]ar.*[Cc]hart"
    - "[Ll]ine.*[Cc]hart"
    - "[Pp]ie.*[Cc]hart"
    - "[Ss]catter.*[Pp]lot"
    - "[Dd]ata.*[Vv]iz"
    - "趋势.*分析"
    - "占比.*分析"
    - "对比.*分析"
---

# Chart Generator 📊

Transform data into beautiful visualizations. The AI automatically detects when you need charts and generates them.

## Auto-Trigger Scenarios

The AI will **automatically** create charts when you:

### 1. Mention Data Analysis
```
User: "分析一下销售趋势"
→ AI generates line chart showing sales over time
```

### 2. Ask for Comparison
```
User: "对比各产品线的收入"
→ AI generates bar chart comparing product lines
```

### 3. Request Proportions
```
User: "看看市场份额分布"
→ AI generates pie chart showing market share
```

### 4. Want to See Relationships
```
User: "价格和销量的关系"
→ AI generates scatter plot
```

## Chart Types

| Type | Best For | Example |
|------|----------|---------|
| **bar** | Comparing categories | Sales by product |
| **line** | Trends over time | Monthly growth |
| **pie** | Proportions/percentages | Market share |
| **scatter** | Relationships/correlations | Price vs sales |
| **area** | Cumulative trends | Total users over time |
| **horizontal-bar** | Long category names | Survey responses |

## Features

- **Auto Data Detection**: AI extracts data from your message or context
- **Smart Defaults**: Automatic colors, labels, and scaling
- **Interactive SVG**: Rendered with render_widget for inline display
- **Export Ready**: Can save as file if needed

## Input Formats

### Option 1: Direct Data
```json
{
  "type": "bar",
  "data": {
    "labels": ["Product A", "Product B", "Product C"],
    "values": [120, 190, 80]
  },
  "title": "Sales by Product"
}
```

### Option 2: From Database (auto)
```
User: "把刚才的查询结果可视化"
→ AI automatically uses previous database-skill result
```

### Option 3: From Text (auto)
```
User: "苹果 30%，香蕉 25%，橙子 45%"
→ AI parses and generates pie chart
```

## Styling

- Clean, modern design
- Automatic color palette
- Responsive sizing
- Accessible colors
- Professional appearance

## Examples

### Sales Trend
```
User: "显示过去6个月的销售趋势"
→ Line chart with months on X-axis, sales on Y-axis
```

### Category Comparison
```
User: "对比各部门的预算"
→ Horizontal bar chart with departments
```

### Market Share
```
User: "市场份额占比"
→ Pie chart with percentages
```

### Correlation Analysis
```
User: "广告投入和销售额的关系"
→ Scatter plot with trend line
```
