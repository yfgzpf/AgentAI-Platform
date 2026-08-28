#!/usr/bin/env python3
"""
Sketch to CAD - Skill Handler
手绘图转CAD - 主处理程序
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
            timeout=120
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
        
        image_path = input_data.get("image_path")
        prompt = input_data.get("prompt", "")
        
        if not image_path:
            print(json.dumps({
                "success": False,
                "error": "请提供手绘图文件路径（image_path）"
            }))
            sys.exit(1)
        
        # 检查文件是否存在
        if not os.path.exists(image_path):
            print(json.dumps({
                "success": False,
                "error": f"文件不存在: {image_path}"
            }))
            sys.exit(1)
        
        # 步骤1: 图像预处理
        preprocess_input = {
            "image_path": image_path
        }
        preprocess_result = run_script("preprocess.py", preprocess_input)
        if not preprocess_result.get("success"):
            print(json.dumps(preprocess_result))
            sys.exit(1)
        
        processed_image = preprocess_result.get("processed_image")
        
        # 步骤2: 线条检测（墙体识别）
        # 注意：这里依赖OpenCV，如果不可用则返回模拟数据
        detection_input = {
            "image_path": processed_image,
            "params": input_data.get("params", {})
        }
        detection_result = run_script("detect_lines.py", detection_input)
        
        # 步骤3: 生成CAD
        cad_input = {
            "detection_result": detection_result.get("detection", {}),
            "params": input_data.get("params", {})
        }
        cad_result = run_script("generate_cad.py", cad_input)
        
        # 步骤4: 计算工程量
        quantity_input = {
            "detection": detection_result.get("detection", {})
        }
        quantity_result = run_script("calculate_quantity.py", quantity_input)
        
        # 汇总结果
        output = {
            "success": True,
            "message": "手绘图识别完成！",
            "recognition": detection_result.get("detection", {}),
            "files": {
                "dxf": cad_result.get("dxf_file") if cad_result.get("success") else None,
                "svg": cad_result.get("svg_file") if cad_result.get("success") else None
            },
            "quantities": quantity_result.get("quantities", {}),
            "note": "识别结果仅供参考，关键尺寸请人工核对"
        }
        
        print(json.dumps(output, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
