"""Agnes AI 图片生成 CLI —— 支持文生图 / 图生图，URL 与 Base64 双输出。"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

API_BASE = os.environ.get("AGNES_BASE_URL", "https://apihub.agnes-ai.com")
ENDPOINT = f"{API_BASE}/v1/images/generations"
DEFAULT_MODEL = "agnes-image-2.1-flash"


def _get_api_key() -> str:
    key = os.environ.get("AGNES_API_KEY")
    if not key:
        print("[error] 缺少环境变量 AGNES_API_KEY。请先 export AGNES_API_KEY=sk-xxx", file=sys.stderr)
        sys.exit(2)
    return key


def _post_json(payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {_get_api_key()}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=360) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:  # noqa: PERF203
        body = e.read().decode("utf-8", errors="replace")
        print(f"[error] HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)


def _save_url_to(url: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=120) as r, out_path.open("wb") as f:
        f.write(r.read())


def _save_b64_to(b64: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(base64.b64decode(b64))


def _to_image_input(p: str) -> str:
    """本地文件 → 纯 base64 字符串；http(s) / data: 原样返回。

    经验：Agnes 图生图接口直接接收纯 base64（无 ``data:<mime>;base64,`` 前缀），
    带 data: 前缀会返回 "Incorrect padding"。
    """
    if p.startswith(("http://", "https://", "data:")):
        return p
    path = Path(p)
    if not path.is_file():
        return p
    return base64.b64encode(path.read_bytes()).decode("ascii")


def cmd_text2img(args: argparse.Namespace) -> None:
    payload: dict[str, Any] = {
        "model": DEFAULT_MODEL,
        "prompt": args.prompt,
        "size": args.size,
    }
    if args.url_output:
        payload.setdefault("extra_body", {})["response_format"] = "url"
    elif args.b64_output:
        payload["return_base64"] = True
    else:
        # 默认走 URL 输出，文件落盘
        payload.setdefault("extra_body", {})["response_format"] = "url"

    result = _post_json(payload)
    item = (result.get("data") or [{}])[0]
    if not item:
        print(f"[error] 响应中无 data 字段：{result}", file=sys.stderr)
        sys.exit(1)

    out = Path(args.out)
    if item.get("url"):
        _save_url_to(item["url"], out)
    elif item.get("b64_json"):
        _save_b64_to(item["b64_json"], out)
    else:
        print(f"[error] 响应未返回 url/b64_json：{result}", file=sys.stderr)
        sys.exit(1)
    print(f"[ok] 图片已保存：{out}  ({time.strftime('%F %T')})")


def cmd_img2img(args: argparse.Namespace) -> None:
    extra_body: dict[str, Any] = {}
    if args.url_output or not args.b64_output:
        extra_body["response_format"] = "url"
    else:
        extra_body["response_format"] = "b64_json"

    payload: dict[str, Any] = {
        "model": DEFAULT_MODEL,
        "prompt": args.prompt,
        "size": args.size,
        "image": [_to_image_input(x) for x in args.image],
        "extra_body": extra_body,
    }
    result = _post_json(payload)
    item = (result.get("data") or [{}])[0]
    if not item:
        print(f"[error] 响应中无 data 字段：{result}", file=sys.stderr)
        sys.exit(1)

    out = Path(args.out)
    if item.get("url"):
        _save_url_to(item["url"], out)
    elif item.get("b64_json"):
        _save_b64_to(item["b64_json"], out)
    else:
        print(f"[error] 响应未返回 url/b64_json：{result}", file=sys.stderr)
        sys.exit(1)
    print(f"[ok] 图片已保存：{out}  ({time.strftime('%F %T')})")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Agnes AI 图片生成（agnes-image-2.1-flash）")
    sub = p.add_subparsers(dest="cmd", required=True)

    p1 = sub.add_parser("text2img", help="文生图")
    p1.add_argument("--prompt", required=True)
    p1.add_argument("--size", default="1024x768")
    p1.add_argument("--out", required=True, help="输出图片路径")
    p1.add_argument("--url-output", action="store_true", help="请求 url 输出（默认）")
    p1.add_argument("--b64-output", action="store_true", help="请求 Base64 输出")
    p1.set_defaults(func=cmd_text2img)

    p2 = sub.add_parser("img2img", help="图生图（URL 或 Data URI）")
    p2.add_argument("--prompt", required=True)
    p2.add_argument("--size", default="1024x768")
    p2.add_argument("--image", nargs="+", required=True, help="输入图片 URL 或 Data URI，可多个")
    p2.add_argument("--out", required=True)
    p2.add_argument("--url-output", action="store_true")
    p2.add_argument("--b64-output", action="store_true")
    p2.set_defaults(func=cmd_img2img)

    return p


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
