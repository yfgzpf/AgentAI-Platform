import re
from collections import Counter

c = Counter()
sev = Counter()
perfile = Counter()
cur = None

FILE_RE = re.compile(r"^[A-Za-z]:\\")
MSG_RE = re.compile(r"^\s+\d+:\d+\s+(error|warning)\s+(.*?)\s\s+([\w@/.-]+)$")

with open("lint-baseline-2026-10-03.log", encoding="utf-8", errors="ignore") as f:
    for line in f:
        line = line.rstrip("\n")
        if FILE_RE.match(line):
            cur = line
            continue
        m = MSG_RE.match(line)
        if m:
            sev[m.group(1)] += 1
            c[m.group(3)] += 1
            if cur:
                perfile[cur.split("\\")[-1]] += 1

print("=== 严重度 ===")
for k, v in sev.most_common():
    print(f"  {v:6d}  {k}")

print("\n=== Top 15 规则 ===")
for k, v in c.most_common(15):
    print(f"  {v:6d}  {k}")

print("\n=== 问题最多的 12 个文件 ===")
for k, v in perfile.most_common(12):
    print(f"  {v:6d}  {k}")