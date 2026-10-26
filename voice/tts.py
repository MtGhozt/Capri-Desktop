"""Swappable TTS engines. speak(text) -> (float32 PCM, sample_rate)."""
from __future__ import annotations

import gc
import hashlib
import os
import time
import urllib.request
from abc import ABC, abstractmethod
from pathlib import Path

import numpy as np

from heavy import import_omnivoice, import_torch
from tts_text import clean_for_tts

KOKORO_ONNX_URL = (
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
)
KOKORO_VOICES_URL = (
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
)
KOKORO_VOICE = "ef_dora"
KOKORO_LANG = "es"
OMNI_MODEL = "k2-fsa/OmniVoice"
OMNI_MIN_GPU_MIB = 2000
OMNI_CPU_MAX_MS = 3000
DEFAULT_TTS_STEPS = 16
DEFAULT_REF = Path("ref") / "capri_ref_short.wav"


class SlowCpuTTS(RuntimeError):
    """OmniVoice on CPU took longer than OMNI_CPU_MAX_MS for the first phrase."""


class TTSEngine(ABC):
    @abstractmethod
    def speak(self, text: str) -> tuple[np.ndarray, int]:
        raise NotImplementedError

    def close(self) -> None:
        """Drop the engine's weights; subclasses that hold CUDA memory free it here."""


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


def ref_cache_key(wav: Path, txt: Path) -> str:
    digest = hashlib.sha256()
    digest.update(wav.read_bytes())
    digest.update(b"\0")
    digest.update(txt.read_bytes() if txt.exists() else b"")
    return digest.hexdigest()[:16]


def resolve_ref(voice_dir: Path, tts_ref) -> tuple[Path, Path]:
    root = Path(voice_dir)
    raw = str(tts_ref).strip() if tts_ref else ""
    wav = Path(raw) if raw else root / DEFAULT_REF
    if not wav.is_absolute():
        wav = root / wav
    return wav, wav.with_suffix(".txt")


def tts_steps(value, default: int = DEFAULT_TTS_STEPS) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return min(32, max(8, n))


def normalize_pcm(pcm, peak_db: float = -1.0) -> np.ndarray:
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak < 1e-6:
        return samples
    target = float(10 ** (peak_db / 20.0))
    return samples * (target / peak)


def _speed(value) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        n = 1.0
    return min(2.0, max(0.5, n))


def _is_oom(err: BaseException) -> bool:
    if err.__class__.__name__ == "OutOfMemoryError":
        return True
    text = str(err).lower()
    return "out of memory" in text or "cuda oom" in text


def _release_cuda() -> None:
    gc.collect()
    try:
        torch = import_torch()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
    except Exception:
        pass


def release_memory() -> None:
    """Public hook: drop unreferenced weights and return cached blocks to the driver."""
    _release_cuda()


class KokoroTTS(TTSEngine):
    def __init__(self, models_dir: Path, log, speed: float = 1.0):
        self.models_dir = models_dir
        self.log = log
        self.speed = _speed(speed)
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
        self.log(f"kokoro ready voice={KOKORO_VOICE} lang={KOKORO_LANG} speed={self.speed}")
        self.warmup()

    def close(self) -> None:
        self._kokoro = None
        _release_cuda()

    def warmup(self) -> float:
        t0 = time.perf_counter()
        pcm, sr = self.speak("Hola.")
        ms = (time.perf_counter() - t0) * 1000
        self.log(f"kokoro warmup {ms:.0f}ms samples={pcm.size} sr={sr}")
        return ms

    def speak(self, text: str) -> tuple[np.ndarray, int]:
        cleaned = clean_for_tts(text)
        if not cleaned or self._kokoro is None:
            return np.zeros(0, dtype=np.float32), 24000
        samples, sr = self._kokoro.create(cleaned, voice=KOKORO_VOICE, speed=self.speed, lang=KOKORO_LANG)
        pcm = np.asarray(samples, dtype=np.float32).reshape(-1)
        return pcm, int(sr)


class OmniVoiceTTS(TTSEngine):
    def __init__(self, models_dir: Path, log, wav: Path, txt: Path, speed: float = 1.0, steps: int = DEFAULT_TTS_STEPS):
        self.models_dir = models_dir
        self.log = log
        self.wav = wav
        self.txt = txt
        self.speed = _speed(speed)
        self.steps = tts_steps(steps)
        self.device = "cpu"
        self._model = None
        self._prompt = None
        self._first = True

    def close(self) -> None:
        self._model = None
        self._prompt = None
        _release_cuda()

    def load(self, *, allow_cpu: bool, free_vram: int) -> None:
        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        os.environ.setdefault("HF_HOME", str(self.models_dir / "hf"))
        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        torch, OmniVoice, VoiceClonePrompt = import_omnivoice(self.log)

        if not self.wav.is_file():
            raise FileNotFoundError(f"tts ref missing: {self.wav}")
        transcript = self.txt.read_text(encoding="utf-8").strip() if self.txt.is_file() else ""
        if not transcript:
            raise RuntimeError(f"tts ref transcript missing: {self.txt} (refusing OmniVoice ASR)")

        cuda_ok = bool(torch.cuda.is_available()) and int(free_vram or 0) >= OMNI_MIN_GPU_MIB
        self.log(f"omnivoice vram free ~{free_vram} MiB cuda={torch.cuda.is_available()} min={OMNI_MIN_GPU_MIB}")
        if cuda_ok:
            try:
                self._boot(OmniVoice, VoiceClonePrompt, torch, "cuda:0", torch.float16, transcript)
                return
            except Exception as err:
                self.close()
                if _is_oom(err):
                    self.log(f"omnivoice GPU OOM, released: {err}")
                else:
                    self.log(f"omnivoice GPU failed: {err}")
                    if not allow_cpu:
                        raise
        elif not allow_cpu:
            raise RuntimeError(f"omnivoice skipped GPU: vram {free_vram} MiB < {OMNI_MIN_GPU_MIB}")

        if not allow_cpu:
            raise RuntimeError("omnivoice GPU unavailable")
        self._boot(OmniVoice, VoiceClonePrompt, torch, "cpu", torch.float32, transcript)
        ms = self.warmup()
        if ms > OMNI_CPU_MAX_MS:
            self.close()
            raise SlowCpuTTS(f"omnivoice CPU first phrase {ms:.0f}ms > {OMNI_CPU_MAX_MS}ms")

    def _boot(self, OmniVoice, VoiceClonePrompt, torch, device: str, dtype, transcript: str) -> None:
        self.device = device
        t0 = time.perf_counter()
        kwargs = {"device_map": device, "dtype": dtype, "load_asr": False}
        try:
            self._model = OmniVoice.from_pretrained(OMNI_MODEL, **kwargs)
        except TypeError:
            kwargs.pop("load_asr", None)
            self._model = OmniVoice.from_pretrained(OMNI_MODEL, **kwargs)
        load_ms = (time.perf_counter() - t0) * 1000
        allocated = 0
        if device.startswith("cuda") and torch.cuda.is_available():
            allocated = int(torch.cuda.memory_allocated() / (1024 * 1024))
        self.log(f"omnivoice loaded device={device} {load_ms:.0f}ms allocated={allocated}MiB")
        self._load_prompt(VoiceClonePrompt, transcript)
        if device.startswith("cuda"):
            self.warmup()

    def _load_prompt(self, VoiceClonePrompt, transcript: str) -> None:
        cache_dir = self.models_dir / "omnivoice"
        cache_dir.mkdir(parents=True, exist_ok=True)
        key = ref_cache_key(self.wav, self.txt)
        dest = cache_dir / f"capri-{key}.pt"
        if dest.is_file():
            try:
                self._prompt = VoiceClonePrompt.load(str(dest))
                self.log(f"omnivoice prompt cache hit {dest.name}")
                return
            except Exception as err:
                self.log(f"omnivoice prompt cache bad {dest.name}: {err}")
        self._prompt = self._model.create_voice_clone_prompt(
            ref_audio=str(self.wav),
            ref_text=transcript,
        )
        self._prompt.save(str(dest))
        self.log(f"omnivoice prompt cached {dest.name}")

    def warmup(self) -> float:
        t0 = time.perf_counter()
        pcm, sr = self.speak("Hola.")
        ms = (time.perf_counter() - t0) * 1000
        self.log(f"omnivoice warmup {ms:.0f}ms device={self.device} samples={pcm.size} sr={sr}")
        return ms

    def speak(self, text: str) -> tuple[np.ndarray, int]:
        cleaned = clean_for_tts(text)
        if not cleaned or self._model is None or self._prompt is None:
            return np.zeros(0, dtype=np.float32), 24000
        t0 = time.perf_counter()
        kwargs = {
            "text": cleaned,
            "voice_clone_prompt": self._prompt,
            "speed": self.speed,
            "num_step": self.steps,
        }
        try:
            from omnivoice.models.omnivoice import OmniVoiceGenerationConfig
            kwargs["generation_config"] = OmniVoiceGenerationConfig(num_step=self.steps)
        except Exception:
            pass
        try:
            audio = self._model.generate(**kwargs)
        except TypeError:
            kwargs.pop("generation_config", None)
            kwargs.pop("num_step", None)
            audio = self._model.generate(**kwargs)
        pcm = np.asarray(audio[0] if isinstance(audio, (list, tuple)) else audio, dtype=np.float32).reshape(-1)
        ms = (time.perf_counter() - t0) * 1000
        tag = "first phrase" if self._first else "phrase"
        self._first = False
        self.log(f"omnivoice {tag} {ms:.0f}ms device={self.device} chars={len(cleaned)} steps={self.steps}")
        return pcm, 24000


def load_kokoro(models_dir: Path, log, speed: float = 1.0) -> TTSEngine:
    engine = KokoroTTS(models_dir, log, speed)
    try:
        engine.load()
        return engine
    except Exception as err:
        log(f"kokoro unavailable: {err}")
        return NullTTS()


def load_engine(
    kind: str,
    models_dir: Path,
    log,
    *,
    voice_dir: Path | None = None,
    tts_ref=None,
    tts_speed=1.0,
    tts_steps_n=DEFAULT_TTS_STEPS,
    free_vram: int = 0,
    usable_vram: int | None = None,
    notice=None,
) -> TTSEngine:
    name = str(kind or "auto").strip().lower()
    speed = _speed(tts_speed)
    free = int(free_vram or 0)
    usable = int(free if usable_vram is None else usable_vram)

    def decided(engine: str, reason: str, loaded: TTSEngine) -> TTSEngine:
        log(f"tts engine={engine} reason={reason} vram_free={free} vram_usable={usable}")
        return loaded

    if name in ("off", "none", "false"):
        return decided("off", "tts=off", NullTTS())

    warn = notice or (lambda _m: None)
    want_omni = name in ("auto", "omnivoice")
    allow_cpu = name == "omnivoice"
    if want_omni:
        wav, txt = resolve_ref(Path(voice_dir or models_dir.parent), tts_ref)
        omni = OmniVoiceTTS(models_dir, log, wav, txt, speed, tts_steps(tts_steps_n))
        try:
            omni.load(allow_cpu=allow_cpu, free_vram=usable)
            return decided("omnivoice", f"gpu device={omni.device}", omni)
        except SlowCpuTTS as err:
            omni.close()
            msg = f"{err}; falling back to Kokoro"
            log(msg)
            warn(msg)
            return decided("kokoro", "omnivoice-cpu-slow", load_kokoro(models_dir, log, speed))
        except Exception as err:
            omni.close()
            log(f"omnivoice unavailable: {err}")
            if name == "omnivoice":
                warn(f"OmniVoice failed ({err}); using Kokoro")
            return decided("kokoro", f"omnivoice-failed:{err}", load_kokoro(models_dir, log, speed))

    return decided("kokoro", f"tts={name}", load_kokoro(models_dir, log, speed))
