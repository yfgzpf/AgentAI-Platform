#!/usr/bin/env python3
"""
导出DXF CAD文件 v2.0
- 支持多边形房间
- 支持多边形障碍物
"""

import json
import sys
import os

# Windows 编码修复
if sys.platform == 'win32':
    try:
        sys.stdin.reconfigure(encoding='utf-8', errors='replace')
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass


def generate_dxf(layout_data: dict, params: dict) -> str:
    """生成DXF文件"""

    try:
        import ezdxf
    except ImportError:
        return generate_simple_dxf(layout_data, params)

    tiles = layout_data.get("tiles", [])
    room_width = params.get("room_width", 5000)
    room_height = params.get("room_height", 4000)
    room_polygon = params.get("room_polygon")

    doc = ezdxf.new('R2010')
    msp = doc.modelspace()

    # 图层
    doc.layers.add("BORDER", color=7)
    doc.layers.add("FULL_TILE", color=8)
    doc.layers.add("CUT_TILE", color=30)
    doc.layers.add("OBSTACLE", color=1)
    doc.layers.add("DIMENSION", color=3)

    # 房间轮廓
    if room_polygon:
        pts = [(v["x"], v["y"]) for v in room_polygon]
        pts.append(pts[0])  # 闭合
        msp.add_lwpolyline(pts, close=True, dxfattribs={'layer': 'BORDER', 'lineweight': 30})
    else:
        msp.add_lwpolyline(
            [(0, 0), (room_width, 0), (room_width, room_height), (0, room_height), (0, 0)],
            close=True, dxfattribs={'layer': 'BORDER', 'lineweight': 30}
        )

    # 瓷砖
    for tile in tiles:
        x = tile.get("x", 0)
        y = tile.get("y", 0)
        w = tile.get("width", 0)
        h = tile.get("height", 0)
        is_cut = tile.get("is_cut", False)
        rotation = tile.get("rotation", 0)

        layer = 'CUT_TILE' if is_cut else 'FULL_TILE'
        pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)]

        if rotation:
            cx = x + w / 2
            cy = y + h / 2
            import math
            rad = math.radians(rotation)
            cos_r = math.cos(rad)
            sin_r = math.sin(rad)
            rotated = []
            for px, py in pts:
                dx = px - cx
                dy = py - cy
                rx = cx + dx * cos_r - dy * sin_r
                ry = cy + dx * sin_r + dy * cos_r
                rotated.append((rx, ry))
            pts = rotated

        entity = msp.add_lwpolyline(pts, close=True, dxfattribs={'layer': layer})
        if is_cut:
            entity.dxf.linetype = 'DASHED'

    # 障碍物
    for obs in params.get("obstacles", []):
        if obs.get("polygon"):
            pts = [(v["x"], v["y"]) for v in obs["polygon"]]
            pts.append(pts[0])
            msp.add_lwpolyline(pts, close=True, dxfattribs={'layer': 'OBSTACLE'})
        else:
            ox, oy = obs.get("x", 0), obs.get("y", 0)
            ow, oh = obs.get("width", 0), obs.get("height", 0)
            msp.add_lwpolyline(
                [(ox, oy), (ox + ow, oy), (ox + ow, oy + oh), (ox, oy + oh), (ox, oy)],
                close=True, dxfattribs={'layer': 'OBSTACLE'}
            )

    # 尺寸标注
    msp.add_linear_dim(
        base=(room_width / 2, -200), p1=(0, 0), p2=(room_width, 0),
        dxfattribs={'layer': 'DIMENSION'}
    )
    msp.add_linear_dim(
        base=(-200, room_height / 2), p1=(0, 0), p2=(0, room_height),
        angle=90, dxfattribs={'layer': 'DIMENSION'}
    )

    os.makedirs("output", exist_ok=True)
    dxf_file = "output/tile_layout.dxf"
    doc.saveas(dxf_file)
    return dxf_file


def generate_simple_dxf(layout_data: dict, params: dict) -> str:
    """简化版DXF（无ezdxf依赖）"""
    room_width = params.get("room_width", 5000)
    room_height = params.get("room_height", 4000)
    tiles = layout_data.get("tiles", [])

    lines = []
    lines.extend([
        "0", "SECTION", "2", "HEADER", "0", "ENDSEC",
        "0", "SECTION", "2", "TABLES",
        "0", "TABLE", "2", "LAYER", "70", "4",
        "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS",
        "0", "LAYER", "2", "TILES", "70", "0", "62", "8", "6", "CONTINUOUS",
        "0", "LAYER", "2", "CUT_TILES", "70", "0", "62", "30", "6", "DASHED",
        "0", "LAYER", "2", "OBSTACLES", "70", "0", "62", "1", "6", "CONTINUOUS",
        "0", "ENDTAB", "0", "ENDSEC",
        "0", "SECTION", "2", "ENTITIES",
    ])

    # 房间边框
    lines.extend([
        "0", "LWPOLYLINE", "8", "0", "90", "4", "70", "1", "43", "0.0",
        "10", "0.0", "20", "0.0",
        "10", str(float(room_width)), "20", "0.0",
        "10", str(float(room_width)), "20", str(float(room_height)),
        "10", "0.0", "20", str(float(room_height)),
    ])

    # 瓷砖
    for tile in tiles:
        x, y = float(tile.get("x", 0)), float(tile.get("y", 0))
        w, h = float(tile.get("width", 0)), float(tile.get("height", 0))
        layer = "CUT_TILES" if tile.get("is_cut") else "TILES"
        lines.extend([
            "0", "LWPOLYLINE", "8", layer, "90", "4", "70", "1", "43", "0.0",
            "10", str(x), "20", str(y),
            "10", str(x + w), "20", str(y),
            "10", str(x + w), "20", str(y + h),
            "10", str(x), "20", str(y + h),
        ])

    # 障碍物
    for obs in params.get("obstacles", []):
        ox, oy = float(obs.get("x", 0)), float(obs.get("y", 0))
        ow, oh = float(obs.get("width", 0)), float(obs.get("height", 0))
        lines.extend([
            "0", "LWPOLYLINE", "8", "OBSTACLES", "90", "4", "70", "1", "43", "0.0",
            "10", str(ox), "20", str(oy),
            "10", str(ox + ow), "20", str(oy),
            "10", str(ox + ow), "20", str(oy + oh),
            "10", str(ox), "20", str(oy + oh),
        ])

    lines.extend(["0", "ENDSEC", "0", "EOF"])

    os.makedirs("output", exist_ok=True)
    dxf_file = "output/tile_layout.dxf"
    with open(dxf_file, "w", encoding="utf-8") as f:
        f.write('\n'.join(lines))
    return dxf_file


def main():
    try:
        input_data = json.load(sys.stdin)

        result_file = input_data.get("result_file", "output/layout_result.json")
        with open(result_file, "r", encoding="utf-8") as f:
            layout_data = json.load(f)

        params = input_data.get("params", {})
        dxf_file = generate_dxf(layout_data, params)

        print(json.dumps({
            "success": True,
            "stage": "export_dxf",
            "dxf_file": dxf_file,
            "message": f"DXF文件已生成: {dxf_file}"
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "stage": "export_dxf",
            "error": str(e)
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
