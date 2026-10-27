"""Her cached greetings.

Each greeting is rendered once with OmniVoice and kept as 16-bit mono wav next to the
voice-clone prompt (models/omnivoice/greet-N.wav), so the next boot says it instantly
without the engine loaded. The id names the file: never renumber it.
"""

from __future__ import annotations

import os
import re
import wave
from pathlib import Path

import numpy as np

VALID_ID = re.compile(r"^greet-[A-Za-z0-9_-]+$")


def greet_path(models_dir, greet_id) -> Path | None:
    """models/omnivoice/<id>.wav, or None when the id is not a plain greeting name."""
    ident = str(greet_id or "").strip()
    if not VALID_ID.match(ident):
        return None
    return Path(models_dir) / "omnivoice" / f"{ident}.wav"


def write_wav(path: Path, pcm, sr: int) -> None:
    """Atomically store float samples as 16-bit mono wav (a half-written file is useless)."""
    data = np.clip(np.asarray(pcm, dtype=np.float32).reshape(-1), -1.0, 1.0)
    frames = (data * 32767.0).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with wave.open(str(tmp), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(int(sr))
        out.writeframes(frames.tobytes())
    os.replace(tmp, path)


def read_wav(path: Path) -> tuple[np.ndarray, int] | None:
    """The cached samples, or None when the file is missing or not a mono 16-bit wav."""
    try:
        with wave.open(str(path), "rb") as src:
            if src.getnchannels() != 1 or src.getsampwidth() != 2:
                return None
            sr = src.getframerate()
            raw = src.readframes(src.getnframes())
    except (OSError, EOFError, wave.Error):
        return None
    if not raw or sr <= 0:
        return None
    pcm = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32767.0
    return pcm, int(sr)
