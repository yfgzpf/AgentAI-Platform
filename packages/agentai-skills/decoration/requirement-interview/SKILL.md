---
name: requirement-interview
description: 装修需求结构化访谈助手。通过智能问答收集客户装修需求，生成标准化的需求文档，包含户型信息、风格偏好、功能需求、预算范围等关键信息。
description_zh: "装修需求结构化访谈助手，智能收集客户需求并生成标准文档"
description_en: "Structured requirement interview assistant for decoration projects"
version: 1.0.0
metadata:
  category: decoration
  tags:
    - requirement
    - interview
    - survey
    - 需求
    - 访谈
    - 问卷
  author: AgentAI Team
  requires:
    bins:
      - python3
  parallelSafe: true
  riskLevel: low
  triggers:
    - "需求.*调研"
    - "客户.*访谈"
    - "装修.*问卷"
    - "了解.*需求"
    - "需求.*文档"
---

# 需求结构化访谈助手 📝

智能收集客户装修需求，生成专业需求文档。

## 核心能力

### 1. 智能问答引导
```
AI: "您好，为了给您提供最适合的装修方案，我需要了解几个方面的问题。首先，请问您的房子面积是多少平米？"
客户: "100平"
AI: "好的，是三室两厅吗？"
...
```

### 2. 需求结构化整理
- 基础信息（面积、户型、楼层）
- 居住需求（人数、年龄、特殊需求）
- 风格偏好（颜色、材质、参考图）
- 功能需求（收纳、办公、娱乐）
- 预算范围（总预算、单项预算）
- 时间要求（入住时间、工期要求）

### 3. 需求文档生成
- 标准化需求文档
- 设计师 briefing
- 报价依据

## 访谈流程

### 阶段 1: 基础信息
- 房屋面积
- 户型结构
- 楼层/电梯
- 房龄/新房二手房

### 阶段 2: 居住需求
- 居住人数
- 年龄结构（老人/小孩）
- 宠物情况
- 特殊人群需求（孕妇/残障）

### 阶段 3: 风格偏好
- 喜欢的装修风格
- 颜色偏好
- 材质偏好
- 参考图片/案例

### 阶段 4: 功能需求
- 收纳需求
- 办公需求
- 娱乐需求
- 厨房功能
- 卫生间功能

### 阶段 5: 预算与时间
- 总预算范围
- 单项预算（重点投入区域）
- 入住时间
- 工期要求

## 输出格式

```json
{
  "basic_info": {
    "area": 100,
    "rooms": "3室2厅1卫",
    "floor": 15,
    "elevator": true,
    "property_type": "新房"
  },
  "living_needs": {
    "residents": 3,
    "adults": 2,
    "children": 1,
    "elderly": 0,
    "pets": [],
    "special_needs": []
  },
  "style_preference": {
    "style": "现代简约",
    "colors": ["白色", "原木色", "灰色"],
    "materials": ["木地板", "乳胶漆", "大理石"],
    "references": []
  },
  "functional_needs": {
    "storage": "高",
    "office": true,
    "entertainment": "一般",
    "kitchen": "经常做饭",
    "bathroom": "需要干湿分离"
  },
  "budget_time": {
    "total_budget": 200000,
    "priority_areas": ["厨房", "卫生间"],
    "move_in_date": "2024-10-01",
    "duration_requirement": "3个月"
  }
}
```

## 使用示例

### 示例 1: 新客户访谈
```
开始需求访谈
```

### 示例 2: 快速收集
```
生成需求问卷，发给客户填写
```

### 示例 3: 需求分析
```
分析这个客户的需求重点
```
