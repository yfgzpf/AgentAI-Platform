#!/usr/bin/env python3
"""
导出SVG铺装图 v2.0
- 支持多边形房间
- 自适应缩放
- 更清晰的可视化标注
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


def generate_svg(layout_data: dict, params: dict) -> str:
    """生成SVG铺装图"""

    tiles = layout_data.get("tiles", [])

    # 确定 SVG 尺寸
    room_width = params.get("room_width", 5000)
    room_height = params.get("room_height", 4000)

    # 如果有多边形，用 bounds
    room_polygon = params.get("room_polygon")
    if room_polygon:
        xs = [v["x"] for v in room_polygon]
        ys = [v["y"] for v in room_polygon]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        room_width = max_x - min_x
        room_height = max_y - min_y
        poly_offset_x = min_x
        poly_offset_y = min_y
    else:
        poly_offset_x = 0
        poly_offset_y = 0

    # 自适应缩放：SVG 宽度固定 800px
    target_svg_w = 800
    scale = target_svg_w / room_width if room_width > 0 else 0.1
    svg_width = room_width * scale
    svg_height = room_height * scale

    # 颜色
    colors = {
        "full_tile": "#E0E0E0",
        "cut_tile": "#FFE0B2",
        "obstacle": "#EF5350",
        "border": "#424242",
        "text": "#333333",
        "grid": "#F5F5F5",
        "room_fill": "#FAFAFA",
    }

    parts = []

    # SVG 头
    parts.append(f'''<svg width="{svg_width:.0f}" height="{svg_height:.0f}" viewBox="{poly_offset_x - 200} {poly_offset_y - 200} {room_width + 400} {room_height + 400}" xmlns="http://www.w3.org/2000/svg" style="font-family: sans-serif;">
  <defs>
    <pattern id="grid" width="{params.get('tile_width', 800)}" height="{params.get('tile_height', 800)}" patternUnits="userSpaceOnUse">
      <rect width="{params.get('tile_width', 800)}" height="{params.get('tile_height', 800)}" fill="none" stroke="{colors['grid']}" stroke-width="1"/>
    </pattern>
  </defs>''')

    # 背景区域
    parts.append(f'  <rect x="{poly_offset_x - 200}" y="{poly_offset_y - 200}" width="{room_width + 400}" height="{room_height + 400}" fill="white"/>')

    # 房间轮廓
    if room_polygon:
        points_str = " ".join(f"{v['x']},{v['y']}" for v in room_polygon)
        parts.append(f'  <polygon points="{points_str}" fill="{colors['room_fill']}" stroke="{colors['border']}" stroke-width="15"/>')
    else:
        parts.append(f'  <rect x="0" y="0" width="{room_width}" height="{room_height}" fill="{colors['room_fill']}" stroke="{colors['border']}" stroke-width="15"/>')

    # 绘制瓷砖
    for tile in tiles:
        x = tile.get("x", 0)
        y = tile.get("y", 0)
        w = tile.get("width", 0)
        h = tile.get("height", 0)
        is_cut = tile.get("is_cut", False)
        rotation = tile.get("rotation", 0)

        fill_color = colors["cut_tile"] if is_cut else colors["full_tile"]
        stroke_dash = 'stroke-dasharray="50,30"' if is_cut else ""

        transform = ""
        if rotation:
            cx = x + w / 2
            cy = y + h / 2
            transform = f' transform="rotate({rotation},{cx},{cy})"'

        parts.append(f'  <rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill_color}" stroke="#999" stroke-width="2" {stroke_dash}{transform}/>')

    # 绘制障碍物
    obstacles = params.get("obstacles", [])
    for obs in obstacles:
        if obs.get("polygon"):
            pts = " ".join(f"{v['x']},{v['y']}" for v in obs["polygon"])
            parts.append(f'  <polygon points="{pts}" fill="{colors['obstacle']}" opacity="0.7" stroke="#B71C1C" stroke-width="5"/>')
        else:
            ox = obs.get("x", 0)
            oy = obs.get("y", 0)
            ow = obs.get("width", 0)
            oh = obs.get("height", 0)
            parts.append(f'  <rect x="{ox}" y="{oy}" width="{ow}" height="{oh}" fill="{colors['obstacle']}" opacity="0.7" stroke="#B71C1C" stroke-width="5"/>')
            # 标注障碍物
            parts.append(f'  <text x="{ox + ow/2}" y="{oy + oh/2}" text-anchor="middle" dominant-baseline="middle" font-size="{max(40, ow * 0.2)}" fill="white">障碍</text>')

    # 尺寸标注
    annotation_y = poly_offset_y - 100
    parts.append(f'  <text x="{poly_offset_x + room_width/2}" y="{annotation_y}" text-anchor="middle" font-size="80" fill="{colors['text']}">{room_width:.0f}mm</text>')
    parts.append(f'  <text x="{poly_offset_x - 120}" y="{poly_offset_y + room_height/2}" text-anchor="middle" font-size="80" fill="{colors['text']}" transform="rotate(-90, {poly_offset_x - 120}, {poly_offset_y + room_height/2})">{room_height:.0f}mm</text>')

    # 图例
    legend_y = poly_offset_y + room_height + 80
    parts.append(f'''  <g transform="translate({poly_offset_x}, {legend_y})">
    <rect x="0" y="0" width="100" height="100" fill="{colors['full_tile']}" stroke="#999" stroke-width="3"/>
    <text x="120" y="65" font-size="60" fill="{colors['text']}">整砖 ({layout_data.get("full_tiles", 0)}片)</text>
    <rect x="0" y="120" width="100" height="100" fill="{colors['cut_tile']}" stroke="#999" stroke-width="3" stroke-dasharray="15,8"/>
    <text x="120" y="185" font-size="60" fill="{colors['text']}">切割砖 ({layout_data.get("cut_tiles", 0)}片)</text>
    <rect x="0" y="240" width="100" height="100" fill="{colors['obstacle']}" opacity="0.7" stroke="#B71C1C" stroke-width="3"/>
    <text x="120" y="305" font-size="60" fill="{colors['text']}">障碍物</text>
  </g>''')

    # 汇总信息
    summary_y = legend_y + 420
    total = layout_data.get("total_pieces", 0)
    waste = layout_data.get("waste_rate", 0)
    area = layout_data.get("total_area", 0)
    parts.append(f'''  <text x="{poly_offset_x}" y="{summary_y}" font-size="70" fill="{colors['text']}" font-weight="bold">铺装汇总</text>
  <text x="{poly_offset_x}" y="{summary_y + 90}" font-size="55" fill="{colors['text']}">总片数: {total}片 | 损耗率: {waste}% | 面积: {area}m²</text>''')

    parts.append('</svg>')

    return '\n'.join(parts)


def main():
    try:
        input_data = json.load(sys.stdin)

        result_file = input_data.get("result_file", "output/layout_result.json")
        with open(result_file, "r", encoding="utf-8") as f:
            layout_data = json.load(f)

        params = input_data.get("params", {})

        svg_content = generate_svg(layout_data, params)

        os.makedirs("output", exist_ok=True)
        svg_file = "output/tile_layout.svg"
        with open(svg_file, "w", encoding="utf-8") as f:
            f.write(svg_content)

        print(json.dumps({
            "success": True,
            "stage": "export_svg",
            "svg_file": svg_file,
            "svg_content": svg_content,
            "message": f"SVG铺装图已生成: {svg_file}"
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "stage": "export_svg",
            "error": str(e)
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
