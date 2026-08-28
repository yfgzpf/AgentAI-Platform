# 装修技能验收标准 v2.0

> 2026-08-13 制定。砍掉 7 个假能力，聚焦 2 个核心技能做到真正可用。

---

## 验收项一：tile-layout-generator（瓷砖排版）

### 必须通过的场景

| # | 场景 | 输入 | 验收标准 |
|---|------|------|----------|
| T1 | 矩形房间直铺 | 5m×4m, 800×800mm, straight | 整砖数 + 切割砖数正确；SVG 可视化渲染；DXF 可用 AutoCAD 打开 |
| T2 | 矩形房间工字铺 | 5m×4m, 800×800mm, staggered | 奇数列错缝 1/2；切割砖在边缘正确 |
| T3 | 带障碍物 | 6m×5m, 600×1200mm, 柱子 400×400mm | 障碍物区域不排砖；周围切割砖正确 |
| T4 | L 型凹凸户型 | 多边形顶点列表 | 凹凸区域正确裁剪；非矩形区域不排砖 |
| T5 | 斜铺 45° | 4m×3m, 600×600mm, diagonal | 瓷砖旋转 45°；边缘三角形切割砖正确 |
| T6 | 自然语言输入 | "客厅5米乘4米，800x800砖，工字铺" | 正确解析参数并执行 |

### 输出要求

1. **layout_result.json** — 包含完整瓷砖列表（x, y, width, height, is_cut, rotation）
2. **tile_layout.svg** — 可视化铺装图，整砖灰色、切割砖橙色虚线、障碍物红色、尺寸标注
3. **tile_layout.dxf** — CAD 文件，分层（BORDER/FULL_TILE/CUT_TILE/OBSTACLE/DIMENSION）
4. **summary** — 整砖数、切割砖数、损耗率、总面积、总片数、预估成本

### 数据契约（供 quotation 消费）

```json
{
  "tile_layout_output": {
    "room_area_m2": 20.0,
    "tile_spec": "800x800mm",
    "pattern": "staggered",
    "full_tiles": 30,
    "cut_tiles": 12,
    "total_pieces": 42,
    "waste_rate_percent": 5.2,
    "tile_area_m2": 0.64,
    "total_tile_area_m2": 26.88,
    "estimated_cost": 1680.0,
    "price_per_piece": 40.0
  }
}
```

---

## 验收项二：smart-quotation（智能报价）

### 必须通过的场景

| # | 场景 | 输入 | 验收标准 |
|---|------|------|----------|
| Q1 | 基础报价 | 100m², standard 档次 | 生成完整 Excel；总价在 1500-2500 元/m² 范围内 |
| Q2 | 三档对比 | 100m², economy/standard/luxury | 三档总价递增；经济型 < 标准型 < 豪华型 |
| Q3 | 从排版结果导入 | tile-layout 的输出 JSON | 瓷砖铺贴面积从排版结果自动读取，而非手动输入 |
| Q4 | 价格更新 | 修改某项目单价后重新生成 | 新单价生效；旧模板保留 |
| Q5 | 分类汇总正确 | 任意输入 | 各分类小计之和 = 总计 |

### 输出要求

1. **quotation_{timestamp}.xlsx** — 完整报价单（标题、客户信息、分类明细、合计、管理费、设计费、总计）
2. **summary JSON** — 总价、每平米单价、分类汇总、项目数
3. **数据来源标注** — 哪些工程量来自排版导入，哪些来自估算

---

## 验收项三：数据流打通

```
tile-layout-generator --输出--> layout_result.json
                                    ↓
smart-quotation --读取--> layout_result.json 中的 tile_layout_output
                                    ↓
                  自动填充地砖铺贴面积、瓷砖用量、瓷砖成本
```

### 验收标准
- quotation 的 `quantities` 参数支持 `tile_layout_file` 字段
- 传入排版结果文件路径后，自动提取瓷砖面积和用量
- 不传入时，回退到面积估算模式

---

## 验收项四：废弃假能力

以下 7 个技能标记为 deprecated，SKILL.md 头部加 `status: deprecated`：

| 技能 | 原因 |
|------|------|
| cad-ai-designer | 固定参数填空，非 AI 生成 |
| sketch-to-cad | 依赖 OpenCV 但 mock 降级返回假数据 |
| hvac-designer | 简单面积×系数，无真实负荷计算 |
| plumbing-layout-generator | 固定模板生成，无管径计算 |
| construction-supervisor | if-else 关键词匹配 |
| requirement-interview | 固定问卷模板 |
| material-selector | 硬编码材料列表 |
