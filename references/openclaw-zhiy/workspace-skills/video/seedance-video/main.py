#!/usr/bin/env python3
"""
豆包 Seedance 视频生成技能
"""

import argparse
import json
import os
import sys
import time
import requests
from datetime import datetime

def generate_video(prompt: str, duration: int = 5, style: str = "cinematic", resolution: str = "1080p") -> dict:
    api_key = os.environ.get('DOUBAO_API_KEY')
    if not api_key:
        raise ValueError("请设置 DOUBAO_API_KEY 环境变量")
    
    url = "https://api.doubao.com/v1/video/generate"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    data = {
        "prompt": prompt,
        "duration": duration,
        "style": style,
        "resolution": resolution,
        "aspect_ratio": "16:9"
    }
    
    response = requests.post(url, headers=headers, json=data)
    
    if response.status_code != 200:
        raise Exception(f"API 请求失败: {response.status_code} - {response.text}")
    
    return response.json()

def download_video(video_url: str, output_path: str) -> str:
    response = requests.get(video_url, stream=True)
    
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    with open(output_path, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
    
    return output_path

def poll_video_status(task_id: str, api_key: str) -> dict:
    url = f"https://api.doubao.com/v1/video/status/{task_id}"
    headers = {"Authorization": f"Bearer {api_key}"}
    
    max_attempts = 60
    for _ in range(max_attempts):
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            raise Exception(f"状态查询失败: {response.status_code}")
        
        data = response.json()
        if data.get('status') == 'completed':
            return data
        elif data.get('status') == 'failed':
            raise Exception("视频生成失败")
        
        time.sleep(5)
    
    raise Exception("视频生成超时")

def main():
    parser = argparse.ArgumentParser(description='豆包 Seedance 视频生成')
    parser.add_argument('--prompt', required=True)
    parser.add_argument('--duration', type=int, default=5)
    parser.add_argument('--style', default='cinematic', choices=['cinematic', 'anime', 'realistic'])
    parser.add_argument('--resolution', default='1080p', choices=['720p', '1080p'])
    parser.add_argument('--output', required=True)
    
    args = parser.parse_args()
    
    try:
        api_key = os.environ.get('DOUBAO_API_KEY')
        if not api_key:
            raise ValueError("请设置 DOUBAO_API_KEY 环境变量")
        
        print(f"正在生成视频: {args.prompt}", file=sys.stderr)
        
        result = generate_video(
            prompt=args.prompt,
            duration=args.duration,
            style=args.style,
            resolution=args.resolution
        )
        
        task_id = result.get('task_id')
        if task_id:
            status_result = poll_video_status(task_id, api_key)
            video_url = status_result.get('video_url')
        else:
            video_url = result.get('video_url')
        
        if not video_url:
            raise Exception("未获取到视频URL")
        
        download_video(video_url, args.output)
        
        result = {
            "status": "success",
            "data": {
                "file_path": os.path.abspath(args.output),
                "duration": args.duration,
                "resolution": args.resolution,
                "timestamp": datetime.now().isoformat()
            },
            "message": "视频生成成功"
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")
        
    except Exception as e:
        result = {
            "status": "error",
            "message": str(e)
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
