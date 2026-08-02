"""
视频生成自动化脚本：提交 → 轮询 → 下载
支持两个引擎：
  1. CogVideoX-Flash (智谱免费) — 优先
  2. Agnes Video V2.0 (降级)
"""

import os
import sys, io
import json
import time
import requests
from pathlib import Path
from dotenv import load_dotenv

# 修复 Windows stdout 编码问题（中文注释可能导致 UnicodeEncodeError）
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

load_dotenv()

# ── 配置 ──────────────────────────────────────────────
OUTPUT_DIR = Path("output/videos")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

COGVIDEO_API_KEY = os.getenv("ZHIPU_API_KEY", "")
COGVIDEO_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
AGNES_API_KEY = os.getenv("AGNES_API_KEY", "")
AGNES_BASE_URL = "https://apihub.agnes-ai.com"
AGENTAI_API_KEY = os.getenv("AGENTAI_API_KEY", "")

POLL_INTERVAL = 10  # 秒
MAX_WAIT = 600      # 最大等待 10 分钟


def submit_cogvideo(prompt: str, duration: int = 5, size: str = "720x1280") -> dict:
    """提交智谱 CogVideoX 视频生成任务"""
    url = f"{COGVIDEO_BASE_URL}/videos/generations"
    headers = {
        "Authorization": f"Bearer {COGVIDEO_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": "cogvideox-flash",
        "prompt": prompt,
        "duration": duration,
        "size": size,
    }
    print(f"[CogVideo] Submitting to {url}")
    resp = requests.post(url, headers=headers, json=body, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    print(f"[CogVideo] Response: {json.dumps(data, ensure_ascii=False)[:500]}")
    return data


def submit_agnes(prompt: str, duration: int = 5, size: str = "720x1280") -> dict:
    """提交 Agnes Video 视频生成任务"""
    url = f"{AGNES_BASE_URL}/v1/videos/generations"
    headers = {
        "Authorization": f"Bearer {AGENTAI_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": os.getenv("AGNES_VIDEO_MODEL", "agnes-video-v2.0"),
        "prompt": prompt,
        "duration": duration,
        "size": size,
    }
    print(f"[Agnes] Submitting to {url}")
    resp = requests.post(url, headers=headers, json=body, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    print(f"[Agnes] Response: {json.dumps(data, ensure_ascii=False)[:500]}")
    return data


def poll_cogvideo(task_id: str) -> dict:
    """轮询智谱视频生成状态"""
    url = f"{COGVIDEO_BASE_URL}/videos/generations/{task_id}"
    headers = {"Authorization": f"Bearer {COGVIDEO_API_KEY}"}
    
    start = time.time()
    while time.time() - start < MAX_WAIT:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status", "").lower()
        print(f"[CogVideo] Status: {status} ({int(time.time()-start)}s)")
        
        if status in ("completed", "success"):
            return data
        elif status in ("failed", "error"):
            raise RuntimeError(f"视频生成失败: {json.dumps(data, ensure_ascii=False)}")
        elif status in ("processing", "pending"):
            time.sleep(POLL_INTERVAL)
        else:
            time.sleep(POLL_INTERVAL)
    
    raise TimeoutError("视频生成超时")


def poll_agnes(task_id: str) -> dict:
    """轮询 Agnes 视频生成状态"""
    url = f"{AGNES_BASE_URL}/v1/videos/generations/{task_id}"
    headers = {"Authorization": f"Bearer {AGENTAI_API_KEY}"}
    
    start = time.time()
    while time.time() - start < MAX_WAIT:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status", "").lower()
        print(f"[Agnes] Status: {status} ({int(time.time()-start)}s)")
        
        if status in ("completed", "success"):
            return data
        elif status in ("failed", "error"):
            raise RuntimeError(f"视频生成失败: {json.dumps(data, ensure_ascii=False)}")
        elif status in ("processing", "pending"):
            time.sleep(POLL_INTERVAL)
        else:
            time.sleep(POLL_INTERVAL)
    
    raise TimeoutError("视频生成超时")


def download_video(url: str, output_path: Path) -> Path:
    """下载视频文件"""
    print(f"[Download] {url} → {output_path}")
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        f.write(resp.content)
    print(f"[OK] Saved: {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")
    return output_path


def generate_video(
    prompt: str,
    duration: int = 5,
    size: str = "720x1280",
    engine: str = "auto",
):
    """主流程：选择引擎 → 提交 → 轮询 → 下载"""
    
    engines = []
    if engine == "auto":
        if COGVIDEO_API_KEY:
            engines.append(("cogvideo", submit_cogvideo, poll_cogvideo))
        if AGNES_API_KEY:
            engines.append(("agnes", submit_agnes, poll_agnes))
    elif engine == "cogvideo":
        if not COGVIDEO_API_KEY:
            raise RuntimeError("ZHIPU_API_KEY 未配置")
        engines.append(("cogvideo", submit_cogvideo, poll_cogvideo))
    elif engine == "agnes":
        if not AGNES_API_KEY:
            raise RuntimeError("AGENTAI_API_KEY 未配置")
        engines.append(("agnes", submit_agnes, poll_agnes))
    
    if not engines:
        raise RuntimeError("没有可用的视频生成引擎，请检查 .env 中的 API Key")
    
    last_error = None
    for name, submit_fn, poll_fn in engines:
        print(f"\n{'='*60}")
        print(f"使用引擎: {name}")
        print(f"提示词: {prompt[:100]}...")
        try:
            submit_data = submit_fn(prompt, duration, size)
            task_id = submit_data.get("id") or submit_data.get("data", {}).get("id")
            if not task_id:
                print(f"[{name}] 未获取到 task_id, raw: {json.dumps(submit_data, ensure_ascii=False)[:300]}")
                continue
            
            result = poll_fn(task_id)
            
            # 提取视频 URL
            video_url = None
            if isinstance(result.get("data"), dict):
                video_url = result["data"].get("video_url") or result["data"].get("url")
            elif "video_url" in result:
                video_url = result["video_url"]
            elif "url" in result:
                video_url = result["url"]
            
            if not video_url:
                print(f"[{name}] 未找到视频 URL, raw keys: {list(result.keys())}")
                # 尝试从 data 嵌套中找
                data = result.get("data", {})
                if isinstance(data, list) and data:
                    video_url = data[0].get("video_url") or data[0].get("url")
            
            if not video_url:
                raise RuntimeError(f"无法从响应中提取视频 URL: {json.dumps(result, ensure_ascii=False)[:500]}")
            
            # 下载
            ext = ".mp4"
            filename = f"video_{int(time.time())}{ext}"
            output_path = OUTPUT_DIR / filename
            download_video(video_url, output_path)
            
            # 保存元数据
            meta_path = OUTPUT_DIR / f"{filename}.meta.json"
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump({
                    "engine": name,
                    "prompt": prompt,
                    "duration": duration,
                    "size": size,
                    "output": str(output_path),
                    "meta": result,
                }, f, ensure_ascii=False, indent=2)
            
            print(f"\n✅ 完成! 文件: {output_path}")
            return str(output_path)
            
        except Exception as e:
            last_error = e
            print(f"[{name}] 失败: {e}")
            continue
    
    raise RuntimeError(f"所有引擎都失败了: {last_error}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python scripts/video_gen_auto.py <提示词> [时长秒] [尺寸] [引擎]")
        print("示例: python scripts/video_gen_auto.py \"一只猫在草地上奔跑\" 5 720x1280 auto")
        sys.exit(1)
    
    prompt = sys.argv[1]
    duration = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    size = sys.argv[3] if len(sys.argv) > 3 else "720x1280"
    engine = sys.argv[4] if len(sys.argv) > 4 else "auto"
    
    try:
        path = generate_video(prompt, duration, size, engine)
        print(json.dumps({"status": "ok", "path": path}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}, ensure_ascii=False))
        sys.exit(1)
