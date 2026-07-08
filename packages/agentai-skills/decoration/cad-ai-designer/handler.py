#!/usr/bin/env python3
"""
CAD AI Designer Handler
整合所有脚本的统一入口
"""

import json
import sys
import os
import subprocess
from pathlib import Path


def run_script(script_name: str, input_data: dict) -> dict:
    """运行指定脚本"""
    script_path = Path(__file__).parent / "scripts" / f"{script_name}.py"
    
    if not script_path.exists():
        return {"success": False, "error": f"Script not found: {script_path}"}
    
    try:
        result = subprocess.run(
            ["python", str(script_path)],
            input=json.dumps(input_data),
            capture_output=True,
            text=True,
            timeout=60
        )
        
        # 解析输出
        try:
            output = json.loads(result.stdout)
            return output
        except:
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout,
                "stderr": result.stderr
            }
    
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Script execution timeout"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    try:
        input_data = json.load(sys.stdin)
        
        prompt = input_data.get("prompt", "")
        params = input_data.get("params", {})
        skip_validation = input_data.get("skip_validation", False)
        
        # 阶段 1: 参数解析
        print(f"[1/4] 解析参数...", file=sys.stderr)
        pre_result = run_script("pre_generate", {
            "prompt": prompt,
            "params": params
        })
        
        if not pre_result.get("success"):
            print(json.dumps({
                "success": False,
                "stage": "pre_generate",
                "error": pre_result.get("errors", ["参数解析失败"]),
                "details": pre_result
            }))
            sys.exit(1)
        
        parsed_params = pre_result.get("params", {})
        
        # 阶段 2: 代码生成
        print(f"[2/4] 生成CAD代码...", file=sys.stderr)
        gen_result = run_script("generate", {
            "params": parsed_params
        })
        
        if not gen_result.get("success"):
            print(json.dumps({
                "success": False,
                "stage": "generate",
                "error": "代码生成失败",
                "details": gen_result
            }))
            sys.exit(1)
        
        code_file = gen_result.get("code_file", "")
        features = gen_result.get("features", {})
        
        # 阶段 3: 几何校验（可选）
        if not skip_validation:
            print(f"[3/4] 校验几何...", file=sys.stderr)
            val_result = run_script("validate", {
                "code_file": code_file
            })
            
            if not val_result.get("success"):
                print(f"警告: 几何校验发现问题: {val_result.get('issues', [])}", file=sys.stderr)
        
        # 阶段 4: 导出文件
        print(f"[4/4] 导出文件...", file=sys.stderr)
        exp_result = run_script("export", {
            "code_file": code_file,
            "formats": ["step", "json"]
        })
        
        # 构建最终输出
        output_files = {}
        if exp_result.get("success"):
            for fmt, result in exp_result.get("results", {}).items():
                if result.get("success"):
                    output_files[fmt] = result.get("file")
        
        # 生成预览链接（模拟）
        preview_url = None
        if "step" in output_files:
            preview_url = f"http://localhost:4178?file={output_files['step']}"
        
        # 构建成功响应
        response = {
            "success": True,
            "output": f"""✅ CAD设计生成成功！

📐 设计类型: {parsed_params.get('type', 'unknown')}
📏 尺寸: {parsed_params.get('width')} x {parsed_params.get('depth')} x {parsed_params.get('height')} mm

📝 生成的文件:
  - 代码: {code_file}
  - STEP: {output_files.get('step', 'N/A')}
  - 特征: {output_files.get('json', 'N/A')}

🏷️ 特征标记:
{chr(10).join([f"  - {k}: {v}" for k, v in features.items()])}

🔗 预览: {preview_url or '未生成'}

💡 后续操作:
  - 修改设计: "把高度改成2200"
  - 导出其他格式: "导出STL格式"
  - 查看代码: 打开 {code_file}
""",
            "data": {
                "type": parsed_params.get("type"),
                "params": parsed_params,
                "code_file": code_file,
                "output_files": output_files,
                "features": features,
                "preview_url": preview_url
            }
        }
        
        print(json.dumps(response))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
