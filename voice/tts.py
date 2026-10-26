"""Swappable TTS engines. speak(text) -> (float32 PCM, sample_rate)."""
from __future__ import annotations

import time
import urllib.request
from abc import ABC, abstractmethod
from pathlib import Path

import numpy as np

from tts_text import clean_for_tts

KOKORO_ONNX_URL = (
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
)
KOKORO_VOICES_URL = (
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
)
KOKORO_VOICE = "ef_dora"
KOKORO_LANG = "es"


class TTSEngine(ABC):
    @abstractmethod
    def speak(self, text: str) -> tuple[np.ndarray, int]:
        raise NotImplementedError


class NullTTS(TTSEngine):
    def speak(self, text: str) -> tuple[np.ndarray, int]:
        return np.zeros(0, dtype=np.float32), 24000


def _download(url: str, dest: Path, log) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        return
    log(f"downloading {dest.name}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "capri-desktop"})
    with urllib.request.urlopen(req) as res, open(tmp, "wb") as out:
        out.write(res.read())
    tmp.replace(dest)


class KokoroTTS(TTSEngine):
    def __init__(self, models_dir: Path, log):
        self.models_dir = models_dir
        self.log = log
        self._kokoro = None

    def load(self) -> None:
        try:
            import espeakng_loader
            espeakng_loader.make_library_available()
        except Exception:
            pass
        from kokoro_onnx import Kokoro

        dest = self.models_dir / "kokoro"
        onnx = dest / "kokoro-v1.0.onnx"
        voices = dest / "voices-v1.0.bin"
        _download(KOKORO_ONNX_URL, onnx, self.log)
        _download(KOKORO_VOICES_URL, voices, self.log)
        self._kokoro = Kokoro(str(onnx), str(voices))
        self.log(f"kokoro ready voice={KOKORO_VOICE} lang={KOKORO_LANG}")
        self.warmup()

    def warmup(self) -> None:
        t0 = time.perf_counter()
        pcm, sr = self.speak("Hola.")
        ms = (time.perf_counter() - t0) * 1000
        self.log(f"kokoro warmup {ms:.0f}ms samples={pcm.size} sr={sr}")

    def speak(self, text: str) -> tuple[np.ndarray, int]:
        cleaned = clean_for_tts(text)
        if not cleaned or self._kokoro is None:
            return np.zeros(0, dtype=np.float32), 24000
        samples, sr = self._kokoro.create(cleaned, voice=KOKORO_VOICE, speed=1.0, lang=KOKORO_LANG)
        pcm = np.asarray(samples, dtype=np.float32).reshape(-1)
        return pcm, int(sr)


def load_engine(kind: str, models_dir: Path, log) -> TTSEngine:
    name = str(kind or "kokoro").strip().lower()
    if name in ("off", "none", "false"):
        log("tts off")
        return NullTTS()
    engine = KokoroTTS(models_dir, log)
    try:
        engine.load()
        return engine
    except Exception as err:
        log(f"kokoro unavailable: {err}")
        return NullTTS()
