#!/usr/bin/env python3
"""
Tile Layout Generator - Skill Handler v2.0
瓷砖铺装图生成器 - 主处理程序
- 支持矩形和多边形房间
- 输出数据契约供 smart-quotation 消费
"""

import json
import sys
import os
import subprocess
from pathlib import Path

# Windows 编码修复
if sys.platform == 'win32':
    try:
        sys.stdin.reconfigure(encoding='utf-8', errors='replace')
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass


def run_script(script_name: str, input_data: dict) -> dict:
    """运行子脚本"""
    script_path = Path(__file__).parent / "scripts" / script_name

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            input=json.dumps(input_data, ensure_ascii=False),
            capture_output=True,
            timeout=60,
            encoding='utf-8',
            errors='replace'
        )

        if result.returncode == 0:
            return json.loads(result.stdout)
        else:
            return {
                "success": False,
                "error": result.stderr or "Script execution failed"
            }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Script timeout"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def parse_natural_language(prompt: str) -> dict:
    """解析自然语言描述，提取参数"""
    import re

    params = {
        "pattern": "straight",
        "grout_width": 2,
        "start_point": "center"
    }

    # 提取房间尺寸 (如: 5米x4米, 5米乘4米, 5000x4000)
    room_patterns = [
        r'(\d+(?:\.\d+)?)\s*[米m]\s*[×xX*\*乘]\s*(\d+(?:\.\d+)?)\s*[米m]',
        r'(\d+(?:\.\d+)?)\s*[×xX*\*乘]\s*(\d+(?:\.\d+)?)\s*[米m]',
    ]
    for pattern in room_patterns:
        match = re.search(pattern, prompt)
        if match:
            w, h = float(match.group(1)), float(match.group(2))
            if w < 100:
                w *= 1000
            if h < 100:
                h *= 1000
            params["room_width"] = w
            params["room_height"] = h
            break

    # 提取瓷砖规格 (如: 800x800, 600x1200)
    tile_patterns = [
        r'(\d+)\s*[×xX*\*乘]\s*(\d+)\s*(?:mm|毫米)?',
        r'(\d{3,4})[×xX*\*](\d{3,4})',
    ]
    for pattern in tile_patterns:
        match = re.search(pattern, prompt)
        if match:
            tw, th = int(match.group(1)), int(match.group(2))
            if tw >= 100 and th >= 100:
                params["tile_width"] = tw
                params["tile_height"] = th
                break

    # 识别铺装方式
    pattern_keywords = {
        "straight": ["直铺", "对齐铺", "正铺"],
        "staggered": ["工字铺", "错缝", "1/2", "half"],
        "diagonal": ["斜铺", "45度", "菱形铺"],
        "herringbone": ["人字铺", "鱼骨铺", "herringbone"],
    }
    for pattern, keywords in pattern_keywords.items():
        for kw in keywords:
            if kw in prompt:
                params["pattern"] = pattern
                break

    # 识别留缝
    grout_match = re.search(r'(\d+)\s*(?:mm|毫米)?\s*(?:缝|留缝)', prompt)
    if grout_match:
        params["grout_width"] = int(grout_match.group(1))

    # 识别单价
    price_match = re.search(r'(\d+(?:\.\d+)?)\s*元?[/每]?片', prompt)
    if price_match:
        params["price_per_piece"] = float(price_match.group(1))

    return params


def main():
    """主处理函数"""
    try:
        input_data = json.load(sys.stdin)

        prompt = input_data.get("prompt", "")
        params = input_data.get("params", {})

        # 自然语言解析
        if prompt and not params:
            params = parse_natural_language(prompt)

        # 参数校验
        has_rect = "room_width" in params and "room_height" in params
        has_poly = bool(params.get("room_polygon"))
        if not has_rect and not has_poly:
            print(json.dumps({
                "success": False,
                "error": "缺少房间尺寸参数，请提供房间宽度和长度（如：5米x4米）或 room_polygon 顶点列表"
            }, ensure_ascii=False))
            sys.exit(1)

        if "tile_width" not in params or "tile_height" not in params:
            print(json.dumps({
                "success": False,
                "error": "缺少瓷砖规格参数，请提供瓷砖尺寸（如：800x800mm）"
            }, ensure_ascii=False))
            sys.exit(1)

        # 步骤1: 生成排版
        layout_result = run_script("generate_layout.py", params)
        if not layout_result.get("success"):
            print(json.dumps(layout_result, ensure_ascii=False))
            sys.exit(1)

        result_file = layout_result.get("result_file")

        # 步骤2: 导出SVG
        svg_input = {"result_file": result_file, "params": params}
        svg_result = run_script("export_svg.py", svg_input)

        # 步骤3: 导出DXF
        dxf_input = {"result_file": result_file, "params": params}
        dxf_result = run_script("export_dxf.py", dxf_input)

        # 汇总
        layout_data = layout_result.get("result", {})

        output = {
            "success": True,
            "message": f"瓷砖铺装图生成完成！整砖{layout_data.get('full_tiles', 0)}片，切割砖{layout_data.get('cut_tiles', 0)}片",
            "params": params,
            "material_list": {
                "full_tiles": layout_data.get("full_tiles", 0),
                "cut_tiles": layout_data.get("cut_tiles", 0),
                "total_pieces": layout_data.get("total_pieces", 0),
                "waste_rate": layout_data.get("waste_rate", 0),
                "total_area": layout_data.get("total_area", 0),
                "estimated_cost": layout_data.get("estimated_cost", 0)
            },
            "tile_layout_output": layout_data.get("tile_layout_output", {}),
            "files": {
                "svg": svg_result.get("svg_file") if svg_result.get("success") else None,
                "dxf": dxf_result.get("dxf_file") if dxf_result.get("success") else None,
                "json": result_file
            },
            # SVG 内容直接内联，供前端 WidgetCard 渲染
            "widget": {
                "type": "tile_layout_svg",
                "svg": svg_result.get("svg_content", "") if svg_result.get("success") else "",
            }
        }

        print(json.dumps(output, ensure_ascii=False, indent=2))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
