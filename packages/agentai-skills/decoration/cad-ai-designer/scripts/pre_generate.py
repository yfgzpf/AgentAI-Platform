#!/usr/bin/env python3
"""
Pre-generate: 参数解析与校验
"""

import json
import sys
import re


def parse_natural_language(prompt: str) -> dict:
    """从自然语言解析参数"""
    params = {
        "type": "cabinet",  # 默认类型
        "detected_features": []
    }
    
    # 检测类型
    if any(kw in prompt for kw in ["衣柜", "衣橱", "wardrobe"]):
        params["type"] = "wardrobe"
        params["detected_features"].append("挂衣区")
    elif any(kw in prompt for kw in ["橱柜", "厨房", "kitchen", "cabinet"]):
        params["type"] = "kitchen_cabinet"
        params["detected_features"].append("台面")
    elif any(kw in prompt for kw in ["书柜", "书架", "bookcase"]):
        params["type"] = "bookcase"
        params["detected_features"].append("层板")
    elif any(kw in prompt for kw in ["鞋柜", "shoe"]):
        params["type"] = "shoe_cabinet"
        params["detected_features"].append("斜层板")
    elif any(kw in prompt for kw in ["房间", "户型", "room", "layout"]):
        params["type"] = "room_layout"
    
    # 解析尺寸 (支持多种格式)
    # 格式1: 800x600x2000
    size_pattern = r'(\d+)\s*[xX×]\s*(\d+)\s*[xX×]\s*(\d+)'
    match = re.search(size_pattern, prompt)
    if match:
        params["width"] = int(match.group(1))
        params["depth"] = int(match.group(2))
        params["height"] = int(match.group(3))
    else:
        # 格式2: 宽800深600高2000
        w_match = re.search(r'宽[度]?\s*(\d+)', prompt)
        d_match = re.search(r'深[度]?\s*(\d+)', prompt)
        h_match = re.search(r'高[度]?\s*(\d+)', prompt)
        
        if w_match:
            params["width"] = int(w_match.group(1))
        if d_match:
            params["depth"] = int(d_match.group(1))
        if h_match:
            params["height"] = int(h_match.group(1))
    
    # 解析门数量
    door_match = re.search(r'(\d+)\s*门', prompt)
    if door_match:
        params["door_count"] = int(door_match.group(1))
    elif "双门" in prompt:
        params["door_count"] = 2
    elif "单门" in prompt:
        params["door_count"] = 1
    elif "三门" in prompt:
        params["door_count"] = 3
    elif "四门" in prompt:
        params["door_count"] = 4
    
    # 解析抽屉数量
    drawer_match = re.search(r'(\d+)\s*个?抽屉', prompt)
    if drawer_match:
        params["drawer_count"] = int(drawer_match.group(1))
    elif "抽屉" in prompt:
        params["drawer_count"] = 1
    
    # 解析层板数量
    shelf_match = re.search(r'(\d+)\s*层', prompt)
    if shelf_match:
        params["shelf_count"] = int(shelf_match.group(1))
    elif "层板" in prompt:
        params["shelf_count"] = 2  # 默认2层
    
    # 解析挂衣区
    if any(kw in prompt for kw in ["挂衣", "挂杆", "衣杆", "hanging"]):
        params["has_hanging_rod"] = True
        params["detected_features"].append("挂衣杆")
    
    # 解析材质
    if "实木" in prompt:
        params["material"] = "solid_wood"
    elif "板材" in prompt or "人造板" in prompt:
        params["material"] = "plywood"
    else:
        params["material"] = "plywood_18mm"  # 默认
    
    return params


def validate_params(params: dict) -> tuple:
    """校验参数合法性"""
    errors = []
    warnings = []
    
    # 尺寸范围检查
    for dim, name in [("width", "宽度"), ("depth", "深度"), ("height", "高度")]:
        if dim in params:
            value = params[dim]
            if value < 10:
                errors.append(f"{name}({value}mm)过小，最小10mm")
            elif value > 5000:
                errors.append(f"{name}({value}mm)过大，最大5000mm")
            elif value < 100:
                warnings.append(f"{name}({value}mm)较小，请确认")
    
    # 制造可行性检查
    if "width" in params and "depth" in params and "height" in params:
        # 检查比例
        w, d, h = params["width"], params["depth"], params["height"]
        if w / h > 3:
            warnings.append("宽高比过大，可能影响稳定性")
        if d / w > 2:
            warnings.append("深宽比过大，可能影响使用")
    
    # 门数量检查
    if "door_count" in params:
        if params["door_count"] > 6:
            errors.append("门数量过多，建议不超过6扇")
        if "width" in params:
            door_width = params["width"] / params["door_count"]
            if door_width < 300:
                warnings.append(f"单门宽度仅{door_width:.0f}mm，可能过窄")
            elif door_width > 600:
                warnings.append(f"单门宽度{door_width:.0f}mm，建议加支撑")
    
    return errors, warnings


def main():
    try:
        input_data = json.load(sys.stdin)
        prompt = input_data.get("prompt", "")
        
        # 解析参数
        params = parse_natural_language(prompt)
        
        # 合并用户传入的参数
        if "params" in input_data:
            params.update(input_data["params"])
        
        # 设置默认值
        if "width" not in params:
            params["width"] = 800
        if "depth" not in params:
            params["depth"] = 600
        if "height" not in params:
            params["height"] = 2000
        
        # 校验
        errors, warnings = validate_params(params)
        
        if errors:
            print(json.dumps({
                "success": False,
                "stage": "pre_generate",
                "errors": errors,
                "warnings": warnings,
                "params": params
            }))
            sys.exit(1)
        
        print(json.dumps({
            "success": True,
            "stage": "pre_generate",
            "params": params,
            "warnings": warnings,
            "message": f"解析完成：{params['type']}，尺寸 {params.get('width')}x{params.get('depth')}x{params.get('height')}"
        }))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "stage": "pre_generate",
            "error": str(e)
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
