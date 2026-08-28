#!/usr/bin/env python3
"""
给排水管线布局生成器
根据房间平面图生成冷热水管和排水管走向图
"""

import json
import sys
import os
import math
from pathlib import Path

# 修复 Windows GBK 终端编码问题
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass

# 水位类型定义
WATER_POINTS = {
    "kitchen": [
        {"type": "cold_water", "name": "冷水入口", "height": 450},
        {"type": "hot_water", "name": "热水入口", "height": 450},
        {"type": "drain", "name": "排水口", "height": 0},
        {"type": "purifier", "name": "净水器", "height": 450},
    ],
    "bathroom": [
        {"type": "cold_water", "name": "冷水入口", "height": 1100},
        {"type": "hot_water", "name": "热水入口", "height": 1100},
        {"type": "shower_cold", "name": "淋浴冷水", "height": 1000},
        {"type": "shower_hot", "name": "淋浴热水", "height": 1000},
        {"type": "toilet", "name": "马桶进水", "height": 200},
        {"type": "drain_floor", "name": "地漏排水", "height": 0},
        {"type": "drain_toilet", "name": "马桶排水", "height": 0},
        {"type": "drain_shower", "name": "淋浴排水", "height": 0},
    ],
    "balcony": [
        {"type": "cold_water", "name": "冷水入口", "height": 1100},
        {"type": "drain_floor", "name": "地漏排水", "height": 0},
        {"type": "washing_machine", "name": "洗衣机进水", "height": 800},
        {"type": "drain_washer", "name": "洗衣机排水", "height": 0},
    ],
}

# 管材规格
PIPE_SPECS = {
    "ppr_20": {"name": "PPR20mm热水管", "outer_diameter": 20, "inner_diameter": 14.4, "price": 8},
    "ppr_25": {"name": "PPR25mm冷水管", "outer_diameter": 25, "inner_diameter": 18.6, "price": 12},
    "pvc_50": {"name": "PVC50mm排水管", "outer_diameter": 50, "inner_diameter": 42, "price": 15},
    "pvc_75": {"name": "PVC75mm排水管", "outer_diameter": 75, "inner_diameter": 65, "price": 22},
    "pvc_110": {"name": "PVC110mm主排水管", "outer_diameter": 110, "inner_diameter": 96, "price": 35},
}


def generate_plumbing(rooms: list, water_points: list = None) -> dict:
    """生成给排水管线布局"""
    
    # 水管路径
    cold_water_paths = []
    hot_water_paths = []
    drain_paths = []
    
    # 材料计算
    pipe_lengths = {"ppr_20": 0, "ppr_25": 0, "pvc_50": 0, "pvc_75": 0, "pvc_110": 0}
    
    # 水位点位
    point_list = []
    
    for room in rooms:
        room_name = room.get("name", "")
        room_func = room.get("function", "")
        width = room.get("width", 3)
        height = room.get("height", 3)
        x = room.get("x", 0)
        y = room.get("y", 0)
        
        # 根据房间功能自动生成水位
        if water_points:
            # 使用用户指定的水位
            for wp in water_points:
                if wp.get("room") == room_name:
                    point_list.append({
                        "room": room_name,
                        "type": wp.get("type", "cold_water"),
                        "x": wp.get("x", x + width / 2),
                        "y": wp.get("y", y + height / 2),
                        "height": wp.get("height", 450),
                        "label": wp.get("label", wp.get("type", ""))
                    })
        else:
            # 自动生成标准水位
            auto_points = WATER_POINTS.get(room_func, [])
            for i, wp in enumerate(auto_points):
                px = x + 0.3 if i % 2 == 0 else x + width - 0.3
                py = y + 0.3 + (i // 2) * 0.6
                point_list.append({
                    "room": room_name,
                    "type": wp["type"],
                    "x": px,
                    "y": py,
                    "height": wp["height"],
                    "label": wp["name"]
                })
    
    # 生成水管路径（从入户总阀到各用水点）
    main_valve_x = 0
    main_valve_y = 0
    
    for point in point_list:
        ptype = point["type"]
        
        if "cold" in ptype or "washing" in ptype or "toilet" in ptype:
            # 冷水管路径
            path = {
                "type": "cold_water",
                "pipe": "ppr_25",
                "points": [
                    {"x": main_valve_x, "y": main_valve_y},
                    {"x": main_valve_x, "y": point["y"]},
                    {"x": point["x"], "y": point["y"]}
                ],
                "label": f"冷水→{point['room']}-{point['label']}"
            }
            cold_water_paths.append(path)
            
            # 计算管长
            length = abs(point["y"] - main_valve_y) + abs(point["x"] - main_valve_x)
            pipe_lengths["ppr_25"] += length + 0.5  # 加余量
        
        if "hot" in ptype:
            # 热水管路径（从热水器出发）
            heater_x = main_valve_x + 1
            heater_y = main_valve_y
            
            path = {
                "type": "hot_water",
                "pipe": "ppr_20",
                "points": [
                    {"x": heater_x, "y": heater_y},
                    {"x": heater_x, "y": point["y"]},
                    {"x": point["x"], "y": point["y"]}
                ],
                "label": f"热水→{point['room']}-{point['label']}"
            }
            hot_water_paths.append(path)
            
            length = abs(point["y"] - heater_y) + abs(point["x"] - heater_x)
            pipe_lengths["ppr_20"] += length + 0.5
        
        if "drain" in ptype:
            # 排水管路径（到主排水立管）
            drain_main_x = 0
            drain_main_y = 0
            
            pipe_type = "pvc_50"
            if "toilet" in ptype:
                pipe_type = "pvc_110"
            
            path = {
                "type": "drain",
                "pipe": pipe_type,
                "points": [
                    {"x": point["x"], "y": point["y"]},
                    {"x": point["x"], "y": drain_main_y},
                    {"x": drain_main_x, "y": drain_main_y}
                ],
                "label": f"排水→{point['room']}-{point['label']}"
            }
            drain_paths.append(path)
            
            length = abs(point["y"] - drain_main_y) + abs(point["x"] - drain_main_x)
            pipe_lengths[pipe_type] += length + 0.3
    
    # 添加5%损耗
    for key in pipe_lengths:
        pipe_lengths[key] = math.ceil(pipe_lengths[key] * 1.05)
    
    # 生成材料清单
    materials = {
        "pipes": {},
        "accessories": {
            "water_outlets": len(point_list),
            "valves": 3,  # 总阀+冷水阀+热水阀
            "elbows": sum(1 for p in cold_water_paths + hot_water_paths + drain_paths for _ in p["points"][1:-1]),
            "tees": max(1, len(cold_water_paths) // 3),
        }
    }
    
    for pipe_id, length in pipe_lengths.items():
        if length > 0:
            spec = PIPE_SPECS.get(pipe_id, {})
            materials["pipes"][pipe_id] = {
                "name": spec.get("name", pipe_id),
                "quantity": length,
                "unit": "米",
                "unit_price": spec.get("price", 0),
                "total_price": length * spec.get("price", 0)
            }
    
    total_pipe_length = sum(pipe_lengths.values())
    
    return {
        "water_points": point_list,
        "cold_water_paths": cold_water_paths,
        "hot_water_paths": hot_water_paths,
        "drain_paths": drain_paths,
        "pipe_length": total_pipe_length,
        "materials": materials,
        "point_count": len(point_list),
        "path_count": len(cold_water_paths) + len(hot_water_paths) + len(drain_paths)
    }


def export_svg(plumbing_data: dict, rooms: list) -> str:
    """导出SVG预览图"""
    try:
        import svgwrite
        
        # 计算画布大小
        max_x = max(r.get("x", 0) + r.get("width", 3) for r in rooms) + 2
        max_y = max(r.get("y", 0) + r.get("height", 3) for r in rooms) + 2
        scale = 100  # 1m = 100px
        
        dwg = svgwrite.Drawing('plumbing.svg', size=(max_x * scale, max_y * scale))
        
        # 绘制房间
        for room in rooms:
            x = room.get("x", 0) * scale
            y = room.get("y", 0) * scale
            w = room.get("width", 3) * scale
            h = room.get("height", 3) * scale
            
            dwg.add(dwg.rect(
                (x, y), (w, h),
                fill='none',
                stroke=svgwrite.rgb(100, 100, 100),
                stroke_width=2
            ))
            dwg.add(dwg.text(
                room.get("name", ""),
                (x + 10, y + 20),
                font_size=12,
                fill=svgwrite.rgb(80, 80, 80)
            ))
        
        # 绘制冷水管（蓝色）
        for path in plumbing_data.get("cold_water_paths", []):
            points = [(p["x"] * scale, p["y"] * scale) for p in path["points"]]
            dwg.add(dwg.polyline(
                points,
                fill='none',
                stroke=svgwrite.rgb(0, 100, 255),
                stroke_width=3
            ))
        
        # 绘制热水管（红色）
        for path in plumbing_data.get("hot_water_paths", []):
            points = [(p["x"] * scale, p["y"] * scale) for p in path["points"]]
            dwg.add(dwg.polyline(
                points,
                fill='none',
                stroke=svgwrite.rgb(255, 0, 0),
                stroke_width=3
            ))
        
        # 绘制排水管（绿色）
        for path in plumbing_data.get("drain_paths", []):
            points = [(p["x"] * scale, p["y"] * scale) for p in path["points"]]
            dwg.add(dwg.polyline(
                points,
                fill='none',
                stroke=svgwrite.rgb(0, 200, 0),
                stroke_width=4
            ))
        
        # 绘制水位点位
        for point in plumbing_data.get("water_points", []):
            cx = point["x"] * scale
            cy = point["y"] * scale
            
            color = svgwrite.rgb(0, 100, 255)
            if "hot" in point["type"]:
                color = svgwrite.rgb(255, 0, 0)
            elif "drain" in point["type"]:
                color = svgwrite.rgb(0, 200, 0)
            
            dwg.add(dwg.circle(
                (cx, cy), 5,
                fill=color,
                stroke='black',
                stroke_width=1
            ))
            dwg.add(dwg.text(
                point.get("label", ""),
                (cx + 8, cy - 5),
                font_size=9,
                fill=color
            ))
        
        # 图例
        legend_y = 10
        legends = [
            ("冷水管", svgwrite.rgb(0, 100, 255)),
            ("热水管", svgwrite.rgb(255, 0, 0)),
            ("排水管", svgwrite.rgb(0, 200, 0))
        ]
        for label, color in legends:
            dwg.add(dwg.line((10, legend_y), (30, legend_y), stroke=color, stroke_width=3))
            dwg.add(dwg.text(label, (35, legend_y + 4), font_size=10, fill=color))
            legend_y += 15
        
        os.makedirs("output", exist_ok=True)
        output_file = "output/plumbing_layout.svg"
        dwg.saveas(output_file)
        return output_file
        
    except ImportError:
        return ""
    except Exception as e:
        print(f"SVG export error: {e}", file=sys.stderr)
        return ""


def export_dxf(plumbing_data: dict, rooms: list) -> str:
    """导出DXF文件"""
    try:
        import ezdxf
        
        doc = ezdxf.new('R2010')
        msp = doc.modelspace()
        
        # 创建图层
        doc.layers.add(name='COLD_WATER', color=5)    # 蓝色
        doc.layers.add(name='HOT_WATER', color=1)     # 红色
        doc.layers.add(name='DRAIN', color=3)         # 绿色
        doc.layers.add(name='WALLS', color=8)         # 灰色
        doc.layers.add(name='LABELS', color=7)        # 白色
        
        # 绘制房间墙壁
        for room in rooms:
            x = room.get("x", 0)
            y = room.get("y", 0)
            w = room.get("width", 3)
            h = room.get("height", 3)
            
            points = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
            msp.add_lwpolyline(points, close=True, dxfattribs={'layer': 'WALLS'})
            
            msp.add_text(
                room.get("name", ""),
                dxfattribs={'layer': 'LABELS', 'height': 0.2}
            ).set_placement((x + w/2, y + h/2))
        
        # 绘制冷水管
        for path in plumbing_data.get("cold_water_paths", []):
            pts = [(p["x"], p["y"]) for p in path["points"]]
            msp.add_lwpolyline(pts, dxfattribs={'layer': 'COLD_WATER'})
        
        # 绘制热水管
        for path in plumbing_data.get("hot_water_paths", []):
            pts = [(p["x"], p["y"]) for p in path["points"]]
            msp.add_lwpolyline(pts, dxfattribs={'layer': 'HOT_WATER'})
        
        # 绘制排水管
        for path in plumbing_data.get("drain_paths", []):
            pts = [(p["x"], p["y"]) for p in path["points"]]
            msp.add_lwpolyline(pts, dxfattribs={'layer': 'DRAIN'})
        
        # 绘制水位点位
        for point in plumbing_data.get("water_points", []):
            msp.add_circle(
                (point["x"], point["y"]),
                0.05,
                dxfattribs={'layer': 'LABELS'}
            )
            msp.add_text(
                point.get("label", ""),
                dxfattribs={'layer': 'LABELS', 'height': 0.15}
            ).set_placement((point["x"] + 0.1, point["y"] + 0.1))
        
        os.makedirs("output", exist_ok=True)
        output_file = "output/plumbing_layout.dxf"
        doc.saveas(output_file)
        return output_file
        
    except ImportError:
        # 降级: 生成纯文本DXF
        return generate_text_dxf(plumbing_data, rooms)
    except Exception as e:
        print(f"DXF export error: {e}", file=sys.stderr)
        return ""


def generate_text_dxf(plumbing_data: dict, rooms: list) -> str:
    """无ezdxf时生成简化的文本格式DXF"""
    os.makedirs("output", exist_ok=True)
    output_file = "output/plumbing_layout.dxf"
    
    lines = ["0", "SECTION", "2", "ENTITIES"]
    
    # 绘制墙壁
    for room in rooms:
        x = room.get("x", 0)
        y = room.get("y", 0)
        w = room.get("width", 3)
        h = room.get("height", 3)
        for x1, y1, x2, y2 in [(x, y, x+w, y), (x+w, y, x+w, y+h), (x+w, y+h, x, y+h), (x, y+h, x, y)]:
            lines.extend(["0", "LINE", "8", "WALLS", "10", str(x1), "20", str(y1), "11", str(x2), "21", str(y2)])
    
    # 绘制水管
    for path in plumbing_data.get("cold_water_paths", []) + plumbing_data.get("hot_water_paths", []) + plumbing_data.get("drain_paths", []):
        layer = "COLD_WATER" if path["type"] == "cold_water" else "HOT_WATER" if path["type"] == "hot_water" else "DRAIN"
        pts = path["points"]
        for i in range(len(pts) - 1):
            lines.extend(["0", "LINE", "8", layer, "10", str(pts[i]["x"]), "20", str(pts[i]["y"]), "11", str(pts[i+1]["x"]), "21", str(pts[i+1]["y"])])
    
    lines.extend(["0", "ENDSEC", "0", "EOF"])
    
    with open(output_file, 'w') as f:
        f.write("\n".join(lines))
    
    return output_file


def main():
    try:
        input_data = json.load(sys.stdin)
        
        rooms = input_data.get("rooms", [])
        water_points = input_data.get("water_points")
        
        if not rooms:
            # 从 floor_plan 构建
            floor_plan = input_data.get("floor_plan", {})
            rooms = floor_plan.get("rooms", [])
        
        if not rooms:
            print(json.dumps({
                "success": False,
                "error": "请提供房间信息（rooms）"
            }))
            sys.exit(1)
        
        # 生成管线布局
        plumbing_data = generate_plumbing(rooms, water_points)
        
        # 导出文件
        svg_file = export_svg(plumbing_data, rooms)
        dxf_file = export_dxf(plumbing_data, rooms)
        
        output = {
            "success": True,
            "water_points": plumbing_data["water_points"],
            "cold_water_paths": plumbing_data["cold_water_paths"],
            "hot_water_paths": plumbing_data["hot_water_paths"],
            "drain_paths": plumbing_data["drain_paths"],
            "pipe_length": plumbing_data["pipe_length"],
            "materials": plumbing_data["materials"],
            "point_count": plumbing_data["point_count"],
            "svg_file": svg_file if svg_file else None,
            "dxf_file": dxf_file if dxf_file else None,
            "message": f"给排水方案已生成！共{plumbing_data['point_count']}个水位，管材总长{plumbing_data['pipe_length']}米"
        }
        
        print(json.dumps(output, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
