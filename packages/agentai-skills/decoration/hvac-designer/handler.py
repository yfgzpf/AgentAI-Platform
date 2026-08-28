#!/usr/bin/env python3
"""
HVAC Designer - Skill Handler
暖通系统设计器 - 主处理程序
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
        
        if mode == "heating":
            # 仅地暖
            result = run_script("generate_heating.py", input_data)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            
        elif mode == "fresh_air":
            # 仅新风
            result = run_script("generate_fresh_air.py", input_data)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            
        elif mode == "load_calc":
            # 负荷计算
            result = run_script("calculate_load.py", input_data)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            
        elif mode == "full":
            # 完整方案
            heating_result = run_script("generate_heating.py", input_data)
            fresh_air_result = run_script("generate_fresh_air.py", input_data)
            load_result = run_script("calculate_load.py", input_data)
            
            output = {
                "success": True,
                "heating": heating_result,
                "fresh_air": fresh_air_result,
                "load": load_result,
                "materials": merge_materials(
                    heating_result.get("materials", {}),
                    fresh_air_result.get("materials", {})
                ),
                "message": f"暖通方案已生成！地暖{heating_result.get('pipe_length', 0)}米，新风量{fresh_air_result.get('airflow', 0)}m³/h"
            }
            print(json.dumps(output, ensure_ascii=False, indent=2))
            
        else:
            print(json.dumps({
                "success": False,
                "error": f"未知模式: {mode}，请使用 heating/fresh_air/load_calc/full"
            }))
            sys.exit(1)
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


def merge_materials(heating: dict, fresh_air: dict) -> dict:
    """合并地暖和新风的材料清单"""
    return {
        "heating": heating,
        "fresh_air": fresh_air,
        "total_estimate": sum(
            item.get("total_price", 0) 
            for item in list(heating.values()) + list(fresh_air.values())
            if isinstance(item, dict)
        )
    }


if __name__ == "__main__":
    main()
