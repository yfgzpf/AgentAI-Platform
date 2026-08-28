#!/usr/bin/env python3
"""
Plumbing Layout Generator - Skill Handler
水电管线布局图生成器 - 主处理程序
"""

import json
import sys
import os
import subprocess
from pathlib import Path


def run_script(script_name: str, input_data: dict) -> dict:
    """运行子脚本"""
    script_path = Path(__file__).parent / "scripts" / script_name
    
    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            input=json.dumps(input_data),
            capture_output=True,
            text=True,
            timeout=60
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


def main():
    """主处理函数"""
    try:
        # 读取输入
        input_data = json.load(sys.stdin)
        
        mode = input_data.get("mode", "full")
        
        if mode == "plumbing":
            # 仅给排水
            result = run_script("generate_plumbing.py", input_data)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            
        elif mode == "electrical":
            # 仅电路
            result = run_script("generate_electrical.py", input_data)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            
        elif mode == "full":
            # 完整方案
            plumbing_result = run_script("generate_plumbing.py", input_data)
            electrical_result = run_script("generate_electrical.py", input_data)
            
            # 合并结果
            output = {
                "success": True,
                "plumbing": plumbing_result,
                "electrical": electrical_result,
                "materials": merge_materials(
                    plumbing_result.get("materials", {}),
                    electrical_result.get("materials", {})
                ),
                "message": f"水电方案已生成！给排水管线{plumbing_result.get('pipe_length', 0)}米，电路{electrical_result.get('wire_length', 0)}米"
            }
            print(json.dumps(output, ensure_ascii=False, indent=2))
            
        elif mode == "calculate":
            # 仅计算材料
            result = run_script("calculate_materials.py", input_data)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            
        else:
            print(json.dumps({
                "success": False,
                "error": f"未知模式: {mode}，请使用 plumbing/electrical/full/calculate"
            }))
            sys.exit(1)
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


def merge_materials(plumbing: dict, electrical: dict) -> dict:
    """合并给排水和电路的材料清单"""
    merged = {
        "pipes": plumbing.get("pipes", {}),
        "wires": electrical.get("wires", {}),
        "conduits": electrical.get("conduits", {}),
        "accessories": {
            **plumbing.get("accessories", {}),
            **electrical.get("accessories", {})
        }
    }
    return merged


if __name__ == "__main__":
    main()
