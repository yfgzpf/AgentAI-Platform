#!/usr/bin/env python3
"""
新风系统设计器
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

# 新风量标准
FRESH_AIR_STANDARDS = {
    "residential": {
        "per_person": 30,        # 每人 30 m³/h
        "min_ach": 0.5,          # 最小换气次数 0.5 次/h
        "max_ach": 1.0,          # 最大换气次数 1.0 次/h
    },
    "office": {
        "per_person": 30,
        "min_ach": 1.0,
        "max_ach": 2.0,
    }
}

# 管径规格
DUCT_SPECS = {
    "75": {"diameter": 75, "max_flow": 80, "price": 15},
    "110": {"diameter": 110, "max_flow": 180, "price": 25},
    "160": {"diameter": 160, "max_flow": 500, "price": 45},
    "200": {"diameter": 200, "max_flow": 800, "price": 65},
}

# 新风主机选型
MACHINE_SPECS = [
    {"model": "XF-150", "airflow": 150, "power": 80, "noise": 28, "price": 3000},
    {"model": "XF-250", "airflow": 250, "power": 120, "noise": 30, "price": 4500},
    {"model": "XF-350", "airflow": 350, "power": 150, "noise": 32, "price": 6000},
    {"model": "XF-500", "airflow": 500, "power": 200, "noise": 35, "price": 8500},
]


def calculate_airflow(rooms: list, building_type: str = "residential") -> dict:
    """计算新风量"""
    
    standard = FRESH_AIR_STANDARDS.get(building_type, FRESH_AIR_STANDARDS["residential"])
    
    total_volume = 0
    room_details = []
    
    for room in rooms:
        room_name = room.get("name", "")
        width = room.get("width", 3)
        height = room.get("height", 3)
        ceiling_height = 2.8  # 标准层高
        
        area = width * height
        volume = area * ceiling_height
        total_volume += volume
        
        # 按换气次数计算
        air_by_ach = volume * standard["min_ach"]
        
        # 按人数计算（假设每室2人）
        occupants = 2 if "bed" in room_name or "卧" in room_name else 3
        air_by_person = occupants * standard["per_person"]
        
        # 取较大值
        room_airflow = max(air_by_ach, air_by_person)
        
        room_details.append({
            "name": room_name,
            "area": round(area, 1),
            "volume": round(volume, 1),
            "airflow": round(room_airflow, 0),
            "occupants": occupants
        })
    
    total_airflow = sum(r["airflow"] for r in room_details)
    
    # 选型
    selected_machine = None
    for m in MACHINE_SPECS:
        if m["airflow"] >= total_airflow:
            selected_machine = m
            break
    
    if not selected_machine:
        selected_machine = MACHINE_SPECS[-1]
    
    return {
        "total_airflow": total_airflow,
        "total_volume": total_volume,
        "ach": round(total_airflow / total_volume, 2),
        "room_details": room_details,
        "machine": selected_machine
    }


def generate_fresh_air_layout(rooms: list, building_type: str = "residential") -> dict:
    """生成新风管路布局"""
    
    airflow_data = calculate_airflow(rooms, building_type)
    
    # 管路设计
    main_ducts = []
    branch_ducts = []
    vents = []
    
    # 主机位置（假设在走廊或卫生间吊顶内）
    machine_x = 0
    machine_y = 0
    
    # 主管选择
    total_airflow = airflow_data["total_airflow"]
    main_duct_type = "160"
    for duct_id, spec in DUCT_SPECS.items():
        if spec["max_flow"] >= total_airflow:
            main_duct_type = duct_id
            break
    
    # 主管长度
    main_duct_length = 0
    
    # 为每个房间设计支管
    for i, room in enumerate(rooms):
        room_name = room.get("name", "")
        room_airflow = airflow_data["room_details"][i]["airflow"]
        
        # 选择支管管径
        branch_duct_type = "75"
        for duct_id, spec in DUCT_SPECS.items():
            if spec["max_flow"] >= room_airflow:
                branch_duct_type = duct_id
                break
        
        room_x = room.get("x", 0)
        room_y = room.get("y", 0)
        room_w = room.get("width", 3)
        room_h = room.get("height", 3)
        
        # 送风口位置（房间中央偏窗侧）
        supply_vent = {
            "room": room_name,
            "type": "supply",
            "x": room_x + room_w * 0.7,
            "y": room_y + room_h * 0.5,
            "diameter": int(branch_duct_type)
        }
        vents.append(supply_vent)
        
        # 排风口位置（房间另一侧）
        exhaust_vent = {
            "room": room_name,
            "type": "exhaust",
            "x": room_x + room_w * 0.3,
            "y": room_y + room_h * 0.5,
            "diameter": int(branch_duct_type)
        }
        vents.append(exhaust_vent)
        
        # 支管路径（从主管到风口）
        branch_length = abs(room_x - machine_x) + abs(room_y - machine_y) + room_w * 0.4
        branch_ducts.append({
            "room": room_name,
            "type": branch_duct_type,
            "length": round(branch_length, 1),
            "airflow": room_airflow
        })
        
        main_duct_length += abs(room_x - machine_x) + abs(room_y - machine_y) * 0.3
    
    # 材料计算
    materials = {}
    
    # 主管
    main_spec = DUCT_SPECS[main_duct_type]
    materials["main_duct"] = {
        "name": f"PE主管{main_duct_type}mm",
        "quantity": math.ceil(main_duct_length * 1.1),
        "unit": "米",
        "unit_price": main_spec["price"],
        "total_price": math.ceil(main_duct_length * 1.1) * main_spec["price"]
    }
    
    # 支管
    branch_quantities = {}
    for branch in branch_ducts:
        bt = branch["type"]
        if bt not in branch_quantities:
            branch_quantities[bt] = 0
        branch_quantities[bt] += branch["length"]
    
    for duct_id, length in branch_quantities.items():
        spec = DUCT_SPECS[duct_id]
        materials[f"branch_{duct_id}"] = {
            "name": f"PE支管{duct_id}mm",
            "quantity": math.ceil(length * 1.1),
            "unit": "米",
            "unit_price": spec["price"],
            "total_price": math.ceil(length * 1.1) * spec["price"]
        }
    
    # 风口
    materials["vents"] = {
        "name": "新风风口(含调节阀)",
        "quantity": len(vents),
        "unit": "个",
        "unit_price": 80,
        "total_price": len(vents) * 80
    }
    
    # 主机
    machine = airflow_data["machine"]
    materials["machine"] = {
        "name": f"新风主机{machine['model']}",
        "quantity": 1,
        "unit": "台",
        "unit_price": machine["price"],
        "total_price": machine["price"]
    }
    
    # 管件
    materials["fittings"] = {
        "name": "管件(弯头/三通/变径)",
        "quantity": len(branch_ducts) * 2 + 4,
        "unit": "个",
        "unit_price": 15,
        "total_price": (len(branch_ducts) * 2 + 4) * 15
    }
    
    return {
        "airflow": airflow_data["total_airflow"],
        "ach": airflow_data["ach"],
        "machine": airflow_data["machine"],
        "room_details": airflow_data["room_details"],
        "main_ducts": [{"type": main_duct_type, "length": round(main_duct_length, 1)}],
        "branch_ducts": branch_ducts,
        "vents": vents,
        "vent_count": len(vents),
        "materials": materials
    }


def export_dxf(fresh_air_data: dict, rooms: list) -> str:
    """导出DXF文件"""
    try:
        import ezdxf
        
        doc = ezdxf.new('R2010')
        msp = doc.modelspace()
        
        doc.layers.add(name='MAIN_DUCT', color=3)      # 绿色
        doc.layers.add(name='BRANCH_DUCT', color=5)    # 蓝色
        doc.layers.add(name='VENT', color=1)           # 红色
        doc.layers.add(name='ROOM', color=8)
        doc.layers.add(name='LABEL', color=7)
        
        # 绘制房间
        for room in rooms:
            x = room.get("x", 0)
            y = room.get("y", 0)
            w = room.get("width", 3)
            h = room.get("height", 3)
            points = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
            msp.add_lwpolyline(points, close=True, dxfattribs={'layer': 'ROOM'})
            msp.add_text(room.get("name", ""), dxfattribs={'layer': 'LABEL', 'height': 0.2}).set_placement((x + w/2, y + h/2))
        
        # 绘制风口
        for vent in fresh_air_data.get("vents", []):
            msp.add_circle((vent["x"], vent["y"]), 0.05, dxfattribs={'layer': 'VENT'})
            label = "S" if vent["type"] == "supply" else "E"
            msp.add_text(label, dxfattribs={'layer': 'LABEL', 'height': 0.1}).set_placement((vent["x"] + 0.07, vent["y"]))
        
        os.makedirs("output", exist_ok=True)
        output_file = "output/fresh_air_layout.dxf"
        doc.saveas(output_file)
        return output_file
        
    except ImportError:
        return generate_text_dxf(fresh_air_data, rooms)
    except Exception as e:
        print(f"DXF export error: {e}", file=sys.stderr)
        return ""


def generate_text_dxf(fresh_air_data: dict, rooms: list) -> str:
    """无ezdxf时生成简化的文本格式DXF"""
    os.makedirs("output", exist_ok=True)
    output_file = "output/fresh_air_layout.dxf"
    
    lines = ["0", "SECTION", "2", "ENTITIES"]
    
    for room in rooms:
        x = room.get("x", 0)
        y = room.get("y", 0)
        w = room.get("width", 3)
        h = room.get("height", 3)
        for x1, y1, x2, y2 in [(x, y, x+w, y), (x+w, y, x+w, y+h), (x+w, y+h, x, y+h), (x, y+h, x, y)]:
            lines.extend(["0", "LINE", "8", "ROOM", "10", str(x1), "20", str(y1), "11", str(x2), "21", str(y2)])
    
    for vent in fresh_air_data.get("vents", []):
        lines.extend(["0", "CIRCLE", "8", "VENT", "10", str(vent["x"]), "20", str(vent["y"]), "40", "0.05"])
    
    lines.extend(["0", "ENDSEC", "0", "EOF"])
    
    with open(output_file, 'w') as f:
        f.write("\n".join(lines))
    
    return output_file


def main():
    try:
        input_data = json.load(sys.stdin)
        
        rooms = input_data.get("rooms", [])
        building_type = input_data.get("building_type", "residential")
        
        if not rooms:
            floor_plan = input_data.get("floor_plan", {})
            rooms = floor_plan.get("rooms", [])
        
        if not rooms:
            print(json.dumps({
                "success": False,
                "error": "请提供房间信息（rooms）"
            }))
            sys.exit(1)
        
        # 生成新风布局
        fresh_air_data = generate_fresh_air_layout(rooms, building_type)
        
        # 导出文件
        dxf_file = export_dxf(fresh_air_data, rooms)
        
        machine = fresh_air_data["machine"]
        output = {
            "success": True,
            "airflow": fresh_air_data["airflow"],
            "ach": fresh_air_data["ach"],
            "machine": fresh_air_data["machine"],
            "room_details": fresh_air_data["room_details"],
            "main_ducts": fresh_air_data["main_ducts"],
            "branch_ducts": fresh_air_data["branch_ducts"],
            "vents": fresh_air_data["vents"],
            "vent_count": fresh_air_data["vent_count"],
            "materials": fresh_air_data["materials"],
            "dxf_file": dxf_file if dxf_file else None,
            "message": f"新风方案已生成！总风量{fresh_air_data['airflow']}m³/h，主机{machine['model']}，换气次数{fresh_air_data['ach']}次/h"
        }
        
        print(json.dumps(output, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
