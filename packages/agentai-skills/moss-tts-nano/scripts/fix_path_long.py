"""最终修复: 将 _resolve_hf_cache_dir 改为使用短路径"""
import pathlib

# Use raw string for \\?\ prefix
f = pathlib.Path(
    R"\\?\F:\agentai-platform\.cache\huggingface\modules\transformers_modules"
    R"\OpenMOSS_hyphen_Team\MOSS_hyphen_TTS_hyphen_Nano"
    R"\44502f80dbf9743528fa921cc544d662c685ebec\modeling_moss_tts_nano.py"
)

content = f.read_text(encoding="utf-8")

old = """    @staticmethod
    def _resolve_hf_cache_dir() -> str:
        cache_dir = Path(__file__).resolve().parent / ".cache" / "huggingface"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return str(cache_dir)"""

new = """    @staticmethod
    def _resolve_hf_cache_dir() -> str:
        import os
        hf_home = os.environ.get("HF_HOME", str(Path.home() / ".cache" / "huggingface"))
        cache_dir = Path(hf_home) / "hub"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return str(cache_dir)"""

if old in content:
    content = content.replace(old, new)
    f.write_text(content, encoding="utf-8")
    print("PATCHED: _resolve_hf_cache_dir now uses HF_HOME")
else:
    print("OLD pattern not found. Current code:")
    lines = content.split("\n")
    for i, line in enumerate(lines[1103:1113], 1103):
        print(f"  {i}: {line}")
