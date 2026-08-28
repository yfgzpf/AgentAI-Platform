---
name: hvac-designer
description: 智能暖通系统设计器。根据户型、面积、气候区自动设计地暖盘管布局、新风系统管路走向、空调冷负荷计算，生成CAD图纸和材料清单。支持水地暖、电地暖、中央新风、壁挂新风多种方案。
description_zh: "智能暖通系统设计器，自动生成地暖/新风CAD图纸和材料清单"
description_en: "Intelligent HVAC system designer for underfloor heating and fresh air systems"
version: 1.0.0
status: deprecated
deprecated_reason: "简单面积×系数，无真实负荷计算。无气候区数据、无建筑热工参数。"
metadata:
  category: decoration
  tags:
    - hvac
    - heating
    - underfloor
    - fresh-air
    - 地暖
    - 新风
    - 暖通
    - 采暖
    - 通风
    - 空调
  author: AgentAI Team
  requires:
    bins:
      - python3
    python_packages:
      - ezdxf
      - numpy
  parallelSafe: true
  riskLevel: low
  triggers:
    - "地暖.*设计"
    - "地暖.*布局"
    - "新风.*设计"
    - "新风.*系统"
    - "暖通.*方案"
    - "采暖.*设计"
    - "盘管.*布局"
    - "冷负荷.*计算"
    - "空调.*选型"
    - "通风.*设计"
---

# 暖通系统设计器 🌡️

智能设计地暖和新风系统，让室内环境更舒适。

## 自动触发场景

### 1. 地暖设计
```
User: "帮我设计地暖方案"
→ 自动生成盘管布局图 + 分集水器位置 + 材料清单
```

### 2. 新风设计
```
User: "100平房子需要多大新风量"
→ 计算新风量 + 设计管路走向 + 选型推荐
```

### 3. 暖通综合方案
```
User: "地暖和新风一起做怎么设计"
→ 综合方案 + 管路协调 + 预算估算
```

## 核心能力

### 地暖系统
- **水地暖**: PERT/PEX 盘管设计，间距 150-300mm
- **电地暖**: 发热电缆布局，功率 100-150W/m²
- **盘管布局**: 回字形、双回形、螺旋形
- **分集水器**: 位置优化，每路 60-80m

### 新风系统
- **中央新风**: 吊顶式/地送风管路设计
- **风量计算**: 人均 30m³/h 或换气次数 0.5-1 次/h
- **管路设计**: 主管 160mm，支管 75-110mm
- **风口布局**: 送排风位置优化

### 负荷计算
- **采暖负荷**: 按面积 80-150W/m²
- **冷负荷**: 围护结构 + 人员 + 设备 + 新风
- **气候分区**: 严寒/寒冷/夏热冬冷/夏热冬暖

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| rooms | array | 是 | 房间列表 |
| climate_zone | string | 否 | 气候区 (严寒/寒冷/夏热冬冷/夏热冬暖) |
| heating_type | string | 否 | 地暖类型 (water/electric) |
| fresh_air_type | string | 否 | 新风类型 (central/wall) |
| outdoor_temp | number | 否 | 室外计算温度 |

## 输出

### 1. 地暖布局图 (DXF)
- 盘管走向（按房间分色）
- 分集水器位置
- 温控器位置
- 伸缩缝位置

### 2. 新风管路图 (DXF)
- 主管走向
- 支管分布
- 风口位置
- 主机位置

### 3. 材料清单
```json
{
  "heating": {
    "pipes": {"pert_16": 480, "unit": "米"},
    "insulation": {"xps": 136, "unit": "m²"},
    "manifolds": {"count": 2, "ports": 8},
    "circulation_pumps": 1
  },
  "fresh_air": {
    "main_duct": {"160mm": 25, "unit": "米"},
    "branch_ducts": {"75mm": 60, "110mm": 30, "unit": "米"},
    "vents": {"supply": 6, "exhaust": 6},
    "machine": {"model": "XXX", "airflow": 350}
  }
}
```

## 使用示例

### 示例 1: 地暖设计
```
100平三室两厅，厦门地区，设计水地暖方案
```

### 示例 2: 新风设计
```
帮我计算需要多大的新风量，怎么布置管道
```

### 示例 3: 综合方案
```
地暖和新风一起设计，注意管路不要冲突
```
