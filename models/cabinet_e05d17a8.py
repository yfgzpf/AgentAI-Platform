#!/usr/bin/env python3
"""
Generated Simple Box
Params: {"type": "cabinet", "detected_features": [], "material": "plywood_18mm", "width": 800, "depth": 600, "height": 2000}
"""

from build123d import *
import json

# Parameters
width = 800
depth = 600
height = 2000

features = {}

# === Main Body ===
body = Box(width, depth, height)
features["@cad[body]"] = body

# Export STEP
export_step(body, "output.step")

# Save features
with open("features.json", "w") as f:
    json.dump({k: str(v) for k, v in features.items()}, f, indent=2)

print("Generated simple box successfully!")
