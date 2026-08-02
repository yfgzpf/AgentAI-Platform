"""下载 FFmpeg DLL 并复制到 torchcodec 目录"""
import urllib.request
import zipfile
import pathlib
import shutil
import sys
import os
import stat

# 1. 删除旧 zip
zip_path = pathlib.Path("f:/agentai-platform/.cache/ffmpeg.zip")
if zip_path.exists():
    zip_path.unlink()
    
# 2. 删除旧提取目录
extract_dir = pathlib.Path("f:/agentai-platform/.cache/ffmpeg_dl")
if extract_dir.exists():
    shutil.rmtree(str(extract_dir), ignore_errors=True)

# 3. 下载 FFmpeg
url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
print("下载 FFmpeg...")
sys.stdout.flush()
urllib.request.urlretrieve(url, str(zip_path))
print(f"下载完成: {zip_path.stat().st_size / 1024 / 1024:.0f} MB")
sys.stdout.flush()

# 4. 解压
print("解压中...")
sys.stdout.flush()
with zipfile.ZipFile(str(zip_path)) as z:
    names = z.namelist()
    # 找到 bin 目录
    bin_prefix = None
    for n in names:
        if "/bin/" in n and n.endswith(".dll"):
            prefix = n.split("/bin/")[0]
            if bin_prefix is None:
                bin_prefix = prefix
            break
    if not bin_prefix:
        print("找不到 bin 目录!")
        sys.exit(1)
    print(f"提取前缀: {bin_prefix}")
    # 只提取 bin 目录下的 DLL
    dll_files = [n for n in names if n.startswith(f"{bin_prefix}/bin/") and n.endswith(".dll")]
    exe_files = [n for n in names if n.startswith(f"{bin_prefix}/bin/") and (n.endswith(".exe"))]
    print(f"DLL 数量: {len(dll_files)}, EXE 数量: {len(exe_files)}")
    for f in dll_files + exe_files:
        z.extract(f, str(extract_dir))

# 5. 找到 bin 目录
bin_dir = extract_dir / bin_prefix / "bin"
print(f"FFmpeg bin: {bin_dir}")
print(f"  DLL 数: {len(list(bin_dir.glob('*.dll')))}")
print(f"  EXE 数: {len(list(bin_dir.glob('*.exe')))}")

# 6. 复制 DLL 到 torchcodec 目录
torchcodec_dir = pathlib.Path("C:/Users/Administrator/AppData/Roaming/Python/Python314/site-packages/torchcodec")
if torchcodec_dir.exists():
    dlls = list(bin_dir.glob("*.dll"))
    for dll in dlls:
        shutil.copy2(str(dll), str(torchcodec_dir / dll.name))
    print(f"复制 {len(dlls)} 个 DLL 到 torchcodec 目录")
else:
    print(f"torchcodec 目录不存在: {torchcodec_dir}")
    # 可能安装到系统 site-packages
    for p in [pathlib.Path("C:/Python314/Lib/site-packages/torchcodec")]:
        if p.exists():
            dlls = list(bin_dir.glob("*.dll"))
            for dll in dlls:
                shutil.copy2(str(dll), str(p / dll.name))
            print(f"复制 {len(dlls)} 个 DLL 到 {p}")
            break

# 7. 清理
zip_path.unlink(missing_ok=True)
shutil.rmtree(str(extract_dir), ignore_errors=True)

print("完成! 请重新安装 torchcodec")
