"""修复模型代码中的 _resolve_hf_cache_dir 函数"""
import pathlib

f = pathlib.Path(
    r"\\?\F:\agentai-platform\.cache\huggingface\modules\transformers_modules"
    r"\OpenMOSS_hyphen_Team\MOSS_hyphen_TTS_hyphen_Nano"
    r"\44502f80dbf9743528fa921cc544d662c685ebec\modeling_moss_tts_nano.py"
)

content = f.read_text(encoding="utf-8")

# The corrupted section to replace
old = """    @staticmethod
    # MODIFIED: use HF_HOME instead of modules-relative path (Windows MAX_PATH fix)
    def _resolve_hf_cache_dir() -> str:
        import os
        hf_home = os.environ.get("HF_HOME", str(Path.home() / ".cache" / "huggingface"))
        cache_dir = Path(hf_home) / "hub"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return str(cache_dir)
    # ORIGINAL_CODE_REMOVED
        cache_dir = Path(__file__).resolve().parent / ".cache" / "huggingface"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return str(cache_dir)

    @staticmethod
    def _patch_hf_dynamic_module_cache_dir(cache_dir: str) -> None:
        import transformers.dynamic_module_utils as dynamic_module_utils

        modules_cache_dir = str(Path(cache_dir) / "modules")
        Path(modules_cache_dir).mkdir(parents=True, exist_ok=True)"""

new = """    @staticmethod
    def _resolve_hf_cache_dir() -> str:
        cache_dir = Path(__file__).resolve().parent / ".cache" / "huggingface"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return str(cache_dir)

    @staticmethod
    def _patch_hf_dynamic_module_cache_dir(cache_dir: str) -> None:
        import transformers.dynamic_module_utils as dynamic_module_utils

        modules_cache_dir = str(Path(cache_dir) / "modules")
        Path(modules_cache_dir).mkdir(parents=True, exist_ok=True)"""

if old in content:
    content = content.replace(old, new)
    f.write_text(content, encoding="utf-8")
    print("RESTORED to original")
else:
    print("OLD string not found, checking content...")
    lines = content.split("\n")
    for i, line in enumerate(lines[1100:1130], 1100):
        print(f"{i}: {line}")
