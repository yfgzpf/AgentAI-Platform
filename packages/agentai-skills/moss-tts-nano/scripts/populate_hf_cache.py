"""把 ModelScope 缓存的模型文件复制到 HuggingFace 缓存目录"""
import os
import shutil
import sys

MODELS = {
    "OpenMOSS-Team/MOSS-TTS-Nano": "openmoss/MOSS-TTS-Nano",
    "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano": "openmoss/MOSS-Audio-Tokenizer-Nano",
}


def main():
    hf_home = os.environ.get("HF_HOME", "")
    if not hf_home:
        hf_home = os.path.join(os.getcwd(), ".cache", "huggingface")

    ms_home = os.path.expanduser(r"~\.cache\modelscope\hub\models")

    for hf_name, ms_name in MODELS.items():
        ms_path = os.path.join(ms_home, ms_name)
        if not os.path.exists(ms_path):
            print(f"[跳过] ModelScope 缓存不存在: {ms_path}")
            continue

        # HF 缓存结构: {hf_home}/hub/models--org--name/snapshots/{rev}/
        hub_name = f"models--{hf_name.replace('/', '--')}"
        snapshots_dir = os.path.join(hf_home, "hub", hub_name, "snapshots")
        refs_dir = os.path.join(hf_home, "hub", hub_name, "refs")

        # 获取文件列表（不含元数据文件）
        ms_files = [
            f
            for f in os.listdir(ms_path)
            if os.path.isfile(os.path.join(ms_path, f))
            and not f.startswith(".")
            and not f.startswith("_")
        ]

        # 用文件内容的 hash 作为 revision
        import hashlib
        all_content = b"".join(sorted([f.encode() for f in ms_files]))
        rev = hashlib.sha256(all_content).hexdigest()[:40]

        os.makedirs(refs_dir, exist_ok=True)
        with open(os.path.join(refs_dir, "main"), "w") as f:
            f.write(rev)

        target = os.path.join(snapshots_dir, rev)
        os.makedirs(target, exist_ok=True)

        total = 0
        for fname in ms_files:
            src = os.path.join(ms_path, fname)
            dst = os.path.join(target, fname)
            if os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(src):
                continue  # 已存在，跳过
            shutil.copy2(src, dst)
            size = os.path.getsize(dst) / 1024 / 1024
            total += size
            print(f"  {fname} ({size:.1f} MB)")

        print(f"[完成] {hf_name} -> {target} (共 {total:.1f} MB)")

    print("\n全部完成！")


if __name__ == "__main__":
    main()
