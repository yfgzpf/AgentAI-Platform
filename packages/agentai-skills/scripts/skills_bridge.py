"""
AgentAI Skills Bridge - 统一 JSON stdin/stdout 网桥
----------------------------------------------------
gateway (Node) 调本脚本: stdin 传 JSON, stdout 回 JSON
彻底解决 Windows 中文 arg 编码问题

调用:
  echo '{"action":"image","prompt":"一只猫","size":"1024x768"}' | python skills_bridge.py
  echo '{"action":"video","prompt":"一只猫跑","mode":"t2v"}' | python skills_bridge.py
  echo '{"action":"video_status","id":"xxx"}' | python skills_bridge.py
"""
import json
import os
import sys
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
AGNS_IMAGE = SCRIPT_DIR / "agns_image.py"
AGNS_VIDEO = SCRIPT_DIR / "agns_video.py"


def run_agns_image(req: dict) -> dict:
    prompt = req.get("prompt", "")
    size = req.get("size", "1024x1024")
    image_url = req.get("image")
    out = req.get("out") or str(SCRIPT_DIR.parent / "out" / f"img-{os.getpid()}-{int(__import__('time').time())}.png")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, str(AGNS_IMAGE),
        "img2img" if image_url else "text2img",
        "--prompt", prompt,
        "--size", size,
        "--out", out,
    ]
    if image_url:
        cmd += ["--image", image_url]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=360)
    if r.returncode != 0:
        return {"ok": False, "code": r.returncode, "error": r.stderr or r.stdout}
    return {"ok": True, "outputPath": out, "raw": r.stdout[-500:]}


def run_agns_video(req: dict) -> dict:
    prompt = req.get("prompt", "")
    image_url = req.get("image")
    mode = req.get("mode") or ("i2v" if image_url else "t2v")
    cmd = [sys.executable, str(AGNS_VIDEO), mode, "--prompt", prompt]
    if image_url:
        cmd += ["--image", image_url]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        return {"ok": False, "code": r.returncode, "error": r.stderr or r.stdout}
    # 找最后一行 JSON
    last_line = ""
    for line in r.stdout.strip().split("\n")[::-1]:
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            last_line = line
            break
    try:
        data = json.loads(last_line) if last_line else {}
    except Exception:
        data = {}
    return {"ok": True, "taskId": data.get("id") or data.get("task_id"), "raw": r.stdout[-500:]}


def run_video_status(req: dict) -> dict:
    task_id = req.get("id")
    if not task_id:
        return {"ok": False, "error": "id required"}
    cmd = [sys.executable, str(AGNS_VIDEO), "status", "--id", task_id]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return {"ok": r.returncode == 0, "code": r.returncode, "raw": r.stdout, "error": r.stderr}


ACTIONS = {
    "image": run_agns_image,
    "video": run_agns_video,
    "video_status": run_video_status,
}


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print(json.dumps({"ok": False, "error": "empty stdin"}))
            sys.exit(2)
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"invalid JSON: {e}"}))
        sys.exit(2)
    action = req.get("action")
    if action not in ACTIONS:
        print(json.dumps({"ok": False, "error": f"unknown action: {action}, valid: {list(ACTIONS)}"}))
        sys.exit(2)
    # 必填检查
    if not os.environ.get("AGNES_API_KEY"):
        print(json.dumps({"ok": False, "error": "AGNES_API_KEY not set"}))
        sys.exit(3)
    try:
        result = ACTIONS[action](req)
        print(json.dumps(result, ensure_ascii=False))
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": "timeout (360s)"}))
        sys.exit(4)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(5)


if __name__ == "__main__":
    main()
