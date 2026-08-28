#!/usr/bin/env python3
"""
暖通负荷计算器
计算采暖负荷和冷负荷
"""

import json
import sys
import math

# 修复 Windows GBK 终端编码问题
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass

# 负荷系数 (W/m²)
LOAD_FACTORS = {
    "heating": {
        "严寒": {"envelope": 80, "infiltration": 20, "total": 120},
        "寒冷": {"envelope": 60, "infiltration": 15, "total": 100},
        "夏热冬冷": {"envelope": 50, "infiltration": 10, "total": 80},
        "夏热冬暖": {"envelope": 40, "infiltration": 5, "total": 60},
        "温和": {"envelope": 45, "infiltration": 8, "total": 70},
    },
    "cooling": {
        "envelope": 120,      # 围护结构
        "occupant": 100,      # 人员
        "equipment": 50,      # 设备
        "lighting": 30,       # 照明
        "fresh_air": 40,      # 新风
    }
}

# 气候区室外计算温度
OUTDOOR_TEMPS = {
    "严寒": {"heating": -20, "cooling": 30},
    "寒冷": {"heating": -10, "cooling": 32},
    "夏热冬冷": {"heating": 0, "cooling": 35},
    "夏热冬暖": {"heating": 10, "cooling": 33},
    "温和": {"heating": -5, "cooling": 28},
}


def calculate_heating_load(rooms: list, climate_zone: str = "夏热冬冷") -> dict:
    """计算采暖负荷"""
    
    factors = LOAD_FACTORS["heating"].get(climate_zone, LOAD_FACTORS["heating"]["夏热冬冷"])
    outdoor_temp = OUTDOOR_TEMPS.get(climate_zone, OUTDOOR_TEMPS["夏热冬冷"])
    
    room_loads = []
    total_area = 0
    total_load = 0
    
    for room in rooms:
        room_name = room.get("name", "")
        width = room.get("width", 3)
        height = room.get("height", 3)
        area = width * height
        total_area += area
        
        # 基本负荷
        load_per_m2 = factors["total"]
        room_load = area * load_per_m2
        
        # 按房间类型调整
        if "卫生间" in room_name or "bath" in room_name.lower():
            room_load *= 1.2  # 卫生间热损失大
        elif "阳台" in room_name or "balcony" in room_name.lower():
            room_load *= 1.3  # 阳台保温差
        
        room_loads.append({
            "name": room_name,
            "area": round(area, 1),
            "load": round(room_load, 0),
            "load_per_m2": round(room_load / area, 0)
        })
        
        total_load += room_load
    
    return {
        "climate_zone": climate_zone,
        "outdoor_temp": outdoor_temp["heating"],
        "indoor_temp": 20,
        "total_area": round(total_area, 1),
        "total_load": round(total_load, 0),
        "load_per_m2": round(total_load / total_area, 0) if total_area > 0 else 0,
        "room_loads": room_loads,
        "factors": factors
    }


def calculate_cooling_load(rooms: list, climate_zone: str = "夏热冬冷") -> dict:
    """计算冷负荷"""
    
    outdoor_temp = OUTDOOR_TEMPS.get(climate_zone, OUTDOOR_TEMPS["夏热冬冷"])
    
    room_loads = []
    total_area = 0
    total_load = 0
    
    for room in rooms:
        room_name = room.get("name", "")
        width = room.get("width", 3)
        height = room.get("height", 3)
        area = width * height
        total_area += area
        
        # 围护结构负荷
        envelope_load = area * LOAD_FACTORS["cooling"]["envelope"]
        
        # 人员负荷（假设每室2-3人）
        occupants = 3 if "living" in room_name or "客厅" in room_name else 2
        occupant_load = occupants * LOAD_FACTORS["cooling"]["occupant"]
        
        # 设备负荷
        equipment_load = area * LOAD_FACTORS["cooling"]["equipment"]
        
        # 照明负荷
        lighting_load = area * LOAD_FACTORS["cooling"]["lighting"]
        
        # 新风负荷
        fresh_air_load = area * LOAD_FACTORS["cooling"]["fresh_air"]
        
        room_load = envelope_load + occupant_load + equipment_load + lighting_load + fresh_air_load
        
        room_loads.append({
            "name": room_name,
            "area": round(area, 1),
            "envelope": round(envelope_load, 0),
            "occupant": round(occupant_load, 0),
            "equipment": round(equipment_load, 0),
            "lighting": round(lighting_load, 0),
            "fresh_air": round(fresh_air_load, 0),
            "total": round(room_load, 0),
            "load_per_m2": round(room_load / area, 0)
        })
        
        total_load += room_load
    
    return {
        "climate_zone": climate_zone,
        "outdoor_temp": outdoor_temp["cooling"],
        "indoor_temp": 26,
        "total_area": round(total_area, 1),
        "total_load": round(total_load, 0),
        "load_per_m2": round(total_load / total_area, 0) if total_area > 0 else 0,
        "room_loads": room_loads
    }


def main():
    try:
        input_data = json.load(sys.stdin)
        
        rooms = input_data.get("rooms", [])
        climate_zone = input_data.get("climate_zone", "夏热冬冷")
        
        if not rooms:
            floor_plan = input_data.get("floor_plan", {})
            rooms = floor_plan.get("rooms", [])
        
        if not rooms:
            print(json.dumps({
                "success": False,
                "error": "请提供房间信息（rooms）"
            }))
            sys.exit(1)
        
        # 计算负荷
        heating_load = calculate_heating_load(rooms, climate_zone)
        cooling_load = calculate_cooling_load(rooms, climate_zone)
        
        output = {
            "success": True,
            "climate_zone": climate_zone,
            "heating": heating_load,
            "cooling": cooling_load,
            "message": f"负荷计算完成！采暖负荷{heating_load['total_load']}W（{heating_load['load_per_m2']}W/m²），冷负荷{cooling_load['total_load']}W（{cooling_load['load_per_m2']}W/m²）"
        }
        
        print(json.dumps(output, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
