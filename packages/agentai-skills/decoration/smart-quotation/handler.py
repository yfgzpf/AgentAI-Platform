#!/usr/bin/env python3
"""
Smart Quotation - Skill Handler v2.0
- generate: 生成报价
- learn: 学习模板
- price: 查看/更新/重置价格库
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


def main():
    """主处理函数"""
    try:
        input_data = json.load(sys.stdin)
        mode = input_data.get("mode", "generate")

        if mode == "learn":
            template_file = input_data.get("template_file")
            if not template_file:
                print(json.dumps({
                    "success": False,
                    "error": "请提供报价表文件路径（template_file）"
                }, ensure_ascii=False))
                sys.exit(1)
            result = run_script("learn_template.py", input_data)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        elif mode == "generate":
            quantities = input_data.get("quantities", {})
            tile_layout_file = input_data.get("tile_layout_file", "")

            if not quantities and not tile_layout_file:
                print(json.dumps({
                    "success": False,
                    "error": "请提供工程量数据（quantities）或瓷砖排版结果文件（tile_layout_file）"
                }, ensure_ascii=False))
                sys.exit(1)

            result = run_script("generate_quote.py", input_data)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        elif mode == "price":
            # 价格管理
            result = run_script("update_price.py", input_data)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        else:
            print(json.dumps({
                "success": False,
                "error": f"未知模式: {mode}，请使用 learn / generate / price"
            }, ensure_ascii=False))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
