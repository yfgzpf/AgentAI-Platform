---
name: cad-ai-designer
description: AI驱动的智能CAD设计助手。根据自然语言描述生成参数化CAD模型，支持装修/建筑行业的柜体、户型、构件设计。可生成可编辑的Python代码，支持特征标记和局部修改。
description_zh: "AI驱动的智能CAD设计助手，支持装修/建筑行业的参数化建模"
description_en: "AI-powered intelligent CAD design assistant for decoration/architecture"
version: 1.0.0
metadata:
  category: decoration
  tags:
    - cad
    - design
    - parametric
    - 3d-model
    - architecture
    - decoration
    - build123d
    - ocp
  author: AgentAI Team
  requires:
    bins:
      - python3
    python_packages:
      - build123d
      - cadquery
      - ocp
      - numpy
  parallelSafe: false
  riskLevel: medium
  triggers:
    - "CAD.*设计"
    - "生成.*模型"
    - "画.*柜子"
    - "设计.*户型"
    - "建模.*房间"
    - "参数化.*设计"
    - "3D.*模型"
    - "导出.*STEP"
    - "导出.*DXF"
---

# CAD AI Designer 🏗️

AI驱动的智能CAD设计助手，让自然语言变成可制造的3D模型。

## 核心能力

### 1. 自然语言生成CAD
```
User: "设计一个宽800深600高2000的衣柜，内部有挂衣区和抽屉"
→ 生成参数化Python代码
→ 执行生成3D模型
→ 导出STEP文件
→ 提供预览链接
```

### 2. 特征标记与局部修改
```
User: "把衣柜高度改成2200"
→ 定位 @cad[wardrobe_body]
→ 修改高度参数
→ 重新生成（仅变更部分）
→ 保持其他特征不变
```

### 3. 装修行业专用
- **柜体设计**：衣柜、橱柜、书柜、鞋柜
- **户型建模**：房间布局、墙体、门窗
- **构件生成**：踢脚线、吊顶、装饰线条

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| prompt | string | 是 | 自然语言描述 |
| type | string | 否 | 模型类型：cabinet/room/component |
| params | object | 否 | 结构化参数 |
| output_format | string | 否 | 输出格式：step/stl/dxf/glb |

## 输出结果

```json
{
  "success": true,
  "code_file": "models/wardrobe_001.py",
  "model_file": "output/step/wardrobe_001.step",
  "preview_url": "http://localhost:4178?file=wardrobe_001.step",
  "features": {
    "@cad[body]": "柜体主体",
    "@cad[door]": "柜门",
    "@cad[shelf]": "层板",
    "@cad[drawer]": "抽屉"
  },
  "parameters": {
    "width": 800,
    "depth": 600,
    "height": 2000
  }
}
```

## Scripts 执行流程

### 阶段 1: 参数解析 (pre_generate)
- 解析自然语言 → 结构化参数
- 校验参数合法性
- 加载设计规范

### 阶段 2: 代码生成 (generate)
- LLM 生成 build123d Python 代码
- 写入 models/[name].py
- 执行代码生成几何

### 阶段 3: 几何校验 (validate)
- 检查自相交、无效实体
- 验证尺寸约束
- 检查制造可行性

### 阶段 4: 文件导出 (export)
- 导出 STEP（工业标准）
- 导出 STL（3D打印）
- 导出 DXF（激光切割）

### 阶段 5: 预览渲染 (render)
- 启动 CAD 预览服务
- 生成模型快照
- 返回预览链接

## 特征标记系统

所有生成的几何特征都会标记 `@cad[feature_name]`，支持后续局部修改：

```python
# 生成的代码示例
@cad[body] = Box(width, depth, height)
@cad[door] = Box(width-10, depth-10, 20).locate(Z(height-20))
@cad[shelf_1] = Box(width-20, depth-20, 18).locate(Z(600))
@cad[shelf_2] = Box(width-20, depth-20, 18).locate(Z(1200))
```

## 设计模板

### 衣柜模板
```json
{
  "type": "wardrobe",
  "params": {
    "width": 800,      // 宽度 mm
    "depth": 600,      // 深度 mm
    "height": 2000,    // 高度 mm
    "door_count": 2,   // 门数量
    "shelf_count": 3,  // 层板数量
    "drawer_count": 2, // 抽屉数量
    "material": "plywood_18mm"
  }
}
```

### 橱柜模板
```json
{
  "type": "kitchen_cabinet",
  "params": {
    "width": 900,
    "depth": 600,
    "height": 850,
    "countertop": "quartz_20mm",
    "sink": "single_bowl",
    "faucet": "pull_out"
  }
}
```

## 安全约束

- 最小尺寸：10mm
- 最大尺寸：5000mm
- 壁厚限制：≥5mm（制造可行性）
- 禁止自相交几何

## 依赖说明

- **build123d**: 参数化建模核心
- **cadquery**: 备选建模库
- **ocp**: OpenCASCADE Python绑定
- **numpy**: 数值计算

## 使用示例

### 示例 1: 生成衣柜
```
设计一个双门衣柜，宽800深550高2100，内部有挂衣杆和两个抽屉
```

### 示例 2: 生成橱柜
```
生成一个L型橱柜，总长2400，包含水槽柜和灶台柜
```

### 示例 3: 修改设计
```
把刚才的衣柜改成三门，高度增加到2400
```
