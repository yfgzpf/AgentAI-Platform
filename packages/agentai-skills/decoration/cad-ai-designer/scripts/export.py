#!/usr/bin/env python3
"""
Export: 导出多种格式
"""

import json
import sys
import os
import shutil


def export_formats(code_file: str, formats: list) -> dict:
    """导出多种格式"""
    results = {}
    
    # 确保输出目录存在
    for fmt in formats:
        os.makedirs(f"output/{fmt}", exist_ok=True)
    
    # 复制/转换文件
    for fmt in formats:
        try:
            if fmt == "step":
                if os.path.exists("output.step"):
                    dest = f"output/step/model.step"
                    shutil.copy("output.step", dest)
                    results[fmt] = {"success": True, "file": dest}
                else:
                    results[fmt] = {"success": False, "error": "output.step not found"}
            
            elif fmt == "stl":
                # 需要转换，这里简化处理
                results[fmt] = {"success": False, "error": "STL conversion requires mesh library"}
            
            elif fmt == "dxf":
                results[fmt] = {"success": False, "error": "DXF export requires 2D projection"}
            
            elif fmt == "json":
                # 导出参数JSON
                if os.path.exists("features.json"):
                    dest = "output/json/features.json"
                    shutil.copy("features.json", dest)
                    results[fmt] = {"success": True, "file": dest}
                else:
                    results[fmt] = {"success": False, "error": "features.json not found"}
            
            else:
                results[fmt] = {"success": False, "error": f"Unsupported format: {fmt}"}
        
        except Exception as e:
            results[fmt] = {"success": False, "error": str(e)}
    
    return results


def main():
    try:
        input_data = json.load(sys.stdin)
        code_file = input_data.get("code_file", "")
        formats = input_data.get("formats", ["step", "json"])
        
        if not code_file:
            print(json.dumps({
                "success": False,
                "stage": "export",
                "error": "缺少 code_file 参数"
            }))
            sys.exit(1)
        
        results = export_formats(code_file, formats)
        
        # 检查是否有成功的导出
        success_count = sum(1 for r in results.values() if r.get("success"))
        
        print(json.dumps({
            "success": success_count > 0,
            "stage": "export",
            "results": results,
            "message": f"成功导出 {success_count}/{len(formats)} 种格式"
        }))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "stage": "export",
            "error": str(e)
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
