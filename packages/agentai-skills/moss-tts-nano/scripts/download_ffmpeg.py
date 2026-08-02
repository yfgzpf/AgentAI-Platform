"""下载 FFmpeg 并解压到项目缓存目录"""
import urllib.request
import zipfile
import pathlib
import sys
import os
import stat
import shutil

dest = pathlib.Path("f:/agentai-platform/.cache/ffmpeg")
dest.mkdir(parents=True, exist_ok=True)
zip_path = dest / "ffmpeg.zip"

url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"

# 删除旧的 zip 文件
if zip_path.exists():
    zip_path.unlink()

print("正在下载 FFmpeg (约 130 MB)...")
sys.stdout.flush()
urllib.request.urlretrieve(url, zip_path)
size_mb = zip_path.stat().st_size / 1024 / 1024
print(f"下载完成: {size_mb:.1f} MB")

# 验证 zip 文件
with zipfile.ZipFile(str(zip_path)) as z:
    names = z.namelist()
    print(f"ZIP 包含 {len(names)} 个文件")

# 解压
print("正在解压...")
sys.stdout.flush()
with zipfile.ZipFile(str(zip_path)) as z:
    z.extractall(str(dest))

# 查找 bin 目录
for p in dest.iterdir():
    if p.is_dir():
        bin_dir = p / "bin"
        if bin_dir.exists():
            print(f"FFmpeg bin 目录: {bin_dir}")
            # 验证
            ffmpeg_exe = bin_dir / "ffmpeg.exe"
            if ffmpeg_exe.exists():
                print(f"ffmpeg.exe 大小: {ffmpeg_exe.stat().st_size / 1024 / 1024:.1f} MB")
            # 列出 DLL
            dlls = list(bin_dir.glob("*.dll"))
            print(f"DLL 文件数: {len(dlls)}")
            break

# 删除 zip
zip_path.unlink()
print("完成!")
