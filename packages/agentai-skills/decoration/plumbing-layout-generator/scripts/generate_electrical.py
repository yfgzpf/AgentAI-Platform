#!/usr/bin/env python3
"""
电路布线图生成器
根据房间平面图生成强电回路、弱电布线、插座开关点位图
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

# 回路类型定义
CIRCUIT_TYPES = {
    "lighting": {
        "name": "照明回路",
        "wire": "bv_2.5",
        "breaker": "16A",
        "color": "yellow",
        "max_points": 25  # 最多灯数
    },
    "socket_living": {
        "name": "客餐厅插座",
        "wire": "bv_2.5",
        "breaker": "20A",
        "color": "orange",
        "max_points": 10
    },
    "socket_bedroom": {
        "name": "卧室插座",
        "wire": "bv_2.5",
        "breaker": "16A",
        "color": "orange",
        "max_points": 8
    },
    "kitchen": {
        "name": "厨房回路",
        "wire": "bv_4.0",
        "breaker": "25A",
        "color": "red",
        "max_points": 6
    },
    "bathroom": {
        "name": "卫生间回路",
        "wire": "bv_4.0",
        "breaker": "25A",
        "color": "red",
        "max_points": 6
    },
    "aircon": {
        "name": "空调回路",
        "wire": "bv_4.0",
        "breaker": "25A",
        "color": "blue",
        "max_points": 2
    },
    "aircon_main": {
        "name": "中央空调回路",
        "wire": "bv_6.0",
        "breaker": "32A",
        "color": "blue",
        "max_points": 1
    },
}

# 弱电类型
WEAK_CURRENT_TYPES = {
    "network": {"name": "网线", "cable": "CAT6", "color": "purple"},
    "tv": {"name": "电视线", "cable": "SYV-75-5", "color": "cyan"},
    "phone": {"name": "电话线", "cable": "RVV2x0.5", "color": "green"},
}

# 插座标准配置
SOCKET_CONFIG = {
    "living_room": [
        {"type": "socket_5", "name": "五孔插座", "count": 6, "height": 300},
        {"type": "socket_tv", "name": "电视插座", "count": 1, "height": 300},
        {"type": "socket_network", "name": "网线插座", "count": 1, "height": 300},
        {"type": "socket_ac", "name": "空调插座", "count": 1, "height": 1800},
        {"type": "switch", "name": "开关", "count": 2, "height": 1300},
    ],
    "bedroom": [
        {"type": "socket_5", "name": "五孔插座", "count": 4, "height": 300},
        {"type": "socket_bedside", "name": "床头插座", "count": 2, "height": 700},
        {"type": "socket_network", "name": "网线插座", "count": 1, "height": 300},
        {"type": "socket_ac", "name": "空调插座", "count": 1, "height": 1800},
        {"type": "switch", "name": "开关", "count": 1, "height": 1300},
    ],
    "kitchen": [
        {"type": "socket_5", "name": "五孔插座", "count": 4, "height": 1100},
        {"type": "socket_16a", "name": "16A插座", "count": 2, "height": 1100},
        {"type": "switch", "name": "开关", "count": 1, "height": 1300},
    ],
    "bathroom": [
        {"type": "socket_16a", "name": "16A防溅插座", "count": 2, "height": 1300},
        {"type": "switch", "name": "开关", "count": 2, "height": 1300},
    ],
}

# 电线规格
WIRE_SPECS = {
    "bv_2.5": {"name": "BV2.5mm²铜芯线", "price": 2.5},
    "bv_4.0": {"name": "BV4.0mm²铜芯线", "price": 4.0},
    "bv_6.0": {"name": "BV6.0mm²铜芯线", "price": 6.0},
}

# 穿线管规格
CONDUIT_SPECS = {
    "pvc_16": {"name": "PVC16mm穿线管", "price": 3.5},
    "pvc_20": {"name": "PVC20mm穿线管", "price": 5.0},
}


def generate_electrical(rooms: list, socket_points: list = None) -> dict:
    """生成电路布线方案"""
    
    circuits = []
    weak_currents = []
    socket_list = []
    
    # 材料计算
    wire_lengths = {"bv_2.5": 0, "bv_4.0": 0, "bv_6.0": 0}
    conduit_lengths = {"pvc_16": 0, "pvc_20": 0}
    
    # 配电箱位置
    panel_x = 0
    panel_y = 0
    
    for room in rooms:
        room_name = room.get("name", "")
        room_func = room.get("function", "")
        width = room.get("width", 3)
        height = room.get("height", 3)
        x = room.get("x", 0)
        y = room.get("y", 0)
        
        # 确定房间类型
        room_type = None
        if "客厅" in room_name or "餐厅" in room_name or "living" in room_func.lower():
            room_type = "living_room"
        elif "卧室" in room_name or "bed" in room_func.lower():
            room_type = "bedroom"
        elif "厨" in room_name or "kitchen" in room_func.lower():
            room_type = "kitchen"
        elif "卫" in room_name or "bath" in room_func.lower():
            room_type = "bathroom"
        
        if not room_type:
            continue
        
        # 生成插座点位
        if socket_points:
            for sp in socket_points:
                if sp.get("room") == room_name:
                    socket_list.append({
                        "room": room_name,
                        "type": sp.get("type", "socket_5"),
                        "name": sp.get("name", "插座"),
                        "x": sp.get("x", x + width / 2),
                        "y": sp.get("y", y + height / 2),
                        "height": sp.get("height", 300),
                        "circuit": sp.get("circuit", "")
                    })
        else:
            config = SOCKET_CONFIG.get(room_type, [])
            for i, sc in enumerate(config):
                for j in range(sc.get("count", 1)):
                    px = x + 0.3 + j * 0.8
                    py = y + 0.3 + i * 0.5
                    if px > x + width - 0.3:
                        px = x + width - 0.3
                    
                    socket_list.append({
                        "room": room_name,
                        "type": sc["type"],
                        "name": sc["name"],
                        "x": px,
                        "y": py,
                        "height": sc["height"],
                        "circuit": ""
                    })
    
    # 分配回路
    # 按房间功能分组
    room_groups = {}
    for socket in socket_list:
        room_name = socket["room"]
        if room_name not in room_groups:
            room_groups[room_name] = []
        room_groups[room_name].append(socket)
    
    circuit_id = 1
    
    for room_name, sockets in room_groups.items():
        # 判断房间类型
        room_type = None
        for r in rooms:
            if r.get("name") == room_name:
                func = r.get("function", "") + room_name
                if "客厅" in func or "餐厅" in func:
                    room_type = "living_room"
                elif "卧室" in func:
                    room_type = "bedroom"
                elif "厨" in func:
                    room_type = "kitchen"
                elif "卫" in func:
                    room_type = "bathroom"
                break
        
        # 确定回路类型
        if room_type == "kitchen":
            circuit_type = "kitchen"
        elif room_type == "bathroom":
            circuit_type = "bathroom"
        elif room_type == "living_room":
            circuit_type = "socket_living"
        else:
            circuit_type = "socket_bedroom"
        
        # 创建插座回路
        circuit_config = CIRCUIT_TYPES.get(circuit_type, CIRCUIT_TYPES["socket_living"])
        
        circuit = {
            "id": f"C{circuit_id:02d}",
            "type": circuit_type,
            "name": circuit_config["name"],
            "wire": circuit_config["wire"],
            "breaker": circuit_config["breaker"],
            "points": sockets,
            "point_count": len(sockets)
        }
        circuits.append(circuit)
        
        # 计算电线长度
        room_obj = next((r for r in rooms if r.get("name") == room_name), {})
        rx = room_obj.get("x", 0)
        ry = room_obj.get("y", 0)
        
        for socket in sockets:
            wire_len = abs(socket["x"] - panel_x) + abs(socket["y"] - panel_y) + 0.5
            wire_lengths[circuit_config["wire"]] += wire_len
            conduit_lengths["pvc_16"] += wire_len * 0.3
        
        circuit_id += 1
    
    # 添加照明回路（每层一个）
    lighting_circuit = {
        "id": f"C{circuit_id:02d}",
        "type": "lighting",
        "name": "照明回路",
        "wire": "bv_2.5",
        "breaker": "16A",
        "points": [],
        "point_count": len(rooms)
    }
    circuits.append(lighting_circuit)
    
    # 照明电线
    for room in rooms:
        rx = room.get("x", 0)
        ry = room.get("y", 0)
        wire_len = abs(rx - panel_x) + abs(ry - panel_y) + 1
        wire_lengths["bv_2.5"] += wire_len
        conduit_lengths["pvc_16"] += wire_len * 0.3
    
    circuit_id += 1
    
    # 空调回路
    for room in rooms:
        room_name = room.get("name", "")
        if "客厅" in room_name or "卧室" in room_name:
            circuit = {
                "id": f"C{circuit_id:02d}",
                "type": "aircon",
                "name": f"{room_name}空调回路",
                "wire": "bv_4.0",
                "breaker": "25A",
                "points": [{
                    "room": room_name,
                    "type": "socket_ac",
                    "name": "空调插座",
                    "x": room.get("x", 0) + room.get("width", 3) - 0.3,
                    "y": room.get("y", 0) + 0.5,
                    "height": 1800
                }],
                "point_count": 1
            }
            circuits.append(circuit)
            wire_len = abs(room.get("x", 0) - panel_x) + abs(room.get("y", 0) - panel_y) + 1
            wire_lengths["bv_4.0"] += wire_len
            conduit_lengths["pvc_20"] += wire_len * 0.3
            circuit_id += 1
    
    # 弱电布线
    weak_id = 1
    for room in rooms:
        room_name = room.get("name", "")
        if "客厅" in room_name or "卧室" in room_name:
            # 网线
            weak_currents.append({
                "id": f"W{weak_id:02d}",
                "type": "network",
                "name": f"{room_name}网线",
                "cable": "CAT6",
                "from": {"x": panel_x, "y": panel_y},
                "to": {"x": room.get("x", 0) + 0.3, "y": room.get("y", 0) + 0.3}
            })
            weak_id += 1
            
            if "客厅" in room_name:
                # 电视线
                weak_currents.append({
                    "id": f"W{weak_id:02d}",
                    "type": "tv",
                    "name": f"{room_name}电视线",
                    "cable": "SYV-75-5",
                    "from": {"x": panel_x, "y": panel_y},
                    "to": {"x": room.get("x", 0) + 0.3, "y": room.get("y", 0) + 0.3}
                })
                weak_id += 1
    
    # 添加5%损耗
    for key in wire_lengths:
        wire_lengths[key] = math.ceil(wire_lengths[key] * 1.05)
    for key in conduit_lengths:
        conduit_lengths[key] = math.ceil(conduit_lengths[key] * 1.05)
    
    # 生成材料清单
    materials = {
        "wires": {},
        "conduits": {},
        "accessories": {
            "sockets": len(socket_list),
            "switches": sum(1 for s in socket_list if "switch" in s.get("type", "")),
            "junction_boxes": len(socket_list) + len(rooms),
            "breakers": len(circuits),
            "leakage_protectors": 2  # 卫生间+厨房
        }
    }
    
    for wire_id, length in wire_lengths.items():
        if length > 0:
            spec = WIRE_SPECS.get(wire_id, {})
            materials["wires"][wire_id] = {
                "name": spec.get("name", wire_id),
                "quantity": length,
                "unit": "米",
                "unit_price": spec.get("price", 0),
                "total_price": length * spec.get("price", 0)
            }
    
    for conduit_id, length in conduit_lengths.items():
        if length > 0:
            spec = CONDUIT_SPECS.get(conduit_id, {})
            materials["conduits"][conduit_id] = {
                "name": spec.get("name", conduit_id),
                "quantity": length,
                "unit": "米",
                "unit_price": spec.get("price", 0),
                "total_price": length * spec.get("price", 0)
            }
    
    total_wire_length = sum(wire_lengths.values())
    
    return {
        "circuits": circuits,
        "weak_currents": weak_currents,
        "sockets": socket_list,
        "wire_length": total_wire_length,
        "materials": materials,
        "circuit_count": len(circuits),
        "socket_count": len(socket_list),
        "weak_count": len(weak_currents)
    }


def export_svg(electrical_data: dict, rooms: list) -> str:
    """导出SVG预览图"""
    try:
        import svgwrite
        
        max_x = max(r.get("x", 0) + r.get("width", 3) for r in rooms) + 2
        max_y = max(r.get("y", 0) + r.get("height", 3) for r in rooms) + 2
        scale = 100
        
        dwg = svgwrite.Drawing('electrical.svg', size=(max_x * scale, max_y * scale))
        
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
        
        # 绘制强电线路（黄色）
        for circuit in electrical_data.get("circuits", []):
            for point in circuit.get("points", []):
                px = point["x"] * scale
                py = point["y"] * scale
                
                color = svgwrite.rgb(255, 200, 0)
                if circuit["type"] == "kitchen":
                    color = svgwrite.rgb(255, 50, 50)
                elif circuit["type"] == "bathroom":
                    color = svgwrite.rgb(255, 50, 50)
                elif circuit["type"] == "aircon":
                    color = svgwrite.rgb(50, 50, 255)
                
                dwg.add(dwg.circle((px, py), 4, fill=color, stroke='black', stroke_width=1))
                dwg.add(dwg.text(
                    circuit["id"],
                    (px + 6, py - 5),
                    font_size=8,
                    fill=color
                ))
        
        # 绘制弱电线路（紫色）
        for wc in electrical_data.get("weak_currents", []):
            x1 = wc["from"]["x"] * scale
            y1 = wc["from"]["y"] * scale
            x2 = wc["to"]["x"] * scale
            y2 = wc["to"]["y"] * scale
            
            color = svgwrite.rgb(150, 0, 255)
            if wc["type"] == "tv":
                color = svgwrite.rgb(0, 200, 200)
            
            dwg.add(dwg.line((x1, y1), (x2, y2), stroke=color, stroke_width=2, stroke_dasharray="5,3"))
        
        # 图例
        legend_y = 10
        legends = [
            ("强电-插座", svgwrite.rgb(255, 200, 0)),
            ("强电-厨房/卫生间", svgwrite.rgb(255, 50, 50)),
            ("强电-空调", svgwrite.rgb(50, 50, 255)),
            ("弱电-网线", svgwrite.rgb(150, 0, 255)),
            ("弱电-电视", svgwrite.rgb(0, 200, 200))
        ]
        for label, color in legends:
            dwg.add(dwg.line((10, legend_y), (30, legend_y), stroke=color, stroke_width=3))
            dwg.add(dwg.text(label, (35, legend_y + 4), font_size=10, fill=color))
            legend_y += 15
        
        os.makedirs("output", exist_ok=True)
        output_file = "output/electrical_layout.svg"
        dwg.saveas(output_file)
        return output_file
        
    except ImportError:
        return ""
    except Exception as e:
        print(f"SVG export error: {e}", file=sys.stderr)
        return ""


def export_dxf(electrical_data: dict, rooms: list) -> str:
    """导出DXF文件"""
    try:
        import ezdxf
        
        doc = ezdxf.new('R2010')
        msp = doc.modelspace()
        
        # 创建图层
        doc.layers.add(name='STRONG_POWER', color=2)   # 黄色
        doc.layers.add(name='WEAK_POWER', color=6)     # 紫色
        doc.layers.add(name='WALLS', color=8)
        doc.layers.add(name='LABELS', color=7)
        doc.layers.add(name='SOCKETS', color=5)
        
        # 绘制墙壁
        for room in rooms:
            x = room.get("x", 0)
            y = room.get("y", 0)
            w = room.get("width", 3)
            h = room.get("height", 3)
            points = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
            msp.add_lwpolyline(points, close=True, dxfattribs={'layer': 'WALLS'})
            msp.add_text(room.get("name", ""), dxfattribs={'layer': 'LABELS', 'height': 0.2}).set_placement((x + w/2, y + h/2))
        
        # 绘制强电线路
        for circuit in electrical_data.get("circuits", []):
            for point in circuit.get("points", []):
                msp.add_circle((point["x"], point["y"]), 0.05, dxfattribs={'layer': 'SOCKETS'})
                msp.add_text(
                    f"{circuit['id']}",
                    dxfattribs={'layer': 'LABELS', 'height': 0.12}
                ).set_placement((point["x"] + 0.1, point["y"] + 0.1))
        
        # 绘制弱电线路
        for wc in electrical_data.get("weak_currents", []):
            msp.add_line(
                (wc["from"]["x"], wc["from"]["y"]),
                (wc["to"]["x"], wc["to"]["y"]),
                dxfattribs={'layer': 'WEAK_POWER'}
            )
        
        os.makedirs("output", exist_ok=True)
        output_file = "output/electrical_layout.dxf"
        doc.saveas(output_file)
        return output_file
        
    except ImportError:
        return generate_text_dxf(electrical_data, rooms)
    except Exception as e:
        print(f"DXF export error: {e}", file=sys.stderr)
        return ""


def generate_text_dxf(electrical_data: dict, rooms: list) -> str:
    """无ezdxf时生成简化的文本格式DXF"""
    os.makedirs("output", exist_ok=True)
    output_file = "output/electrical_layout.dxf"
    
    lines = ["0", "SECTION", "2", "ENTITIES"]
    
    # 墙壁
    for room in rooms:
        x = room.get("x", 0)
        y = room.get("y", 0)
        w = room.get("width", 3)
        h = room.get("height", 3)
        for x1, y1, x2, y2 in [(x, y, x+w, y), (x+w, y, x+w, y+h), (x+w, y+h, x, y+h), (x, y+h, x, y)]:
            lines.extend(["0", "LINE", "8", "WALLS", "10", str(x1), "20", str(y1), "11", str(x2), "21", str(y2)])
    
    # 强电插座
    for circuit in electrical_data.get("circuits", []):
        for point in circuit.get("points", []):
            lines.extend(["0", "CIRCLE", "8", "SOCKETS", "10", str(point["x"]), "20", str(point["y"]), "40", "0.05"])
    
    # 弱电线路
    for wc in electrical_data.get("weak_currents", []):
        lines.extend(["0", "LINE", "8", "WEAK_POWER", "10", str(wc["from"]["x"]), "20", str(wc["from"]["y"]), "11", str(wc["to"]["x"]), "21", str(wc["to"]["y"])])
    
    lines.extend(["0", "ENDSEC", "0", "EOF"])
    
    with open(output_file, 'w') as f:
        f.write("\n".join(lines))
    
    return output_file


def main():
    try:
        input_data = json.load(sys.stdin)
        
        rooms = input_data.get("rooms", [])
        socket_points = input_data.get("socket_points")
        
        if not rooms:
            floor_plan = input_data.get("floor_plan", {})
            rooms = floor_plan.get("rooms", [])
        
        if not rooms:
            print(json.dumps({
                "success": False,
                "error": "请提供房间信息（rooms）"
            }))
            sys.exit(1)
        
        # 生成电路布线
        electrical_data = generate_electrical(rooms, socket_points)
        
        # 导出文件
        svg_file = export_svg(electrical_data, rooms)
        dxf_file = export_dxf(electrical_data, rooms)
        
        output = {
            "success": True,
            "circuits": electrical_data["circuits"],
            "weak_currents": electrical_data["weak_currents"],
            "sockets": electrical_data["sockets"],
            "wire_length": electrical_data["wire_length"],
            "materials": electrical_data["materials"],
            "circuit_count": electrical_data["circuit_count"],
            "socket_count": electrical_data["socket_count"],
            "svg_file": svg_file if svg_file else None,
            "dxf_file": dxf_file if dxf_file else None,
            "message": f"电路方案已生成！共{electrical_data['circuit_count']}个回路，{electrical_data['socket_count']}个点位，电线总长{electrical_data['wire_length']}米"
        }
        
        print(json.dumps(output, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
