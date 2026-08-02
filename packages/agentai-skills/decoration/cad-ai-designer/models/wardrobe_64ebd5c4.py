#!/usr/bin/env python3
"""
Generated Wardrobe Design
Params: {"type": "wardrobe", "detected_features": [], "width": 800, "depth": 600, "height": 2000, "material": "plywood_18mm"}
Generated: 2026-07-08T17:40:37.921022
"""

from build123d import *
import json

# Parameters
width = 800
depth = 600
height = 2000
wall_thickness = 18
door_thickness = 20
shelf_thickness = 18

# Feature registry for @cad references
features = {}

# === Main Body ===
# Outer shell
body_outer = Box(width, depth, height)
body_inner = Box(width - wall_thickness*2, depth - wall_thickness*2, height - wall_thickness)
body_inner = body_inner.move(Location((0, 0, wall_thickness/2)))
body = body_outer - body_inner
features["@cad[body]"] = body

# === Shelves ===
shelves = []
shelf_spacing = (height - 200) / (3 + 1) if 3 > 0 else 0
for i in range(3):
    z_pos = 100 + shelf_spacing * (i + 1)
    shelf = Box(width - wall_thickness*2, depth - wall_thickness*2, shelf_thickness)
    shelf = shelf.move(Location((0, 0, z_pos - height/2)))
    shelves.append(shelf)
    features[f"@cad[shelf_{i+1}]"] = shelf

# === Hanging Rod ===
if true:
    rod_height = height - 200
    rod = Cylinder(10, width - wall_thickness*2 - 10)
    rod = rod.rotate(axis=Axis.Y, angle=90)
    rod = rod.move(Location((0, 0, rod_height - height/2)))
    features["@cad[hanging_rod]"] = rod

# === Drawers ===
drawers = []
drawer_height = 150
drawer_spacing = 20
for i in range(0):
    z_pos = 50 + (drawer_height + drawer_spacing) * i
    drawer_box = Box(width - wall_thickness*2 - 10, depth - 100, drawer_height)
    drawer_box = drawer_box.move(Location((0, -30, z_pos - height/2)))
    drawers.append(drawer_box)
    features[f"@cad[drawer_{i+1}]"] = drawer_box

# === Doors ===
doors = []
door_width = (width - 10) / 2
for i in range(2):
    x_pos = -width/2 + door_width/2 + 5 + door_width * i
    door = Box(door_width - 5, door_thickness, height - 10)
    door = door.move(Location((x_pos, depth/2 + door_thickness/2, 0)))
    doors.append(door)
    features[f"@cad[door_{i+1}]"] = door

# === Assembly ===
assembly = body
for shelf in shelves:
    assembly += shelf
if true:
    assembly += features["@cad[hanging_rod]"]
for drawer in drawers:
    assembly += drawer
for door in doors:
    assembly += door

# Export STEP
export_step(assembly, "output.step")

# Save feature metadata
with open("features.json", "w") as f:
    json.dump({k: str(v) for k, v in features.items()}, f, indent=2)

print("Generated wardrobe successfully!")
print(f"Features: {list(features.keys())}")
