---
name: tile-layout-generator
description: 智能瓷砖铺装图生成器 v2.0。支持矩形和任意多边形（L型/凹凸户型），4种铺装模式，障碍物裁剪，输出SVG可视化+DXF CAD+数据契约。
version: 2.0.0
metadata:
  category: decoration
  tags: [tile, layout, flooring, cad, dxf, 瓷砖, 铺装, 排版]
  author: AgentAI Team
  requires:
    bins: [python3]
    python_packages: [ezdxf, svgwrite, numpy]
  riskLevel: low
  triggers:
    - "瓷砖.*铺装"
    - "铺装.*图"
    - "排版.*瓷砖"
    - "计算.*瓷砖"
    - "瓷砖.*用量"
    - "铺砖.*方案"
    - "地砖.*排版"
    - "墙砖.*排版"
---

# 瓷砖铺装图生成器 v2.0 🧱

## 核心能力

### 1. 支持任意户型
- **矩形房间**：`room_width` + `room_height`
- **多边形房间**：`room_polygon` 顶点列表（L型、凹凸、异形）

### 2. 四种铺装模式
- 直铺 (straight)
- 工字铺 (staggered)
- 斜铺 (diagonal, 45°)
- 人字铺 (herringbone)

### 3. 障碍物处理
- 矩形障碍物：`obstacles: [{x, y, width, height}]`
- 多边形障碍物：`obstacles: [{polygon: [{x,y},...]}]`
- 障碍物区域不排砖，周围正确切割

### 4. 数据契约输出
输出 `tile_layout_output` 字段，供 `smart-quotation` 直接消费。

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| room_width | number | 矩形必填 | 房间宽度（mm） |
| room_height | number | 矩形必填 | 房间长度（mm） |
| room_polygon | array | 多边形必填 | 顶点列表 `[{x,y},...]` |
| tile_width | number | 是 | 瓷砖宽度（mm） |
| tile_height | number | 是 | 瓷砖长度（mm） |
| pattern | string | 否 | straight/staggered/diagonal/herringbone |
| grout_width | number | 否 | 留缝宽度（mm），默认2 |
| start_point | string | 否 | center/corner |
| obstacles | array | 否 | 障碍物列表 |
| price_per_piece | number | 否 | 单片价格（元） |
