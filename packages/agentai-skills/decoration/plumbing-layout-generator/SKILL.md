---
name: plumbing-layout-generator
description: 智能水电管线布局图生成器。根据房间平面图自动生成给排水管线走向图、电路布线图、强弱电点位图，计算管材用量，导出DXF CAD文件和材料清单。支持冷热水管分离、强弱电分管、回路规划。
description_zh: "智能水电管线布局图生成器，自动生成水电图纸和材料清单"
description_en: "Intelligent plumbing and electrical layout generator with CAD export"
version: 1.0.0
status: deprecated
deprecated_reason: "固定模板生成DXF，无管径计算、无水力计算、无回路负荷校验。"
metadata:
  category: decoration
  tags:
    - plumbing
    - electrical
    - water
    - pipe
    - wiring
    - 水电
    - 管线
    - 布线
    - 回路
    - 给排水
    - 强弱电
  author: AgentAI Team
  requires:
    bins:
      - python3
    python_packages:
      - ezdxf
      - svgwrite
      - numpy
  parallelSafe: true
  riskLevel: low
  triggers:
    - "水电.*布局"
    - "水电.*设计"
    - "管线.*走向"
    - "电路.*布线"
    - "给排水.*设计"
    - "水管.*走向"
    - "强弱电"
    - "回路.*设计"
    - "插座.*布局"
    - "水电图"
    - "水电.*方案"
---

# 水电管线布局图生成器 🔧

智能生成水电管线布局图，自动规划管材走向和电路回路。

## 自动触发场景

### 1. 水电设计
```
User: "帮我设计水电布局方案"
→ 自动生成给排水管线图 + 电路布线图 + 材料清单
```

### 2. 回路规划
```
User: "100平三室两厅怎么分回路"
→ 自动规划照明回路、插座回路、空调回路、厨房回路等
```

### 3. 管材计算
```
User: "水电需要多少管材"
→ 计算PVC管、PPR管、电线用量，生成采购清单
```

## 核心能力

### 给排水系统
- 冷热水管走向规划（PPR管）
- 排水管路径设计（PVC管）
- 地漏、台盆、马桶、淋浴水位定位
- 水管避让规则（热水在上、冷水在下）

### 电气系统
- 强电回路规划（照明/插座/空调/厨房/卫生间分路）
- 弱电布局（网线/电视/电话）
- 开关、插座点位设计
- 配电箱回路分配
- 强弱电分管敷设（间距≥300mm）

### 规范遵循
- 《住宅设计规范》GB 50096
- 《住宅装饰装修工程施工规范》GB 50327
- 《建筑电气工程施工质量验收规范》GB 50303

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| rooms | array | 是 | 房间列表 [{name, width, height, function}] |
| floor_plan | object | 否 | 来自 sketch-to-cad 的平面图数据 |
| water_points | array | 否 | 水位点位 [{room, type, x, y}] |
| socket_points | array | 否 | 插座点位 [{room, type, x, y, power}] |
| standard | string | 否 | 执行标准 (国标/地方标准) |

## 输出

### 1. 给排水管线图 (DXF + SVG)
- 冷水管走向（蓝色）
- 热水管走向（红色）
- 排水管走向（绿色）
- 水位点位标注

### 2. 电路布线图 (DXF + SVG)
- 强电管线走向（黄色）
- 弱电管线走向（紫色）
- 回路编号标注
- 配电箱系统图

### 3. 材料清单
```json
{
  "pipes": {
    "ppr_20": {"name": "PPR20mm热水管", "quantity": 45, "unit": "米"},
    "ppr_25": {"name": "PPR25mm冷水管", "quantity": 38, "unit": "米"},
    "pvc_50": {"name": "PVC50mm排水管", "quantity": 22, "unit": "米"},
    "pvc_110": {"name": "PVC110mm主排水管", "quantity": 12, "unit": "米"}
  },
  "wires": {
    "bv_2.5": {"name": "BV2.5mm²铜芯线", "quantity": 180, "unit": "米"},
    "bv_4.0": {"name": "BV4.0mm²铜芯线", "quantity": 65, "unit": "米"},
    "bv_6.0": {"name": "BV6.0mm²铜芯线", "quantity": 30, "unit": "米"}
  },
  "conduits": {
    "pvc_16": {"name": "PVC16mm穿线管", "quantity": 120, "unit": "米"},
    "pvc_20": {"name": "PVC20mm穿线管", "quantity": 45, "unit": "米"}
  },
  "accessories": {
    "sockets": 35,
    "switches": 18,
    "junction_boxes": 25,
    "water_outlets": 12
  }
}
```

## 使用示例

### 示例 1: 全屋水电设计
```
帮我设计100平三室两厅的水电布局方案
```

### 示例 2: 仅电路设计
```
帮我规划电路回路和插座位置
```

### 示例 3: 基于已有平面图
```
根据这个CAD平面图生成水电图纸
```
