#!/usr/bin/env python3
"""
Generate: 生成CAD代码和模型
"""

import json
import sys
import os
import hashlib
from datetime import datetime


def generate_wardrobe_code(params: dict) -> str:
    """生成衣柜的build123d代码"""
    w = params.get("width", 800)
    d = params.get("depth", 600)
    h = params.get("height", 2000)
    door_count = params.get("door_count", 2)
    shelf_count = params.get("shelf_count", 3)
    drawer_count = params.get("drawer_count", 0)
    has_rod = params.get("has_hanging_rod", True)
    
    code = f'''#!/usr/bin/env python3
"""
Generated Wardrobe Design
Params: {json.dumps(params, ensure_ascii=False)}
Generated: {datetime.now().isoformat()}
"""

from build123d import *
import json

# Parameters
width = {w}
depth = {d}
height = {h}
wall_thickness = 18
door_thickness = 20
shelf_thickness = 18

# Feature registry for @cad references
features = {{}}

# === Main Body ===
# Outer shell
body_outer = Box(width, depth, height)
body_inner = Box(width - wall_thickness*2, depth - wall_thickness*2, height - wall_thickness)
body_inner = body_inner.move(Location((0, 0, wall_thickness/2)))
body = body_outer - body_inner
features["@cad[body]"] = body

# === Shelves ===
shelves = []
shelf_spacing = (height - 200) / ({shelf_count} + 1) if {shelf_count} > 0 else 0
for i in range({shelf_count}):
    z_pos = 100 + shelf_spacing * (i + 1)
    shelf = Box(width - wall_thickness*2, depth - wall_thickness*2, shelf_thickness)
    shelf = shelf.move(Location((0, 0, z_pos - height/2)))
    shelves.append(shelf)
    features[f"@cad[shelf_{{i+1}}]"] = shelf

# === Hanging Rod ===
if {str(has_rod).lower()}:
    rod_height = height - 200
    rod = Cylinder(10, width - wall_thickness*2 - 10)
    rod = rod.rotate(axis=Axis.Y, angle=90)
    rod = rod.move(Location((0, 0, rod_height - height/2)))
    features["@cad[hanging_rod]"] = rod

# === Drawers ===
drawers = []
drawer_height = 150
drawer_spacing = 20
for i in range({drawer_count}):
    z_pos = 50 + (drawer_height + drawer_spacing) * i
    drawer_box = Box(width - wall_thickness*2 - 10, depth - 100, drawer_height)
    drawer_box = drawer_box.move(Location((0, -30, z_pos - height/2)))
    drawers.append(drawer_box)
    features[f"@cad[drawer_{{i+1}}]"] = drawer_box

# === Doors ===
doors = []
door_width = (width - 10) / {door_count}
for i in range({door_count}):
    x_pos = -width/2 + door_width/2 + 5 + door_width * i
    door = Box(door_width - 5, door_thickness, height - 10)
    door = door.move(Location((x_pos, depth/2 + door_thickness/2, 0)))
    doors.append(door)
    features[f"@cad[door_{{i+1}}]"] = door

# === Assembly ===
assembly = body
for shelf in shelves:
    assembly += shelf
if {str(has_rod).lower()}:
    assembly += features["@cad[hanging_rod]"]
for drawer in drawers:
    assembly += drawer
for door in doors:
    assembly += door

# Export STEP
export_step(assembly, "output.step")

# Save feature metadata
with open("features.json", "w") as f:
    json.dump({{k: str(v) for k, v in features.items()}}, f, indent=2)

print("Generated wardrobe successfully!")
print(f"Features: {{list(features.keys())}}")
'''
    return code


def generate_kitchen_cabinet_code(params: dict) -> str:
    """生成橱柜的build123d代码"""
    w = params.get("width", 900)
    d = params.get("depth", 600)
    h = params.get("height", 850)
    
    code = f'''#!/usr/bin/env python3
"""
Generated Kitchen Cabinet Design
Params: {json.dumps(params, ensure_ascii=False)}
"""

from build123d import *
import json

# Parameters
width = {w}
depth = {d}
height = {h}
wall_thickness = 18
door_thickness = 20
countertop_thickness = 20

features = {{}}

# === Base Cabinet Body ===
body_outer = Box(width, depth, height - countertop_thickness)
body_inner = Box(width - wall_thickness*2, depth - wall_thickness*2, height - countertop_thickness - wall_thickness)
body_inner = body_inner.move(Location((0, 0, wall_thickness/2)))
body = body_outer - body_inner
features["@cabinet[body]"] = body

# === Countertop ===
countertop = Box(width + 20, depth + 20, countertop_thickness)
countertop = countertop.move(Location((0, 0, height - countertop_thickness/2)))
features["@cabinet[countertop]"] = countertop

# === Doors ===
door_width = (width - 30) / 2
door_left = Box(door_width, door_thickness, height - countertop_thickness - 20)
door_left = door_left.move(Location((-width/4, depth/2 + door_thickness/2, -10)))
door_right = Box(door_width, door_thickness, height - countertop_thickness - 20)
door_right = door_right.move(Location((width/4, depth/2 + door_thickness/2, -10)))
features["@cabinet[door_left]"] = door_left
features["@cabinet[door_right]"] = door_right

# === Shelf ===
shelf = Box(width - wall_thickness*2, depth - wall_thickness*2, 18)
shelf = shelf.move(Location((0, 0, (height - countertop_thickness)/2 - 100)))
features["@cabinet[shelf]"] = shelf

# === Assembly ===
assembly = body + countertop + door_left + door_right + shelf

# Export STEP
export_step(assembly, "output.step")

# Save features
with open("features.json", "w") as f:
    json.dump({{k: str(v) for k, v in features.items()}}, f, indent=2)

print("Generated kitchen cabinet successfully!")
'''
    return code


def generate_simple_box_code(params: dict) -> str:
    """生成简单盒子（默认）"""
    w = params.get("width", 100)
    d = params.get("depth", 100)
    h = params.get("height", 100)
    
    code = f'''#!/usr/bin/env python3
"""
Generated Simple Box
Params: {json.dumps(params, ensure_ascii=False)}
"""

from build123d import *
import json

# Parameters
width = {w}
depth = {d}
height = {h}

features = {{}}

# === Main Body ===
body = Box(width, depth, height)
features["@cad[body]"] = body

# Export STEP
export_step(body, "output.step")

# Save features
with open("features.json", "w") as f:
    json.dump({{k: str(v) for k, v in features.items()}}, f, indent=2)

print("Generated simple box successfully!")
'''
    return code


def main():
    try:
        input_data = json.load(sys.stdin)
        params = input_data.get("params", {})
        
        # 确保输出目录存在
        os.makedirs("models", exist_ok=True)
        os.makedirs("output", exist_ok=True)
        
        # 生成唯一文件名
        param_hash = hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()[:8]
        model_name = f"{params.get('type', 'model')}_{param_hash}"
        code_file = f"models/{model_name}.py"
        
        # 根据类型生成代码
        model_type = params.get("type", "simple")
        if model_type == "wardrobe":
            code = generate_wardrobe_code(params)
        elif model_type == "kitchen_cabinet":
            code = generate_kitchen_cabinet_code(params)
        else:
            code = generate_simple_box_code(params)
        
        # 写入代码文件
        with open(code_file, "w", encoding="utf-8") as f:
            f.write(code)
        
        # 执行代码生成模型（如果build123d可用）
        try:
            import subprocess
            result = subprocess.run(
                ["python", code_file],
                capture_output=True,
                text=True,
                timeout=30
            )
            execution_success = result.returncode == 0
            execution_output = result.stdout if execution_success else result.stderr
        except Exception as e:
            execution_success = False
            execution_output = str(e)
        
        # 读取生成的特征
        features = {}
        if os.path.exists("features.json"):
            with open("features.json", "r") as f:
                features = json.load(f)
        
        print(json.dumps({
            "success": True,
            "stage": "generate",
            "code_file": code_file,
            "model_name": model_name,
            "params": params,
            "features": features,
            "execution_success": execution_success,
            "execution_output": execution_output[:500] if execution_output else "",
            "message": f"代码已生成: {code_file}"
        }))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "stage": "generate",
            "error": str(e)
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
