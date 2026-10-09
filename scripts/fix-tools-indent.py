#!/usr/bin/env python3
"""
B0-1: 修复 tools.ts EXTRA_HANDLERS 中 0缩进的 handler

为什么用语义定位而非硬编码行号：
  工作区文件已在被修改，行号会漂移。必须靠"对象内0缩进 handler key"这一
  结构特征定位，否则改错位置的风险极高。

做法：
  1. 定位 EXTRA_HANDLERS 对象起点
  2. 找出对象内所有 0 缩进的 handler key（形如 `name: async (`）
  3. 从每个 key 起，向下找块尾（第一个缩进为 2 的非空行之前）
  4. 整块 +2 空格
  5. 内存内逐行校验：每个改动行必须严格等于 "  " + 原行
"""
import re
import sys

FILE = "packages/agentai-gateway/src/tools.ts"


def find_block_end(lines, start_idx, obj_end):
    """
    start_idx: handler key 所在行索引（0-based）
    返回该 handler 块的结束行索引（含），即块内最后一个非空行
    """
    i = start_idx
    while i < obj_end:
        line = lines[i]
        if line.strip() and line[0] in (" ", "\t"):
            # 遇到已缩进的非空行 -> 本块结束（块应在下一行开始）
            return i - 1
        # 遇到下一个 0 缩进 handler key -> 本块结束（首尾相接的 handler）
        if i > start_idx and re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*async\s*\(", line):
            return i - 1
        # 遇到 0 缩进的分节注释且本块已闭合 -> 归给下一块
        if (line.startswith("// =====") and i > start_idx + 1
                and any(l.strip() == "}," for l in lines[start_idx:i])):
            return i - 1
        i += 1
    return obj_end - 1


def main():
    with open(FILE, encoding="utf-8") as f:
        original = f.read()
    lines = original.split("\n")

    # 1. 定位对象起点
    obj_start = None
    for idx, line in enumerate(lines):
        if line.startswith("export const EXTRA_HANDLERS"):
            obj_start = idx
            break
    if obj_start is None:
        print("ABORT: 未找到 EXTRA_HANDLERS")
        return 1

    # 对象终点：下一个 0 缩进的 `export` / 顶层声明
    obj_end = len(lines)
    for idx in range(obj_start + 1, len(lines)):
        line = lines[idx]
        if line.startswith("export const ") and idx > obj_start + 5:
            obj_end = idx
            break

    # 2. 找出所有 0 缩进 handler
    keys = []
    for idx in range(obj_start, obj_end):
        m = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*async\s*\(", lines[idx])
        if m:
            keys.append((idx, m.group(1)))

    if not keys:
        print("DONE: 没有 0 缩进的 handler，无需处理")
        return 0

    print(f"发现 {len(keys)} 个 0 缩进 handler:")
    for idx, name in keys:
        print(f"  {idx + 1:5d}  {name}")

    # 3. 计算块范围
    blocks = []
    for idx, name in keys:
        end = find_block_end(lines, idx, obj_end)
        blocks.append((idx, end, name))

    # 3.5 校验：块尾必须是 }, （handler 闭合）
    for idx, end, name in blocks:
        j = end
        while j > idx and not lines[j].strip():
            j -= 1
        if lines[j].strip() != "},":
            print(f"ABORT: {name} 块尾非}}, -> {lines[j][:60]!r}")
            return 1

    # 4. 缩进（从后往前，避免行号漂移）
    before = list(lines)
    for idx, end, name in sorted(blocks, key=lambda b: -b[0]):
        for i in range(idx, end + 1):
            if lines[i].strip():
                lines[i] = "  " + lines[i]

    new_content = "\n".join(lines)

    # 5. 内存内逐行校验：差异必须严格是"每行前缀 +2 空格"
    diff_idx = [i for i in range(max(len(before), len(lines)))
                if (before[i] if i < len(before) else None)
                != (lines[i] if i < len(lines) else None)]

    if not diff_idx:
        print("ABORT: 无变化")
        return 1

    bad = []
    for i in diff_idx:
        old = before[i]
        new = lines[i]
        if new == "  " + old:
            continue
        bad.append((i + 1, old, new))

    if bad:
        print(f"FAIL: {len(bad)} 行存在非缩进改动")
        for ln, old, new in bad[:10]:
            print(f"  line {ln}:\n    - {old[:80]!r}\n    + {new[:80]!r}")
        return 1

    # 行数必须不变
    if len(before) != len(lines):
        print(f"FAIL: 行数变化 {len(before)} -> {len(lines)}")
        return 1

    with open(FILE, "w", encoding="utf-8", newline="") as f:
        f.write(new_content)

    print(f"OK: {len(blocks)} 块 / {len(diff_idx)} 行已缩进（校验通过：全部为纯前缀 +2）")
    return 0


if __name__ == "__main__":
    sys.exit(main())