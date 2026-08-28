#!/usr/bin/env python3
"""
水电材料计算器
根据房间数量和面积快速计算水电材料用量
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


def calculate_plumbing_materials(rooms: list) -> dict:
    """计算给排水材料"""
    
    # 基础用量
    base_ppr_20 = 10  # 热水管基础量
    base_ppr_25 = 15  # 冷水管基础量
    base_pvc_50 = 8   # 排水管基础量
    base_pvc_110 = 5  # 主排水管基础量
    
    # 按房间类型增加
    for room in rooms:
        func = room.get("function", "")
        area = room.get("width", 3) * room.get("height", 3)
        
        if "kitchen" in func.lower() or "厨" in func:
            base_ppr_20 += 8
            base_ppr_25 += 10
            base_pvc_50 += 5
        elif "bathroom" in func.lower() or "卫" in func:
            base_ppr_20 += 12
            base_ppr_25 += 8
            base_pvc_50 += 8
            base_pvc_110 += 3
        elif "balcony" in func.lower() or "阳台" in func:
            base_ppr_25 += 5
            base_pvc_50 += 3
    
    # 添加损耗
    ppr_20 = math.ceil(base_ppr_20 * 1.05)
    ppr_25 = math.ceil(base_ppr_25 * 1.05)
    pvc_50 = math.ceil(base_pvc_50 * 1.05)
    pvc_110 = math.ceil(base_pvc_110 * 1.05)
    
    return {
        "ppr_20": {"name": "PPR20mm热水管", "quantity": ppr_20, "unit": "米", "unit_price": 8, "total_price": ppr_20 * 8},
        "ppr_25": {"name": "PPR25mm冷水管", "quantity": ppr_25, "unit": "米", "unit_price": 12, "total_price": ppr_25 * 12},
        "pvc_50": {"name": "PVC50mm排水管", "quantity": pvc_50, "unit": "米", "unit_price": 15, "total_price": pvc_50 * 15},
        "pvc_110": {"name": "PVC110mm主排水管", "quantity": pvc_110, "unit": "米", "unit_price": 35, "total_price": pvc_110 * 35},
    }


def calculate_electrical_materials(rooms: list) -> dict:
    """计算电路材料"""
    
    # 基础用量
    bv_2_5 = 50  # 2.5平方线基础量
    bv_4_0 = 20  # 4平方线基础量
    bv_6_0 = 10  # 6平方线基础量
    pvc_16 = 40  # 16穿线管基础量
    pvc_20 = 15  # 20穿线管基础量
    
    # 按房间类型增加
    for room in rooms:
        func = room.get("function", "")
        area = room.get("width", 3) * room.get("height", 3)
        
        if "kitchen" in func.lower() or "厨" in func:
            bv_4_0 += 20
            pvc_20 += 10
        elif "bathroom" in func.lower() or "卫" in func:
            bv_4_0 += 15
            pvc_20 += 8
        elif "living" in func.lower() or "客厅" in func or "餐厅" in func:
            bv_2_5 += 30
            pvc_16 += 20
        elif "bed" in func.lower() or "卧室" in func:
            bv_2_5 += 25
            pvc_16 += 15
            bv_4_0 += 10  # 空调
            pvc_20 += 5
    
    # 添加损耗
    bv_2_5 = math.ceil(bv_2_5 * 1.05)
    bv_4_0 = math.ceil(bv_4_0 * 1.05)
    bv_6_0 = math.ceil(bv_6_0 * 1.05)
    pvc_16 = math.ceil(pvc_16 * 1.05)
    pvc_20 = math.ceil(pvc_20 * 1.05)
    
    return {
        "bv_2.5": {"name": "BV2.5mm²铜芯线", "quantity": bv_2_5, "unit": "米", "unit_price": 2.5, "total_price": bv_2_5 * 2.5},
        "bv_4.0": {"name": "BV4.0mm²铜芯线", "quantity": bv_4_0, "unit": "米", "unit_price": 4.0, "total_price": bv_4_0 * 4.0},
        "bv_6.0": {"name": "BV6.0mm²铜芯线", "quantity": bv_6_0, "unit": "米", "unit_price": 6.0, "total_price": bv_6_0 * 6.0},
        "pvc_16": {"name": "PVC16mm穿线管", "quantity": pvc_16, "unit": "米", "unit_price": 3.5, "total_price": pvc_16 * 3.5},
        "pvc_20": {"name": "PVC20mm穿线管", "quantity": pvc_20, "unit": "米", "unit_price": 5.0, "total_price": pvc_20 * 5.0},
    }


def main():
    try:
        input_data = json.load(sys.stdin)
        
        rooms = input_data.get("rooms", [])
        
        if not rooms:
            floor_plan = input_data.get("floor_plan", {})
            rooms = floor_plan.get("rooms", [])
        
        if not rooms:
            print(json.dumps({
                "success": False,
                "error": "请提供房间信息（rooms）"
            }))
            sys.exit(1)
        
        # 计算材料
        plumbing = calculate_plumbing_materials(rooms)
        electrical = calculate_electrical_materials(rooms)
        
        # 计算总价
        plumbing_total = sum(item["total_price"] for item in plumbing.values())
        electrical_total = sum(item["total_price"] for item in electrical.values())
        
        output = {
            "success": True,
            "plumbing": plumbing,
            "electrical": electrical,
            "plumbing_total": plumbing_total,
            "electrical_total": electrical_total,
            "grand_total": plumbing_total + electrical_total,
            "message": f"材料清单已生成！给排水材料约¥{plumbing_total}，电路材料约¥{electrical_total}，合计¥{plumbing_total + electrical_total}"
        }
        
        print(json.dumps(output, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
