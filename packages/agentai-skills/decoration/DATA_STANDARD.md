# 装修行业数据标准格式 📐

本文档定义装修行业各 Skill 之间的数据交换格式，确保技能间可以无缝协作。

## 版本
- **Version**: 1.0.0
- **Date**: 2026-08-12
- **Author**: AgentAI Team

---

## 1. 项目根对象 (Project)

```json
{
  "project_id": "uuid-string",
  "name": "招商湾湖臻境3号楼1801",
  "client": {
    "name": "张先生",
    "phone": "138****8888",
    "address": "厦门市湖里区"
  },
  "basic_info": {
    "area": 136.95,
    "rooms": "4室2厅2卫",
    "floor": 18,
    "total_floors": 33,
    "property_type": "新房",
    "orientation": "南北通透"
  },
  "design": {
    "style": "现代简约",
    "quality_level": "中档型",
    "budget_range": "1000-1300元/m²"
  },
  "phases": {
    "survey": {...},
    "design": {...},
    "quotation": {...},
    "construction": {...}
  },
  "created_at": "2026-08-01T10:00:00Z",
  "updated_at": "2026-08-12T15:30:00Z"
}
```

---

## 2. 户型数据 (FloorPlan)

由 `sketch-to-cad` 生成，被 `tile-layout-generator`、`plumbing-layout-generator` 等使用。

```json
{
  "floor_plan": {
    "version": "1.0",
    "unit": "m",
    "width": 12.5,
    "height": 10.8,
    "rooms": [
      {
        "id": "r001",
        "name": "客厅",
        "function": "living_room",
        "x": 0,
        "y": 0,
        "width": 4.5,
        "height": 4.2,
        "area": 18.9,
        "walls": [
          {"start": [0, 0], "end": [4.5, 0], "thickness": 0.2, "type": "load_bearing"},
          {...}
        ],
        "openings": [
          {"type": "door", "width": 0.9, "position": [4.5, 2.1], "direction": "inward"},
          {"type": "window", "width": 2.4, "position": [2.25, 4.2]}
        ]
      }
    ],
    "doors": [...],
    "windows": [...],
    "stairs": [...],
    "elevator_shaft": {...}
  }
}
```

---

## 3. 瓷砖铺装数据 (TileLayout)

由 `tile-layout-generator` 生成。

```json
{
  "tile_layout": {
    "version": "1.0",
    "room_id": "r001",
    "room_name": "客厅",
    "tile": {
      "type": "ceramic",
      "size": [800, 800],
      "unit": "mm",
      "brand": "马可波罗",
      "model": "CH8880",
      "color": "浅灰色"
    },
    "pattern": "straight",  // straight, staggered, herringbone, diagonal
    "grout_width": 2,
    "grout_color": "浅灰",
    "layout": {
      "start_point": [0.05, 0.05],
      "direction": "horizontal",
      "tiles": [
        {"x": 0.05, "y": 0.05, "rotation": 0, "cut": false},
        {"x": 0.85, "y": 0.05, "rotation": 0, "cut": false},
        {"x": 1.65, "y": 0.05, "rotation": 0, "cut": true, "cut_size": [0.4, 0.8]}
      ]
    },
    "materials": {
      "tile_count": 45,
      "tile_area": 28.8,
      "waste_rate": 0.05,
      "total_tiles": 48,
      "grout_length": 156,
      "tile_adhesive": 12.5
    },
    "files": {
      "dxf": "output/tile_layout_r001.dxf",
      "svg": "output/tile_layout_r001.svg"
    }
  }
}
```

---

## 4. 水电管线数据 (PlumbingLayout)

由 `plumbing-layout-generator` 生成。

```json
{
  "plumbing_layout": {
    "version": "1.0",
    "unit": "m",
    "water_supply": {
      "cold_water": {
        "pipe_type": "ppr_25",
        "paths": [
          {
            "id": "cw001",
            "points": [[0, 0], [0, 2.5], [1.5, 2.5]],
            "length": 4.0,
            "fittings": ["elbow_90", "tee"]
          }
        ],
        "total_length": 45.2
      },
      "hot_water": {
        "pipe_type": "ppr_20",
        "paths": [...],
        "total_length": 38.5
      }
    },
    "drainage": {
      "pipes": [
        {
          "id": "dr001",
          "type": "pvc_110",
          "points": [[1.5, 2.5], [0, 2.5], [0, 0]],
          "slope": 0.02,
          "length": 4.0
        }
      ]
    },
    "water_points": [
      {
        "id": "wp001",
        "room": "厨房",
        "type": "sink",
        "x": 1.5,
        "y": 2.5,
        "height": 0.45,
        "connections": {
          "cold": "cw001",
          "hot": "hw001",
          "drain": "dr001"
        }
      }
    ],
    "materials": {...}
  }
}
```

---

## 5. 电路布线数据 (ElectricalLayout)

由 `plumbing-layout-generator` 生成。

```json
{
  "electrical_layout": {
    "version": "1.0",
    "unit": "m",
    "distribution_panel": {
      "location": [0.5, 0.5],
      "circuits": [
        {
          "id": "C01",
          "name": "照明回路",
          "type": "lighting",
          "breaker": "16A",
          "wire": "bv_2.5",
          "rcd": false,
          "load": 1200
        },
        {
          "id": "C02",
          "name": "厨房插座",
          "type": "kitchen",
          "breaker": "25A",
          "wire": "bv_4.0",
          "rcd": true,
          "load": 3500
        }
      ]
    },
    "circuits": [
      {
        "id": "C01",
        "points": [
          {"x": 1.2, "y": 2.1, "type": "light", "power": 40},
          {"x": 3.5, "y": 2.1, "type": "light", "power": 40}
        ],
        "wire_length": 12.5,
        "conduit_length": 8.2
      }
    ],
    "sockets": [
      {
        "id": "S001",
        "room": "客厅",
        "type": "5_pin",
        "x": 2.5,
        "y": 1.5,
        "height": 0.3,
        "circuit": "C03",
        "power": 2500
      }
    ],
    "switches": [...],
    "weak_current": {
      "network": [...],
      "tv": [...],
      "phone": [...]
    },
    "materials": {...}
  }
}
```

---

## 6. 报价数据 (Quotation)

由 `smart-quotation` 生成。

```json
{
  "quotation": {
    "version": "1.0",
    "template_id": "user_template_001",
    "project_info": {
      "name": "招商湾湖臻境3号楼1801",
      "client": "张先生",
      "area": 136.95,
      "tier": "mid"
    },
    "items": [
      {
        "id": "q001",
        "category": "基础工程",
        "name": "拆除工程",
        "unit": "m²",
        "quantity": 41.1,
        "unit_price": 50,
        "subtotal": 2055,
        "remark": "按面积30%计算"
      }
    ],
    "summary": {
      "subtotal": 85000,
      "management_fee": 5100,
      "design_fee": 2550,
      "cleaning_fee": 800,
      "total": 93450,
      "per_sqm": 682.4
    },
    "breakdown": {
      "基础工程": {"items": 6, "total": 12500},
      "泥工工程": {"items": 4, "total": 28000},
      "木工工程": {"items": 3, "total": 22000},
      "油漆工程": {"items": 3, "total": 15000},
      "安装工程": {"items": 2, "total": 7500}
    },
    "files": {
      "excel": "output/quotation_20260812.xlsx"
    }
  }
}
```

---

## 7. 材料清单数据 (MaterialList)

```json
{
  "material_list": {
    "version": "1.0",
    "categories": [
      {
        "name": "瓷砖类",
        "items": [
          {
            "id": "m001",
            "name": "客厅地砖",
            "spec": "800x800mm",
            "brand": "马可波罗",
            "model": "CH8880",
            "quantity": 48,
            "unit": "片",
            "unit_price": 128,
            "total_price": 6144,
            "supplier": "厦门建材市场A区",
            "delivery_days": 3
          }
        ]
      }
    ],
    "total_cost": 45000,
    "eco_rating": "E0级"
  }
}
```

---

## 8. 施工进度数据 (ConstructionSchedule)

```json
{
  "construction_schedule": {
    "version": "1.0",
    "start_date": "2026-08-15",
    "total_days": 75,
    "phases": [
      {
        "id": "p1",
        "name": "拆除阶段",
        "start": "2026-08-15",
        "end": "2026-08-20",
        "duration": 5,
        "tasks": [
          {"name": "墙体拆除", "duration": 2, "workers": 2},
          {"name": "垃圾清运", "duration": 3, "workers": 2}
        ],
        "dependencies": [],
        "milestone": false
      },
      {
        "id": "p2",
        "name": "水电阶段",
        "start": "2026-08-21",
        "end": "2026-09-05",
        "duration": 15,
        "tasks": [...],
        "dependencies": ["p1"],
        "milestone": true,
        "milestone_name": "水电验收"
      }
    ],
    "milestones": [
      {"date": "2026-09-05", "name": "水电验收"},
      {"date": "2026-09-25", "name": "防水验收"},
      {"date": "2026-11-30", "name": "竣工验收"}
    ]
  }
}
```

---

## 9. 技能间数据流

```
sketch-to-cad
    ↓ FloorPlan
tile-layout-generator ──→ TileLayout
plumbing-layout-generator ──→ PlumbingLayout + ElectricalLayout
smart-quotation ──→ Quotation
material-selector ──→ MaterialList
construction-supervisor ──→ ConstructionSchedule
```

---

## 10. 数据验证规则

| 字段 | 类型 | 必填 | 验证规则 |
|------|------|------|----------|
| project_id | string | 是 | UUID v4 格式 |
| area | number | 是 | > 0 |
| rooms | array | 是 | length >= 1 |
| unit | string | 是 | enum: ["m", "mm", "cm"] |
| coordinates | array | 是 | [x, y], x >= 0, y >= 0 |

---

## 11. 扩展规范

新增 Skill 时，需：
1. 定义输入数据格式（引用本标准中的对象）
2. 定义输出数据格式（添加到本标准）
3. 更新数据流图
4. 添加验证规则
