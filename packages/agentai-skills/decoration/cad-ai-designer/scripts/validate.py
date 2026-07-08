#!/usr/bin/env python3
"""
Validate: 几何校验
"""

import json
import sys
import os


def validate_geometry(code_file: str) -> dict:
    """校验生成的几何代码"""
    issues = []
    warnings = []
    
    # 检查代码文件是否存在
    if not os.path.exists(code_file):
        return {
            "valid": False,
            "issues": [f"代码文件不存在: {code_file}"],
            "warnings": []
        }
    
    # 读取代码内容
    with open(code_file, "r", encoding="utf-8") as f:
        code = f.read()
    
    # 基础语法检查
    if "from build123d import" not in code and "from cadquery import" not in code:
        warnings.append("未检测到标准CAD库导入")
    
    # 检查关键函数
    if "export_step" not in code:
        issues.append("缺少 export_step 导出函数")
    
    # 检查特征标记
    if "@cad[" not in code and "features[" not in code:
        warnings.append("未检测到特征标记，可能不支持局部修改")
    
    # 检查输出文件
    if os.path.exists("output.step"):
        file_size = os.path.getsize("output.step")
        if file_size < 100:
            issues.append(f"输出文件过小 ({file_size} bytes)，可能生成失败")
        elif file_size > 100 * 1024 * 1024:  # 100MB
            warnings.append(f"输出文件过大 ({file_size/1024/1024:.1f} MB)")
    else:
        warnings.append("未找到输出文件 output.step")
    
    # 检查特征文件
    if os.path.exists("features.json"):
        try:
            with open("features.json", "r") as f:
                features = json.load(f)
            if len(features) == 0:
                warnings.append("特征列表为空")
        except:
            issues.append("features.json 解析失败")
    
    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "warnings": warnings
    }


def main():
    try:
        input_data = json.load(sys.stdin)
        code_file = input_data.get("code_file", "")
        
        if not code_file:
            print(json.dumps({
                "success": False,
                "stage": "validate",
                "error": "缺少 code_file 参数"
            }))
            sys.exit(1)
        
        result = validate_geometry(code_file)
        
        print(json.dumps({
            "success": result["valid"],
            "stage": "validate",
            "valid": result["valid"],
            "issues": result["issues"],
            "warnings": result["warnings"],
            "message": "校验通过" if result["valid"] else f"发现 {len(result['issues'])} 个问题"
        }))
        
        if not result["valid"]:
            sys.exit(1)
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "stage": "validate",
            "error": str(e)
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
