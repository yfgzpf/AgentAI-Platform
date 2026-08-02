"""Start TTS service with HF_HOME set"""
import os
import subprocess
import sys

os.environ["HF_HOME"] = r"F:\agentai-platform\.cache\huggingface"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

# Change to app dir
app_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(app_dir)

proc = subprocess.Popen(
    [sys.executable, "app.py"],
    stdout=sys.stdout,
    stderr=sys.stderr,
    env=os.environ,
)

print(f"TTS service started (PID={proc.pid})", flush=True)
proc.wait()
