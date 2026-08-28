#!/usr/bin/env python3
"""
线条检测：识别墙体、门窗
"""

import json
import sys
import os
import math


def detect_lines(image_path: str, params: dict) -> dict:
    """检测线条"""
    try:
        import cv2
        import numpy as np
        
        # 读取边缘图像
        edges = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        if edges is None:
            # 如果边缘图不存在，读取原图
            edges = cv2.imread(image_path.replace("edges.png", "preprocessed.png"), cv2.IMREAD_GRAYSCALE)
        
        if edges is None:
            return {"success": False, "error": "无法读取图像"}
        
        # 霍夫变换检测直线
        lines = cv2.HoughLinesP(
            edges, rho=1, theta=np.pi/180,
            threshold=50, minLineLength=50, maxLineGap=10
        )
        
        walls = []
        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = line[0]
                length = math.sqrt((x2-x1)**2 + (y2-y1)**2)
                angle = math.degrees(math.atan2(y2-y1, x2-x1))
                
                # 只保留水平或垂直的线（墙体）
                if abs(angle) < 10 or abs(angle - 90) < 10 or abs(angle - 180) < 10 or abs(angle + 90) < 10:
                    walls.append({
                        "x1": int(x1), "y1": int(y1),
                        "x2": int(x2), "y2": int(y2),
                        "length": round(length, 2),
                        "angle": round(angle, 2)
                    })
        
        # 合并相近的线段（简化墙体）
        merged_walls = merge_walls(walls)
        
        # 检测矩形（门窗洞口）
        contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        
        doors_windows = []
        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            area = w * h
            
            # 过滤太小的区域和太大的区域
            if 1000 < area < 50000:
                aspect_ratio = max(w, h) / min(w, h) if min(w, h) > 0 else 0
                
                # 判断是门还是窗（根据宽高比）
                if 0.3 < aspect_ratio < 3:
                    item = {
                        "x": int(x), "y": int(y),
                        "width": int(w), "height": int(h),
                        "type": "door" if aspect_ratio > 1.5 else "window"
                    }
                    doors_windows.append(item)
        
        # 比例尺校准
        scale_reference = params.get("scale_reference", {})
        pixel_ratio = 1.0
        
        if scale_reference:
            ref_pixels = scale_reference.get("pixels", 0)
            ref_mm = scale_reference.get("mm", 0)
            if ref_pixels > 0 and ref_mm > 0:
                pixel_ratio = ref_mm / ref_pixels
        
        # 转换实际尺寸
        for wall in merged_walls:
            wall["length_mm"] = round(wall["length"] * pixel_ratio, 2)
        
        for dw in doors_windows:
            dw["width_mm"] = round(dw["width"] * pixel_ratio, 2)
            dw["height_mm"] = round(dw["height"] * pixel_ratio, 2)
        
        return {
            "success": True,
            "detection": {
                "walls": merged_walls,
                "doors_windows": doors_windows,
                "pixel_ratio": pixel_ratio,
                "image_size": {"width": edges.shape[1], "height": edges.shape[0]}
            }
        }
        
    except ImportError:
        # OpenCV不可用，返回模拟数据
        return {
            "success": True,
            "detection": generate_mock_detection(),
            "note": "OpenCV不可用，返回模拟数据"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def merge_walls(walls: list, threshold: int = 20) -> list:
    """合并相近的墙体线段"""
    if not walls:
        return []
    
    merged = []
    used = set()
    
    for i, wall1 in enumerate(walls):
        if i in used:
            continue
        
        # 找相近的线段
        group = [wall1]
        used.add(i)
        
        for j, wall2 in enumerate(walls[i+1:], start=i+1):
            if j in used:
                continue
            
            # 检查是否平行且相近
            if abs(wall1["angle"] - wall2["angle"]) < 10:
                # 检查距离
                dist = min(
                    math.sqrt((wall1["x1"]-wall2["x1"])**2 + (wall1["y1"]-wall2["y1"])**2),
                    math.sqrt((wall1["x2"]-wall2["x2"])**2 + (wall1["y2"]-wall2["y2"])**2)
                )
                if dist < threshold:
                    group.append(wall2)
                    used.add(j)
        
        # 合并线段
        if len(group) > 1:
            all_x = [p["x1"] for p in group] + [p["x2"] for p in group]
            all_y = [p["y1"] for p in group] + [p["y2"] for p in group]
            
            # 根据角度决定合并方式
            if abs(group[0]["angle"]) < 45 or abs(group[0]["angle"] - 180) < 45:
                # 水平线，按x排序
                merged.append({
                    "x1": min(all_x), "y1": sum(all_y) // len(all_y),
                    "x2": max(all_x), "y2": sum(all_y) // len(all_y),
                    "length": max(all_x) - min(all_x),
                    "angle": 0
                })
            else:
                # 垂直线，按y排序
                merged.append({
                    "x1": sum(all_x) // len(all_x), "y1": min(all_y),
                    "x2": sum(all_x) // len(all_x), "y2": max(all_y),
                    "length": max(all_y) - min(all_y),
                    "angle": 90
                })
        else:
            merged.append(wall1)
    
    return merged


def generate_mock_detection() -> dict:
    """生成模拟检测数据"""
    return {
        "walls": [
            {"x1": 0, "y1": 0, "x2": 500, "y2": 0, "length": 500, "length_mm": 5000, "angle": 0},
            {"x1": 500, "y1": 0, "x2": 500, "y2": 400, "length": 400, "length_mm": 4000, "angle": 90},
            {"x1": 500, "y1": 400, "x2": 0, "y2": 400, "length": 500, "length_mm": 5000, "angle": 180},
            {"x1": 0, "y1": 400, "x2": 0, "y2": 0, "length": 400, "length_mm": 4000, "angle": -90},
        ],
        "doors_windows": [
            {"x": 200, "y": 0, "width": 80, "height": 10, "width_mm": 800, "height_mm": 100, "type": "door"},
            {"x": 100, "y": 0, "width": 120, "height": 10, "width_mm": 1200, "height_mm": 100, "type": "window"},
        ],
        "pixel_ratio": 10.0,
        "image_size": {"width": 500, "height": 400}
    }


def main():
    try:
        input_data = json.load(sys.stdin)
        image_path = input_data.get("image_path", "")
        params = input_data.get("params", {})
        
        result = detect_lines(image_path, params)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
