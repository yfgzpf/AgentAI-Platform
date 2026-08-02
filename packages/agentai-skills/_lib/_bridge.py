#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AgentAI 技能调用桥接器 (新风格)
---------------------------------
协议 (AgentAI → Python 技能):
  1. 必须参数:
     --script <path>     实际要执行的 main.py / handler.py
  2. 可选参数:
     --args-file <path>  JSON 文件, 包含完整参数对象
     --cwd <path>        切换到指定目录执行
     --timeout <sec>     软超时 (主进程负责, 桥接器只打印警告)
  3. 任何 --key value 形式的额外参数会合并到 args 字典
  4. 任何 --key=json_value 形式会尝试 JSON 反序列化

返回:
  stdout 最后一行必须是 ##RESULT## {json}, 整段 JSON 会被透传给 AgentAI

优势:
  - 老式 main.py 完全不用改, 桥接器吃掉 --args-file 等 AgentAI 内部参数
  - 新式 handler.py 可以从 --args-file 读完整 args, 也兼容 CLI flag
  - 统一超时和错误处理

示例 (AgentAI 内部调用):
  python _bridge.py --script /path/to/main.py --args-file /tmp/args.json \\
                   --action screenshot --output /tmp/x.png
"""
import argparse
import json
import os
import sys
import subprocess
import tempfile
import traceback

# 强制 UTF-8 输出, 解决 Windows GBK 环境 UnicodeEncodeError
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass


def parse_extra_args(argv):
    """解析 --key value 形式的额外参数, 尝试 JSON 反序列化"""
    extra = {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith('--') and a != '--':
            key = a[2:].replace('-', '_')
            if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
                v = argv[i + 1]
                # 尝试 JSON 反序列化 (数字/布尔/对象/数组)
                try:
                    extra[key] = json.loads(v)
                except (json.JSONDecodeError, ValueError):
                    extra[key] = v
                i += 2
            else:
                extra[key] = True
                i += 1
        else:
            i += 1
    return extra


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--script', required=True, help='要执行的 Python 脚本路径')
    parser.add_argument('--args-file', help='JSON 参数文件')
    parser.add_argument('--cwd', help='工作目录')
    parser.add_argument('--timeout', type=int, help='超时(秒)')

    # 用 parse_known 容忍其他参数
    known, unknown = parser.parse_known_args()

    # 1. 加载 args: 优先 --args-file, 其次 unknown CLI args
    args = {}
    if known.args_file and os.path.exists(known.args_file):
        try:
            with open(known.args_file, 'r', encoding='utf-8') as f:
                args = json.load(f)
        except Exception as e:
            print(f"##RESULT## {json.dumps({'success': False, 'output': f'args-file 读取失败: {e}'}, ensure_ascii=False)}")
            sys.exit(0)
        # 清理临时文件
        try:
            os.unlink(known.args_file)
        except OSError:
            pass

    # 2. 合并 CLI flags (优先级: args-file < CLI flag)
    cli_args = parse_extra_args(unknown)
    for k, v in cli_args.items():
        if k not in ('script', 'args_file', 'cwd', 'timeout'):
            args[k] = v

    if not os.path.exists(known.script):
        print(f"##RESULT## {json.dumps({'success': False, 'output': f'脚本不存在: {known.script}'}, ensure_ascii=False)}")
        sys.exit(0)

    # 3. 构造传给子脚本的命令行: --key value 对每个 args
    child_argv = [known.script]
    for k, v in args.items():
        if v is None or k.startswith('_'):
            continue
        child_argv.append(f'--{k.replace("_", "-")}')
        if isinstance(v, (str, int, float, bool)):
            child_argv.append(str(v) if not isinstance(v, bool) else str(v).lower())
        else:
            child_argv.append(json.dumps(v, ensure_ascii=False))

    # 4. 执行子脚本 (stdio 透传, 但拦截最后的 ##RESULT## 行)
    cwd = known.cwd if known.cwd else os.path.dirname(known.script)
    env = os.environ.copy()
    env['AGENTAI_ARGS_FILE'] = known.args_file or ''
    env['AGENTAI_ARGS_JSON'] = json.dumps(args, ensure_ascii=False)
    # 强制子进程用 UTF-8 输出, 解决 Windows GBK 环境 UnicodeEncodeError
    env['PYTHONIOENCODING'] = 'utf-8'
    env['PYTHONUTF8'] = '1'

    try:
        proc = subprocess.run(
            [sys.executable, known.script] + child_argv[1:],
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            encoding='utf-8',  # 显式 UTF-8 解码, 避免 Windows GBK 乱码
            errors='replace',  # 错误字节用 ? 替代, 不抛异常
            timeout=known.timeout,
        )
        stdout = proc.stdout or ''
        stderr = proc.stderr or ''

        # 提取最后一行 ##RESULT## (如果子脚本已经输出)
        result = None
        if '##RESULT##' in stdout:
            parts = stdout.rsplit('##RESULT##', 1)
            # 在子进程输出前, 打印前导内容 (供 AgentAI LLM 看)
            if parts[0].strip():
                print(parts[0].rstrip())
            try:
                result = json.loads(parts[1].strip())
            except json.JSONDecodeError:
                # 解析失败, 包装成 success
                result = {
                    'success': proc.returncode == 0,
                    'output': parts[1].strip() + (stderr and f'\n[stderr]\n{stderr}' or ''),
                }
        else:
            # 没有 ##RESULT## 行, 包装为 success/failure
            if proc.returncode == 0:
                result = {
                    'success': True,
                    'output': stdout.strip() or '(无输出)',
                }
            else:
                result = {
                    'success': False,
                    'output': f'exit={proc.returncode}\nstdout: {stdout.strip()[:1000]}\nstderr: {stderr.strip()[:1000]}',
                }
    except subprocess.TimeoutExpired:
        result = {'success': False, 'output': f'脚本执行超时 ({known.timeout}秒)'}
    except Exception as e:
        result = {'success': False, 'output': f'桥接器异常: {e}\n{traceback.format_exc()[:1000]}'}

    print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")


if __name__ == '__main__':
    main()
