#!/usr/bin/env python3
"""
工程量计算
"""

import json
import sys
import math


def calculate_quantities(detection: dict) -> dict:
    """计算工程量"""
    
    walls = detection.get("walls", [])
    doors_windows = detection.get("doors_windows", [])
    pixel_ratio = detection.get("pixel_ratio", 10.0)
    
    # 计算房间边界
    all_x = []
    all_y = []
    for wall in walls:
        all_x.extend([wall.get("x1", 0), wall.get("x2", 0)])
        all_y.extend([wall.get("y1", 0), wall.get("y2", 0)])
    
    if not all_x or not all_y:
        return {
            "total_area": 0,
            "wall_area": 0,
            "floor_area": 0,
            "ceiling_area": 0
        }
    
    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)
    
    # 房间尺寸（像素）
    room_width_px = max_x - min_x
    room_height_px = max_y - min_y
    
    # 转换为毫米
    room_width_mm = room_width_px * pixel_ratio
    room_height_mm = room_height_px * pixel_ratio
    
    # 地面/天花板面积
    floor_area = (room_width_mm * room_height_mm) / 1000000  # m²
    
    # 墙体面积（简化计算：周长 × 层高）
    # 假设标准层高2.8米
    room_height_m = 2.8
    perimeter_mm = 2 * (room_width_mm + room_height_mm)
    wall_area = (perimeter_mm * room_height_m * 1000) / 1000000  # m²
    
    # 扣除门窗面积
    door_window_area = 0
    for dw in doors_windows:
        w_mm = dw.get("width_mm", dw.get("width", 0) * pixel_ratio)
        h_mm = dw.get("height_mm", dw.get("height", 0) * pixel_ratio)
        area = (w_mm * h_mm) / 1000000
        door_window_area += area
    
    wall_area_net = max(0, wall_area - door_window_area)
    
    # 材料估算
    materials = {
        "floor_tiles": {
            "area": round(floor_area, 2),
            "tile_size": "800x800mm",
            "estimated_pieces": math.ceil(floor_area / 0.64 * 1.05)  # 含5%损耗
        },
        "wall_tiles": {
            "area": round(wall_area_net, 2),
            "tile_size": "300x600mm",
            "estimated_pieces": math.ceil(wall_area_net / 0.18 * 1.08)  # 含8%损耗
        },
        "paint": {
            "wall_area": round(wall_area_net, 2),
            "ceiling_area": round(floor_area, 2),
            "estimated_liters": math.ceil((wall_area_net + floor_area) / 12)  # 12m²/L
        },
        "electrical": {
            "estimated_points": max(4, int(floor_area / 10))  # 每10m²一个点位
        }
    }
    
    return {
        "total_area": round(floor_area, 2),
        "wall_area_gross": round(wall_area, 2),
        "wall_area_net": round(wall_area_net, 2),
        "floor_area": round(floor_area, 2),
        "ceiling_area": round(floor_area, 2),
        "door_window_area": round(door_window_area, 2),
        "materials": materials
    }


def main():
    try:
        input_data = json.load(sys.stdin)
        detection = input_data.get("detection", {})
        
        quantities = calculate_quantities(detection)
        
        print(json.dumps({
            "success": True,
            "quantities": quantities
        }, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
