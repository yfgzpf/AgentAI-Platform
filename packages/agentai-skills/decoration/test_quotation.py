#!/usr/bin/env python3
import json
import subprocess
import sys

test_data = {
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
}

result = subprocess.run(
    [sys.executable, "scripts/generate_quote.py"],
    input=json.dumps(test_data),
    capture_output=True,
    timeout=30,
    cwd="f:/agentai-platform/packages/agentai-skills/decoration/smart-quotation",
    encoding='utf-8',
    errors='replace'
)

print(f"Return code: {result.returncode}")
if result.stdout:
    try:
        data = json.loads(result.stdout)
        print(f"Success: {data.get('success')}")
        print(f"Total: {data.get('total')}")
        print(f"Per sqm: {data.get('per_sqm')}")
        print(f"Message: {data.get('message')}")
        print(f"Excel: {data.get('excel_file')}")
        print(f"Items: {data.get('item_count')}")
    except:
        print(f"Raw: {result.stdout[:300]}")
if result.stderr:
    print(f"Stderr: {result.stderr[:300]}")
