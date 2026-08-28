#!/usr/bin/env python3
"""测试水电材料计算"""
import json
import sys
import os

# 构造测试数据
test_data = {
    "rooms": [
        {"name": "客厅", "function": "living_room", "x": 0, "y": 0, "width": 4.5, "height": 4.2},
        {"name": "主卧", "function": "bedroom", "x": 4.5, "y": 0, "width": 3.6, "height": 4.2},
        {"name": "厨房", "function": "kitchen", "x": 0, "y": 4.2, "width": 2.5, "height": 2.8},
        {"name": "卫生间", "function": "bathroom", "x": 2.5, "y": 4.2, "width": 2.0, "height": 2.8}
    ]
}

# 写到 stdin 管道
script_dir = os.path.dirname(os.path.abspath(__file__))
script_path = os.path.join(script_dir, "scripts", "calculate_materials.py")

import subprocess
result = subprocess.run(
    [sys.executable, script_path],
    input=json.dumps(test_data),
    capture_output=True,
    text=True,
    timeout=30
)

print("=== 测试材料计算 ===")
print(f"Return code: {result.returncode}")
print(f"Output: {result.stdout}")
if result.stderr:
    print(f"Stderr: {result.stderr}")

# 测试给排水生成
script_path2 = os.path.join(script_dir, "scripts", "generate_plumbing.py")
result2 = subprocess.run(
    [sys.executable, script_path2],
    input=json.dumps(test_data),
    capture_output=True,
    text=True,
    timeout=30,
    cwd=script_dir  # 设置工作目录，让 output/ 在正确位置
)

print("\n=== 测试给排水生成 ===")
print(f"Return code: {result2.returncode}")
if result2.stdout:
    try:
        data = json.loads(result2.stdout)
        print(f"Success: {data.get('success')}")
        print(f"Water points: {data.get('point_count', 0)}")
        print(f"Pipe length: {data.get('pipe_length', 0)}m")
        print(f"SVG file: {data.get('svg_file')}")
        print(f"DXF file: {data.get('dxf_file')}")
        mats = data.get("materials", {})
        print(f"Pipe types: {list(mats.get('pipes', {}).keys())}")
    except:
        print(f"Raw output: {result2.stdout[:500]}")
if result2.stderr:
    print(f"Stderr: {result2.stderr[:500]}")

# 测试电路生成
script_path3 = os.path.join(script_dir, "scripts", "generate_electrical.py")
result3 = subprocess.run(
    [sys.executable, script_path3],
    input=json.dumps(test_data),
    capture_output=True,
    text=True,
    timeout=30,
    cwd=script_dir
)

print("\n=== 测试电路生成 ===")
print(f"Return code: {result3.returncode}")
if result3.stdout:
    try:
        data = json.loads(result3.stdout)
        print(f"Success: {data.get('success')}")
        print(f"Circuits: {data.get('circuit_count', 0)}")
        print(f"Sockets: {data.get('socket_count', 0)}")
        print(f"Wire length: {data.get('wire_length', 0)}m")
        print(f"SVG file: {data.get('svg_file')}")
        print(f"DXF file: {data.get('dxf_file')}")
    except:
        print(f"Raw output: {result3.stdout[:500]}")
if result3.stderr:
    print(f"Stderr: {result3.stderr[:500]}")

print("\n=== 测试完成 ===")
