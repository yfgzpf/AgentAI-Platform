#!/usr/bin/env python3
"""
地暖盘管布局生成器
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

# 地暖参数
HEATING_PARAMS = {
    "water": {
        "pipe_spacing": 0.20,  # 盘管间距 200mm
        "pipe_diameter": 16,   # 管径 16mm
        "loop_max_length": 80, # 单路最大长度 80m
        "flow_rate": 0.3,      # 流量 L/min
        "insulation_thickness": 0.03,  # 保温层 30mm
    },
    "electric": {
        "power_density": 120,  # 功率密度 W/m²
        "cable_spacing": 0.15, # 电缆间距 150mm
    }
}

# 采暖负荷系数 (W/m²)
HEATING_LOAD = {
    "严寒": 120,
    "寒冷": 100,
    "夏热冬冷": 80,
    "夏热冬暖": 60,
    "温和": 70
}


def generate_heating_layout(rooms: list, heating_type: str = "water") -> dict:
    """生成地暖盘管布局"""
    
    params = HEATING_PARAMS.get(heating_type, HEATING_PARAMS["water"])
    
    loops = []
    total_pipe_length = 0
    total_area = 0
    
    for room in rooms:
        room_name = room.get("name", "")
        room_func = room.get("function", "")
        width = room.get("width", 3)
        height = room.get("height", 3)
        x = room.get("x", 0)
        y = room.get("y", 0)
        
        # 计算铺设面积（扣除家具区域约30%）
        full_area = width * height
        furniture_area = full_area * 0.3 if "bed" in room_func.lower() or "卧室" in room_name else full_area * 0.15
        heating_area = full_area - furniture_area
        total_area += heating_area
        
        # 计算盘管长度
        spacing = params["pipe_spacing"]
        # 回字形布局：周长 + 内部回路
        perimeter = 2 * (width + height)
        inner_loops = int(min(width, height) / (2 * spacing))
        pipe_length = perimeter + inner_loops * (width + height) * 2
        
        # 分路计算
        max_loop_length = params["loop_max_length"]
        num_loops = max(1, math.ceil(pipe_length / max_loop_length))
        loop_length = pipe_length / num_loops
        
        room_loops = []
        for i in range(num_loops):
            room_loops.append({
                "id": f"{room_name}_L{i+1}",
                "room": room_name,
                "length": round(loop_length, 1),
                "area": round(heating_area / num_loops, 1),
                "start_point": [x + 0.1, y + 0.1 + i * spacing * 2],
                "end_point": [x + width - 0.1, y + height - 0.1 - i * spacing * 2]
            })
        
        loops.extend(room_loops)
        total_pipe_length += pipe_length
    
    # 分集水器数量
    num_manifolds = max(1, math.ceil(len(loops) / 8))
    
    # 材料计算
    materials = {
        "pert_pipe": {
            "name": "PERT地暖管16mm",
            "quantity": math.ceil(total_pipe_length * 1.05),
            "unit": "米",
            "unit_price": 8,
            "total_price": math.ceil(total_pipe_length * 1.05) * 8
        },
        "insulation_board": {
            "name": "XPS挤塑保温板",
            "quantity": math.ceil(total_area),
            "unit": "m²",
            "unit_price": 25,
            "total_price": math.ceil(total_area) * 25
        },
        "manifold": {
            "name": f"分集水器({num_loops}路)",
            "quantity": num_manifolds,
            "unit": "套",
            "unit_price": 800,
            "total_price": num_manifolds * 800
        },
        "circulation_pump": {
            "name": "循环水泵",
            "quantity": 1,
            "unit": "台",
            "unit_price": 1200,
            "total_price": 1200
        },
        "thermostats": {
            "name": "温控器",
            "quantity": len(rooms),
            "unit": "个",
            "unit_price": 200,
            "total_price": len(rooms) * 200
        }
    }
    
    return {
        "heating_type": heating_type,
        "loops": loops,
        "loop_count": len(loops),
        "total_pipe_length": round(total_pipe_length, 1),
        "heating_area": round(total_area, 1),
        "manifold_count": num_manifolds,
        "materials": materials
    }


def export_dxf(heating_data: dict, rooms: list) -> str:
    """导出DXF文件"""
    try:
        import ezdxf
        
        doc = ezdxf.new('R2010')
        msp = doc.modelspace()
        
        # 创建图层
        doc.layers.add(name='HEATING_PIPE', color=1)  # 红色
        doc.layers.add(name='MANIFOLD', color=5)      # 蓝色
        doc.layers.add(name='ROOM', color=8)          # 灰色
        doc.layers.add(name='LABEL', color=7)         # 白色
        
        # 绘制房间
        for room in rooms:
            x = room.get("x", 0)
            y = room.get("y", 0)
            w = room.get("width", 3)
            h = room.get("height", 3)
            points = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
            msp.add_lwpolyline(points, close=True, dxfattribs={'layer': 'ROOM'})
            msp.add_text(room.get("name", ""), dxfattribs={'layer': 'LABEL', 'height': 0.2}).set_placement((x + w/2, y + h/2))
        
        # 绘制盘管（简化表示）
        for loop in heating_data.get("loops", []):
            start = loop["start_point"]
            end = loop["end_point"]
            # 绘制回路主线
            msp.add_line(start, end, dxfattribs={'layer': 'HEATING_PIPE'})
            # 添加回路标签
            mid_x = (start[0] + end[0]) / 2
            mid_y = (start[1] + end[1]) / 2
            msp.add_text(loop["id"], dxfattribs={'layer': 'LABEL', 'height': 0.12}).set_placement((mid_x, mid_y))
        
        # 绘制分集水器位置
        msp.add_circle((0.5, 0.5), 0.1, dxfattribs={'layer': 'MANIFOLD'})
        msp.add_text("分集水器", dxfattribs={'layer': 'LABEL', 'height': 0.15}).set_placement((0.7, 0.5))
        
        os.makedirs("output", exist_ok=True)
        output_file = "output/heating_layout.dxf"
        doc.saveas(output_file)
        return output_file
        
    except ImportError:
        return generate_text_dxf(heating_data, rooms)
    except Exception as e:
        print(f"DXF export error: {e}", file=sys.stderr)
        return ""


def generate_text_dxf(heating_data: dict, rooms: list) -> str:
    """无ezdxf时生成简化的文本格式DXF"""
    os.makedirs("output", exist_ok=True)
    output_file = "output/heating_layout.dxf"
    
    lines = ["0", "SECTION", "2", "ENTITIES"]
    
    # 房间
    for room in rooms:
        x = room.get("x", 0)
        y = room.get("y", 0)
        w = room.get("width", 3)
        h = room.get("height", 3)
        for x1, y1, x2, y2 in [(x, y, x+w, y), (x+w, y, x+w, y+h), (x+w, y+h, x, y+h), (x, y+h, x, y)]:
            lines.extend(["0", "LINE", "8", "ROOM", "10", str(x1), "20", str(y1), "11", str(x2), "21", str(y2)])
    
    # 盘管
    for loop in heating_data.get("loops", []):
        start = loop["start_point"]
        end = loop["end_point"]
        lines.extend(["0", "LINE", "8", "HEATING_PIPE", "10", str(start[0]), "20", str(start[1]), "11", str(end[0]), "21", str(end[1])])
    
    lines.extend(["0", "ENDSEC", "0", "EOF"])
    
    with open(output_file, 'w') as f:
        f.write("\n".join(lines))
    
    return output_file


def main():
    try:
        input_data = json.load(sys.stdin)
        
        rooms = input_data.get("rooms", [])
        heating_type = input_data.get("heating_type", "water")
        
        if not rooms:
            floor_plan = input_data.get("floor_plan", {})
            rooms = floor_plan.get("rooms", [])
        
        if not rooms:
            print(json.dumps({
                "success": False,
                "error": "请提供房间信息（rooms）"
            }))
            sys.exit(1)
        
        # 生成地暖布局
        heating_data = generate_heating_layout(rooms, heating_type)
        
        # 导出文件
        dxf_file = export_dxf(heating_data, rooms)
        
        output = {
            "success": True,
            "heating_type": heating_data["heating_type"],
            "loops": heating_data["loops"],
            "loop_count": heating_data["loop_count"],
            "total_pipe_length": heating_data["total_pipe_length"],
            "heating_area": heating_data["heating_area"],
            "manifold_count": heating_data["manifold_count"],
            "materials": heating_data["materials"],
            "dxf_file": dxf_file if dxf_file else None,
            "message": f"地暖方案已生成！共{heating_data['loop_count']}路盘管，{heating_data['total_pipe_length']}米管材，铺设面积{heating_data['heating_area']}m²"
        }
        
        print(json.dumps(output, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
