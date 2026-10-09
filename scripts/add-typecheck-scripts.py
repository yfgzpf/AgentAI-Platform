import json
import io

PACKS = [
    "agentai-core",
    "agentai-gui",
    "agentai-qqbot",
    "agentai-vscode",
]

for pkg in PACKS:
    path = f"packages/{pkg}/package.json"
    with io.open(path, encoding="utf-8") as f:
        d = json.load(f)
    scripts = d.setdefault("scripts", {})
    if "typecheck" not in scripts:
        scripts["typecheck"] = "tsc --noEmit"
        d["scripts"] = dict(sorted(scripts.items()))
        with io.open(path, "w", encoding="utf-8", newline="") as f:
            f.write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
        print(f"added typecheck -> {pkg}")
    else:
        print(f"exists, skip    -> {pkg} ({scripts['typecheck']})")