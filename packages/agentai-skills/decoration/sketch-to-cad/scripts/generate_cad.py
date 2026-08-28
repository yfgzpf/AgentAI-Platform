#!/usr/bin/env python3
"""
生成CAD文件（DXF格式）
"""

import json
import sys
import os


def generate_dxf(detection: dict, params: dict) -> str:
    """生成DXF文件"""
    
    walls = detection.get("walls", [])
    doors_windows = detection.get("doors_windows", [])
    
    try:
        import ezdxf
        
        doc = ezdxf.new('R2010')
        msp = doc.modelspace()
        
        # 创建图层
        doc.layers.add("WALL", color=7, lineweight=50)
        doc.layers.add("DOOR", color=1, lineweight=30)
        doc.layers.add("WINDOW", color=4, lineweight=30)
        doc.layers.add("DIMENSION", color=3)
        doc.layers.add("TEXT", color=2)
        
        # 绘制墙体
        for wall in walls:
            msp.add_line(
                (wall["x1"], wall["y1"]),
                (wall["x2"], wall["y2"]),
                dxfattribs={'layer': 'WALL'}
            )
            
            # 添加尺寸标注
            length = wall.get("length_mm", wall.get("length", 0))
            mid_x = (wall["x1"] + wall["x2"]) / 2
            mid_y = (wall["y1"] + wall["y2"]) / 2
            
            msp.add_text(
                f"{length}mm",
                height=20,
                dxfattribs={'layer': 'TEXT', 'insert': (mid_x, mid_y + 30)}
            )
        
        # 绘制门窗
        for dw in doors_windows:
            x, y = dw["x"], dw["y"]
            w, h = dw["width"], dw["height"]
            dw_type = dw.get("type", "door")
            layer = "DOOR" if dw_type == "door" else "WINDOW"
            
            # 绘制矩形
            msp.add_lwpolyline(
                [(x, y), (x+w, y), (x+w, y+h), (x, y+h), (x, y)],
                close=True,
                dxfattribs={'layer': layer}
            )
            
            # 添加标注
            width_mm = dw.get("width_mm", w * 10)
            msp.add_text(
                f"{dw_type.upper()}: {width_mm}mm",
                height=15,
                dxfattribs={'layer': 'TEXT', 'insert': (x, y - 30)}
            )
        
        # 保存
        os.makedirs("output", exist_ok=True)
        dxf_file = "output/sketch_recognition.dxf"
        doc.saveas(dxf_file)
        
        return dxf_file
        
    except ImportError:
        # 使用简化DXF格式
        return generate_simple_dxf(detection)


def generate_simple_dxf(detection: dict) -> str:
    """生成简化版DXF"""
    walls = detection.get("walls", [])
    doors_windows = detection.get("doors_windows", [])
    
    lines = [
        "0", "SECTION",
        "2", "HEADER",
        "0", "ENDSEC",
        "0", "SECTION",
        "2", "TABLES",
        "0", "TABLE",
        "2", "LAYER",
        "70", "4",
        "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS",
        "0", "LAYER", "2", "WALL", "70", "0", "62", "7", "6", "CONTINUOUS",
        "0", "LAYER", "2", "DOOR", "70", "0", "62", "1", "6", "CONTINUOUS",
        "0", "LAYER", "2", "WINDOW", "70", "0", "62", "4", "6", "CONTINUOUS",
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "SECTION",
        "2", "ENTITIES",
    ]
    
    # 墙体
    for wall in walls:
        lines.extend([
            "0", "LINE",
            "8", "WALL",
            "10", str(float(wall["x1"])),
            "20", str(float(wall["y1"])),
            "11", str(float(wall["x2"])),
            "21", str(float(wall["y2"])),
        ])
    
    # 门窗
    for dw in doors_windows:
        x, y = dw["x"], dw["y"]
        w, h = dw["width"], dw["height"]
        layer = "DOOR" if dw.get("type") == "door" else "WINDOW"
        
        lines.extend([
            "0", "LWPOLYLINE",
            "8", layer,
            "90", "4",
            "70", "1",
            "10", str(float(x)),
            "20", str(float(y)),
            "10", str(float(x+w)),
            "20", str(float(y)),
            "10", str(float(x+w)),
            "20", str(float(y+h)),
            "10", str(float(x)),
            "20", str(float(y+h)),
        ])
    
    lines.extend(["0", "ENDSEC", "0", "EOF"])
    
    os.makedirs("output", exist_ok=True)
    dxf_file = "output/sketch_recognition.dxf"
    with open(dxf_file, "w", encoding="utf-8") as f:
        f.write('\n'.join(lines))
    
    return dxf_file


def generate_svg(detection: dict) -> str:
    """生成SVG预览"""
    walls = detection.get("walls", [])
    doors_windows = detection.get("doors_windows", [])
    
    # 计算边界
    all_x = []
    all_y = []
    for wall in walls:
        all_x.extend([wall["x1"], wall["x2"]])
        all_y.extend([wall["y1"], wall["y2"]])
    
    if not all_x or not all_y:
        return ""
    
    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)
    
    width = max_x - min_x + 100
    height = max_y - min_y + 100
    
    scale = 0.5  # 缩放
    
    svg = f'''<svg width="{width*scale}" height="{height*scale}" viewBox="{min_x-50} {min_y-50} {width} {height}" xmlns="http://www.w3.org/2000/svg">
  <!-- 背景 -->
  <rect x="{min_x-50}" y="{min_y-50}" width="{width}" height="{height}" fill="#FAFAFA"/>
  
  <!-- 墙体 -->
  <g stroke="#333" stroke-width="8" stroke-linecap="round">
'''
    
    for wall in walls:
        svg += f'    <line x1="{wall["x1"]}" y1="{wall["y1"]}" x2="{wall["x2"]}" y2="{wall["y2"]}"/>\n'
    
    svg += '  </g>\n  \n  <!-- 门窗 -->\n'
    
    for dw in doors_windows:
        x, y = dw["x"], dw["y"]
        w, h = dw["width"], dw["height"]
        color = "#FF6B6B" if dw.get("type") == "door" else "#4ECDC4"
        
        svg += f'  <rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{color}" stroke="#333" stroke-width="2"/>\n'
    
    svg += '</svg>'
    
    os.makedirs("output", exist_ok=True)
    svg_file = "output/sketch_recognition.svg"
    with open(svg_file, "w", encoding="utf-8") as f:
        f.write(svg)
    
    return svg_file


def generate_floor_plan(detection: dict, params: dict) -> dict:
    """生成符合数据标准的 FloorPlan 格式"""
    
    walls = detection.get("walls", [])
    doors_windows = detection.get("doors_windows", [])
    
    # 计算边界
    all_x = [w["x1"] for w in walls] + [w["x2"] for w in walls]
    all_y = [w["y1"] for w in walls] + [w["y2"] for w in walls]
    
    min_x = min(all_x) if all_x else 0
    min_y = min(all_y) if all_y else 0
    max_x = max(all_x) if all_x else 0
    max_y = max(all_y) if all_y else 0
    
    # 转换为米（假设输入为mm）
    scale_factor = 0.001
    
    # 识别房间（简化：将检测到的线段围成的区域识别为房间）
    rooms = []
    room_id = 1
    
    # 简化处理：如果检测到房间标签，使用标签
    room_labels = detection.get("room_labels", [])
    if room_labels:
        for label in room_labels:
            rooms.append({
                "id": f"r{room_id:03d}",
                "name": label.get("name", f"房间{room_id}"),
                "function": label.get("function", "unknown"),
                "x": label.get("x", 0) * scale_factor,
                "y": label.get("y", 0) * scale_factor,
                "width": label.get("width", 3) * scale_factor,
                "height": label.get("height", 3) * scale_factor,
                "area": round(label.get("width", 3) * label.get("height", 3) * scale_factor * scale_factor, 2)
            })
            room_id += 1
    else:
        # 无标签时，创建一个整体房间
        rooms.append({
            "id": "r001",
            "name": "全屋",
            "function": "unknown",
            "x": min_x * scale_factor,
            "y": min_y * scale_factor,
            "width": (max_x - min_x) * scale_factor,
            "height": (max_y - min_y) * scale_factor,
            "area": round((max_x - min_x) * (max_y - min_y) * scale_factor * scale_factor, 2)
        })
    
    # 构建标准格式
    floor_plan = {
        "version": "1.0",
        "unit": "m",
        "width": round((max_x - min_x) * scale_factor, 2),
        "height": round((max_y - min_y) * scale_factor, 2),
        "rooms": rooms,
        "walls": [{
            "start": [w["x1"] * scale_factor, w["y1"] * scale_factor],
            "end": [w["x2"] * scale_factor, w["y2"] * scale_factor],
            "thickness": 0.2,
            "type": "unknown"
        } for w in walls],
        "openings": [{
            "type": "door" if dw.get("type") == "door" else "window",
            "width": dw.get("width", 0.9) * scale_factor,
            "position": [dw.get("x", 0) * scale_factor, dw.get("y", 0) * scale_factor]
        } for dw in doors_windows]
    }
    
    return floor_plan


def main():
    try:
        input_data = json.load(sys.stdin)
        detection = input_data.get("detection_result", {})
        params = input_data.get("params", {})
        
        # 生成DXF
        dxf_file = generate_dxf(detection, params)
        
        # 生成SVG
        svg_file = generate_svg(detection)
        
        # 生成标准 FloorPlan 数据
        floor_plan = generate_floor_plan(detection, params)
        
        print(json.dumps({
            "success": True,
            "dxf_file": dxf_file,
            "svg_file": svg_file,
            "floor_plan": floor_plan,
            "message": f"CAD文件已生成，识别{len(floor_plan['rooms'])}个房间"
        }, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
