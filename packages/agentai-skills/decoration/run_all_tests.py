#!/usr/bin/env python3
"""综合测试所有装修技能"""
import json
import subprocess
import sys
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

test_rooms = {
    "rooms": [
        {"name": "客厅", "function": "living_room", "x": 0, "y": 0, "width": 4.5, "height": 4.2},
        {"name": "主卧", "function": "bedroom", "x": 4.5, "y": 0, "width": 3.6, "height": 4.2},
        {"name": "厨房", "function": "kitchen", "x": 0, "y": 4.2, "width": 2.5, "height": 2.8},
        {"name": "卫生间", "function": "bathroom", "x": 2.5, "y": 4.2, "width": 2.0, "height": 2.8}
    ]
}

tests = [
    ("tile-layout-generator", "scripts/generate_layout.py", {
        "room_width": 4500, "room_height": 4200,
        "tile_width": 800, "tile_height": 800,
        "pattern": "straight", "grout_width": 2
    }),
    ("sketch-to-cad", "scripts/detect_lines.py", {
        "image_path": "test.png",
        "params": {}
    }),
    ("smart-quotation", "scripts/generate_quote.py", {
        "quantities": {
            "total_area": 100,
            "wall_area_gross": 280,
            "floor_area": 100,
            "ceiling_area": 100,
            "materials": {}
        },
        "tier": "standard",
        "project_info": {"client_name": "test", "address": "test"},
        "template_id": ""
    }),
    ("plumbing-layout-generator", "scripts/generate_plumbing.py", test_rooms),
    ("plumbing-layout-generator", "scripts/generate_electrical.py", test_rooms),
    ("plumbing-layout-generator", "scripts/calculate_materials.py", test_rooms),
    ("hvac-designer", "scripts/generate_heating.py", {**test_rooms, "heating_type": "water"}),
    ("hvac-designer", "scripts/generate_fresh_air.py", {**test_rooms, "building_type": "residential"}),
    ("hvac-designer", "scripts/calculate_load.py", {**test_rooms, "climate_zone": "夏热冬冷"}),
]

results = []
base_dir = os.path.dirname(os.path.abspath(__file__))

for skill_name, script, test_data in tests:
    script_path = os.path.join(base_dir, skill_name, script)
    if not os.path.exists(script_path):
        results.append((skill_name, script, "SKIP", f"File not found: {script_path}"))
        continue
    
    try:
        result = subprocess.run(
            [sys.executable, script_path],
            input=json.dumps(test_data),
            capture_output=True,
            text=True,
            timeout=30,
            cwd=os.path.dirname(script_path),
            encoding='utf-8',
            errors='replace'
        )
        
        if result.returncode == 0:
            try:
                data = json.loads(result.stdout)
                success = data.get("success", False)
                msg = data.get("message", data.get("error", ""))[:80]
                results.append((skill_name, script, "PASS" if success else "FAIL", msg))
            except:
                results.append((skill_name, script, "PARSE", result.stdout[:80]))
        else:
            err = result.stderr[:80] if result.stderr else "Unknown error"
            results.append((skill_name, script, "ERROR", err))
    except Exception as e:
        results.append((skill_name, script, "EXCEPT", str(e)[:80]))

print("\n" + "="*80)
print("  装修技能综合测试报告")
print("="*80)
for skill, script, status, msg in results:
    icon = {"PASS": "OK", "FAIL": "XX", "ERROR": "!!", "SKIP": "--", "PARSE": "??", "EXCEPT": "EE"}.get(status, "??")
    print(f"  [{icon}] {skill:35s} {script:30s} {msg}")
print("="*80)

passed = sum(1 for _, _, s, _ in results if s == "PASS")
total = len(results)
print(f"  Total: {passed}/{total} passed")
