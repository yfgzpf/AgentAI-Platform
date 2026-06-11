"""Agnes AI 视频任务 CLI —— 文生视频 / 图生视频 / 多图 / 关键帧 / 状态查询 / 阻塞等待。

注意：查询结果时使用任务响应里的 ``id`` 字段（官方文档称之为 ``video id``），
不要使用早期文档中出现的 ``task_id``，以避免视频排队等待。
"""
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
TASKS_URL = f"{API_BASE}/v1/videos"
DEFAULT_MODEL = "agnes-video-v2.0"


def _get_api_key() -> str:
    key = os.environ.get("AGNES_API_KEY")
    if not key:
        print("[error] 缺少环境变量 AGNES_API_KEY。请先 export AGNES_API_KEY=sk-xxx", file=sys.stderr)
        sys.exit(2)
    return key


def _post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {_get_api_key()}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[error] HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)


def _get_json(url: str) -> dict[str, Any]:
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                url,
                method="GET",
                headers={"Authorization": f"Bearer {_get_api_key()}"},
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last_err = e
            time.sleep(2 + attempt * 2)
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {_get_api_key()}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[error] HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"[error] 多次重试后仍无法连接：{e}", file=sys.stderr)
        if last_err is not None:
            raise last_err
        raise


def _create_task(payload: dict[str, Any]) -> dict[str, Any]:
    return _post_json(TASKS_URL, payload)


def _pick_id_for_status(resp: dict[str, Any]) -> str | None:
    """响应里 ``id`` 与 ``task_id`` 同值，是当前 ``GET /v1/videos/{id}`` 接口支持的可查询 id。

    ``video_id`` 字段是 base64 内部引用，**不要**直接喂给查询接口，否则会
    收到 ``task_not_exist``。官方文档"用 video id 查询"指的是更上层任务调度优化，
    当前接口仍以 ``id``/``task_id`` 为准。
    """
    return resp.get("id") or resp.get("task_id") or resp.get("video_id")


def _status(video_id: str) -> dict[str, Any]:
    return _get_json(f"{TASKS_URL}/{video_id}")


def _save_url_to(url: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=600) as r, out_path.open("wb") as f:
        f.write(r.read())


def _to_image_input(p: str) -> str:
    """允许 --image 传本地文件路径，自动转成纯 base64 字符串。

    已经是 http(s):// / data: / 纯 base64 的直接原样返回。
    经验：Agnes 当前接口直接接收纯 base64 字符串（无 ``data:<mime>;base64,`` 前缀），
    带 ``data:`` 前缀反而会报 "Incorrect padding"。
    """
    if p.startswith(("http://", "https://", "data:")):
        return p
    path = Path(p)
    if not path.is_file():
        return p
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _common_kwargs(args: argparse.Namespace) -> dict[str, Any]:
    out: dict[str, Any] = {
        "model": DEFAULT_MODEL,
        "height": args.height,
        "width": args.width,
        "num_frames": args.num_frames,
        "frame_rate": args.frame_rate,
    }
    if args.seed is not None:
        out["seed"] = args.seed
    if args.steps is not None:
        out["num_inference_steps"] = args.steps
    if args.negative_prompt:
        out["negative_prompt"] = args.negative_prompt
    return {k: v for k, v in out.items() if v is not None}


def cmd_t2v(args: argparse.Namespace) -> None:
    payload = {"prompt": args.prompt, **_common_kwargs(args)}
    result = _create_task(payload)
    vid = _pick_id_for_status(result)
    print(f"[ok] 任务已创建：{vid} (status={result.get('status')})")
    if args.wait and vid:
        _blocking_wait(vid, args)


def cmd_i2v(args: argparse.Namespace) -> None:
    payload: dict[str, Any] = {
        "prompt": args.prompt,
        "image": _to_image_input(args.image[0]),
        **_common_kwargs(args),
    }
    if args.image_mode:
        payload["mode"] = args.image_mode
    result = _create_task(payload)
    vid = _pick_id_for_status(result)
    print(f"[ok] 任务已创建：{vid} (status={result.get('status')})")
    if args.wait and vid:
        _blocking_wait(vid, args)


def cmd_multi(args: argparse.Namespace) -> None:
    payload: dict[str, Any] = {
        "prompt": args.prompt,
        "extra_body": {"image": [_to_image_input(x) for x in args.image]},
        **_common_kwargs(args),
    }
    result = _create_task(payload)
    vid = _pick_id_for_status(result)
    print(f"[ok] 任务已创建：{vid} (status={result.get('status')})")
    if args.wait and vid:
        _blocking_wait(vid, args)


def cmd_keyframes(args: argparse.Namespace) -> None:
    payload: dict[str, Any] = {
        "prompt": args.prompt,
        "extra_body": {
            "image": [_to_image_input(x) for x in args.image],
            "mode": "keyframes",
        },
        **_common_kwargs(args),
    }
    result = _create_task(payload)
    vid = _pick_id_for_status(result)
    print(f"[ok] 任务已创建：{vid} (status={result.get('status')})")
    if args.wait and vid:
        _blocking_wait(vid, args)


def cmd_status(args: argparse.Namespace) -> None:
    print(json.dumps(_status(args.id), ensure_ascii=False, indent=2))


def _blocking_wait(video_id: str, args: argparse.Namespace) -> None:
    deadline = time.time() + (args.timeout or 1800)
    poll = max(2, args.poll)
    while time.time() < deadline:
        try:
            info = _status(video_id)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            # 网络抖动：当作一次未轮询成功，不退出
            print(f"  - 网络抖动，稍后重试：{e}")
            time.sleep(poll)
            continue
        st = info.get("status")
        prog = info.get("progress")
        print(f"  - {video_id} status={st} progress={prog}")
        if st == "completed":
            url = info.get("video_url") or info.get("remixed_from_video_id")
            if not url:
                print("[error] 任务完成但未返回 video_url，请检查响应：", info, file=sys.stderr)
                sys.exit(1)
            out = Path(args.out or f"./{video_id}.mp4")
            _save_url_to(url, out)
            print(f"[ok] 视频已保存：{out}")
            return
        if st == "failed":
            print(f"[error] 任务失败：{info.get('error')}", file=sys.stderr)
            sys.exit(1)
        time.sleep(poll)
    print(f"[error] 任务超时（>{args.timeout}s）未完成", file=sys.stderr)
    sys.exit(1)


def cmd_wait(args: argparse.Namespace) -> None:
    _blocking_wait(args.id, args)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Agnes AI 视频任务（agnes-video-v2.0）")
    sub = p.add_subparsers(dest="cmd", required=True)

    def _common_video_args(sp: argparse.ArgumentParser, need_image: bool = False) -> None:
        sp.add_argument("--prompt", required=True)
        sp.add_argument("--height", type=int, default=768)
        sp.add_argument("--width", type=int, default=1152)
        sp.add_argument("--num-frames", type=int, default=121, help="必须 ≤441，且 8n+1")
        sp.add_argument("--frame-rate", type=float, default=24.0, help="1-60")
        sp.add_argument("--seed", type=int, default=None)
        sp.add_argument("--steps", type=int, default=None, help="推理步数")
        sp.add_argument("--negative-prompt", default=None)
        sp.add_argument("--out", default=None, help="完成时自动下载到该路径")
        sp.add_argument("--wait", action="store_true", help="提交后阻塞等待到完成")
        sp.add_argument("--timeout", type=int, default=1800)
        sp.add_argument("--poll", type=int, default=8)
        if need_image:
            sp.add_argument("--image", nargs="+", required=True)
            sp.add_argument(
                "--image-mode",
                default=None,
                help="可选：ti2vid 等；仅 i2v 模式使用",
            )

    p1 = sub.add_parser("t2v", help="文生视频")
    _common_video_args(p1)
    p1.set_defaults(func=cmd_t2v)

    p2 = sub.add_parser("i2v", help="图生视频")
    _common_video_args(p2, need_image=True)
    p2.set_defaults(func=cmd_i2v)

    p3 = sub.add_parser("multi", help="多图视频")
    _common_video_args(p3, need_image=True)
    p3.set_defaults(func=cmd_multi)

    p4 = sub.add_parser("keyframes", help="关键帧动画")
    _common_video_args(p4, need_image=True)
    p4.set_defaults(func=cmd_keyframes)

    p5 = sub.add_parser("status", help="查询任务状态")
    p5.add_argument("--id", required=True, help="video id（不是 task_id）")
    p5.set_defaults(func=cmd_status)

    p6 = sub.add_parser("wait", help="阻塞等到完成并下载")
    p6.add_argument("--id", required=True)
    p6.add_argument("--out", required=True)
    p6.add_argument("--timeout", type=int, default=1800)
    p6.add_argument("--poll", type=int, default=8)
    p6.set_defaults(func=cmd_wait)

    return p


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
