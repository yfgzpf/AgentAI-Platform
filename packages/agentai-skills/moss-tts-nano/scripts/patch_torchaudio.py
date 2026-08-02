"""补丁 torchaudio._torchcodec.py: 当 torchcodec 不可用时降级到 soundfile"""
import pathlib

p = pathlib.Path("C:/Python314/Lib/site-packages/torchaudio/_torchcodec.py")
content = p.read_text(encoding="utf-8")

# === 1. 补丁 load_with_torchcodec ===
old_load = """    # Import torchcodec here to provide clear error if not available
    try:
        from torchcodec.decoders import AudioDecoder
    except ImportError as e:
        raise ImportError(
            "TorchCodec is required for load_with_torchcodec. " "Please install torchcodec to use this function."
        ) from e"""

new_load = """    # Import torchcodec here to provide clear error if not available
    # PATCHED: fall back to soundfile when torchcodec is not available
    try:
        from torchcodec.decoders import AudioDecoder
    except ImportError:
        import soundfile as sf
        data, sr = sf.read(uri, dtype="float32", always_2d=True)
        if not channels_first:
            tensor = torch.from_numpy(data)  # [time, channels]
        else:
            tensor = torch.from_numpy(data.T)  # [channels, time]
        return tensor, int(sr)"""

# === 2. 补丁 save_with_torchcodec ===
old_save = """    try:
        from torchcodec.encoders import AudioEncoder
    except ImportError as e:
        raise ImportError(
            "TorchCodec is required for save_with_torchcodec. " "Please install torchcodec to use this function."
        ) from e"""

new_save = """    try:
        from torchcodec.encoders import AudioEncoder
    except ImportError:
        import soundfile as sf
        import numpy as np
        arr = src.detach().cpu().numpy()
        if arr.ndim == 2:
            arr = arr.T  # [channels, time] -> [time, channels]
        sf.write(str(uri), arr, int(sample_rate))
        return"""

changes = 0
if old_load in content:
    content = content.replace(old_load, new_load)
    changes += 1
if old_save in content:
    content = content.replace(old_save, new_save)
    changes += 1

p.write_text(content, encoding="utf-8")
print(f"PATCHED: {changes} changes made to torchaudio._torchcodec.py")
if changes < 2:
    print("WARNING: Not all patches were applied!")
