#!/usr/bin/env python3
"""
图像预处理：校正、去噪、增强
"""

import json
import sys
import os


def preprocess_image(image_path: str) -> dict:
    """图像预处理"""
    try:
        import cv2
        import numpy as np
        
        # 读取图像
        img = cv2.imread(image_path)
        if img is None:
            return {"success": False, "error": f"无法读取图像: {image_path}"}
        
        # 转灰度
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # 高斯模糊去噪
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # 自适应阈值二值化
        binary = cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, 11, 2
        )
        
        # 形态学操作（去噪 + 连接断裂线条）
        kernel = np.ones((3, 3), np.uint8)
        cleaned = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_OPEN, kernel, iterations=1)
        
        # 边缘检测
        edges = cv2.Canny(cleaned, 50, 150, apertureSize=3)
        
        # 保存处理后的图像
        os.makedirs("output", exist_ok=True)
        processed_path = "output/preprocessed.png"
        edges_path = "output/edges.png"
        
        cv2.imwrite(processed_path, cleaned)
        cv2.imwrite(edges_path, edges)
        
        return {
            "success": True,
            "processed_image": processed_path,
            "edges_image": edges_path,
            "image_size": {"width": img.shape[1], "height": img.shape[0]}
        }
        
    except ImportError:
        # OpenCV不可用，返回原图
        return {
            "success": True,
            "processed_image": image_path,
            "note": "OpenCV不可用，跳过预处理"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    try:
        input_data = json.load(sys.stdin)
        image_path = input_data.get("image_path", "")
        
        result = preprocess_image(image_path)
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
