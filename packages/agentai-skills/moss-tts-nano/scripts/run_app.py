"""Run app.py and capture errors to stderr"""
import sys
import os
import traceback

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.getcwd())

try:
    import app
    # app should have uvicorn.run() call - we don't need to do anything
    print(f"app.py loaded successfully", flush=True)
except Exception:
    traceback.print_exc()
    sys.exit(1)
