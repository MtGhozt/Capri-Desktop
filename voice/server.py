"""Capri voice sidecar: mic -> VAD -> STT, TTS playback, local WebSocket on 127.0.0.1."""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.request
from pathlib import Path
from queue import Empty, Full, Queue

import numpy as np
import sounddevice as sd
import websockets

from greet import greet_path, read_wav, write_wav
from heavy import IMPORT_LOCK, import_whisper_model, preload_torch
from tts import (
    NullTTS,
    OmniVoiceTTS,
    load_kokoro,
    normalize_pcm,
    release_memory,
    resolve_ref,
    tts_steps,
    verify_ref_transcript,
)
from vram import GEMMA_RESERVE_MIB, VRAM_WARN_MIB, llm_has_model, usable_vram_mib

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"
SAMPLE_RATE = 16000
VAD_FRAME = 512
MIC_BLOCK = 4096
MIC_QUEUE = 48
WAKE_FRAME = 1280
MEDIUM_VRAM_MIB = 2800
LISTEN_TIMEOUT_S = 10.0
WHISPER_LOAD_S = 60.0
WAKE_ATTEMPTS = 3
PREFETCH = 2
SHORT_PHRASE = 20
MAX_SECONDS = 15
SILENCE_MS = 700
MIN_SPEECH_MS = 250
WAKE_THRESHOLD = 0.2
WAKE_WHILE_TALKING = 0.5
IDLE_TALK_S = 2.0
DEFAULT_IDLE_UNLOAD_MIN = 10.0
SPEECH_THRESHOLD = 0.5
PTT_HOLD_DELAY = 0.12
FOLLOW_MAX_S = 30.0
STT_PROMPT = "Capri, choom"
WAKE_NAMES = {"capri", "kapri", "cabri", "capry", "kapry"}
WAKE_PREFIX = {"hey", "hola", "oye", "ey", "oi", "che", "e"}
# fused Whisper mangling: "acapri", "heacapri", "ecapri", …
WAKE_MANGLED = re.compile(r"^(?:h?e+a?|a|e)?(?:capri|kapri|cabri|capry|kapry)$")
WAKE_FOLLOW_S = 6.0
WAKE_SPEECH_MAX_S = 3.0
WAKE_SILENCE_MS = 500.0
WAKE_MIN_SPEECH_MS = 200.0
SILERO_URL = (
    "https://github.com/snakers4/silero-vad/raw/v5.1.2/"
    "src/silero_vad/data/silero_vad.onnx"
)

VK_CONTROL = 0x11
VK_MENU = 0x12
VK_V = 0x56


os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
DEV = os.environ.get("CAPRI_DEV") == "1"


def log(msg: str) -> None:
    # stdout only: the Electron side timestamps it and writes voice.log (one line per event).
    print(f"[capri-voice] {msg}", flush=True)


def load_openwakeword():
    """Import the pip package, not a local file/folder named openwakeword."""
    blocked = {os.path.abspath(p) for p in (os.getcwd(), str(ROOT), str(MODELS))}
    saved = sys.path[:]
    sys.path[:] = [p for p in saved if p not in ("", ".") and os.path.abspath(p) not in blocked]
    try:
        with IMPORT_LOCK:
            import openwakeword  # noqa: F401
            from openwakeword.utils import download_models
            from openwakeword.model import Model
            if not hasattr(openwakeword, "FEATURE_MODELS"):
                raise RuntimeError("openwakeword import was shadowed (no FEATURE_MODELS)")
            return Model, download_models
    finally:
        sys.path[:] = saved


def free_vram_mib() -> int:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        return int(out.strip().splitlines()[0].split()[0])
    except Exception:
        return 0


def idle_unload_seconds(value, default: float = DEFAULT_IDLE_UNLOAD_MIN) -> float:
    """Minutes from config -> seconds; 0 disables the unload, bad values use the default."""
    try:
        minutes = float(value)
    except (TypeError, ValueError):
        minutes = default
    return max(0.0, minutes) * 60.0


def as_pcm16(frame: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(np.clip(frame * 32767.0, -32768, 32767).astype(np.int16))


BUILTIN_WAKE = ("alexa", "hey_mycroft", "hey_jarvis", "hey_rhasspy", "timer", "weather")

# openWakeWord ships a few models; anything else is a custom .onnx we train (docs/wake-word.md).
def resolve_wake_model(value, models: Path = MODELS) -> tuple[str, bool]:
    """wakeModel -> (name or path openWakeWord can load, whether we fell back to hey_jarvis)."""
    raw = str(value or "hey_capri").strip()
    looks_like_path = raw.lower().endswith(".onnx") or "/" in raw or "\\" in raw
    if looks_like_path:
        path = Path(raw)
        if not path.is_absolute():
            path = models / path
        return (str(path), False) if path.is_file() else ("hey_jarvis", True)
    if raw.lower() in BUILTIN_WAKE:
        return raw.lower(), False
    custom = models / f"{raw}.onnx"
    return (str(custom), False) if custom.is_file() else ("hey_jarvis", True)


def wake_score_max(scores) -> tuple[float, dict]:
    if not isinstance(scores, dict):
        scores = {"score": scores}
    out = {}
    for key, raw in scores.items():
        out[str(key)] = float(np.max(np.asarray(raw, dtype=np.float64)))
    return (max(out.values()) if out else 0.0), out


def fold_words(text: str) -> list[str]:
    """Lowercase words without accents or punctuation, for matching what Whisper wrote."""
    plain = unicodedata.normalize("NFD", str(text or ""))
    plain = "".join(ch for ch in plain if unicodedata.category(ch) != "Mn")
    return re.findall(r"[a-z0-9]+", plain.lower())


def is_hallucination(text: str, prompt: str = STT_PROMPT) -> bool:
    """Whisper on silence invents the prompt: "Matías, Matías, Matías" is not speech."""
    words = fold_words(text)
    if not words:
        return True
    if len(words) >= 3 and len(set(words)) == 1:
        return True
    allowed = set(fold_words(prompt)) | {"matias"}
    return all(word in allowed for word in words)


def _is_wake_name(word: str) -> bool:
    return word in WAKE_NAMES or bool(WAKE_MANGLED.match(word))


def _plain_tokens(text: str) -> list[str]:
    """Lowercase alphanumeric tokens aligned with whitespace-split words of `text`."""
    out = []
    for w in str(text or "").split():
        token = unicodedata.normalize("NFD", w)
        token = "".join(ch for ch in token if unicodedata.category(ch) != "Mn")
        out.append(re.sub(r"[^a-z0-9]+", "", token.lower()))
    return out


def strip_wake_phrase(text: str) -> str:
    """Drop a leading Capri wake form; empty means wake-only (nothing for the LLM)."""
    raw = str(text or "").strip()
    if not raw:
        return ""
    words = raw.split()
    plain = _plain_tokens(raw)
    if not plain or not plain[0]:
        return raw
    if plain[0] in WAKE_PREFIX and len(plain) > 1 and _is_wake_name(plain[1]):
        i = 2
    elif _is_wake_name(plain[0]):
        i = 1
    else:
        return raw
    rest = " ".join(words[i:])
    return re.sub(r"^[\s,.:;–—-]+", "", rest).strip()


def wake_command_text(text: str) -> str | None:
    """Remainder after a leading wake form, or None when the utterance is not a wake."""
    raw = str(text or "").strip()
    if not raw:
        return None
    stripped = strip_wake_phrase(raw)
    if stripped == raw:
        return None
    return stripped


def wake_phrase_match(text: str) -> bool:
    """True when the utterance starts with a Capri wake form (optional hey/hola/oye, mangled ok)."""
    return wake_command_text(text) is not None


def wasapi_extra_settings(device) -> object | None:
    """Shared-mode WASAPI only for a WASAPI device: other host APIs reject it (PaError -9984)."""
    if sys.platform != "win32" or not hasattr(sd, "WasapiSettings"):
        return None
    try:
        if device is None:
            device = sd.default.device[0]
        hostapi = int(sd.query_devices(device)["hostapi"])
        name = str(sd.query_hostapis(hostapi).get("name") or "")
    except Exception:
        return None
    if "WASAPI" not in name.upper():
        return None
    try:
        return sd.WasapiSettings(exclusive=False)
    except Exception:
        return None


def ptt_held() -> bool:
    if sys.platform != "win32":
        return False
    import ctypes
    down = ctypes.windll.user32.GetAsyncKeyState
    return bool(down(VK_CONTROL) & 0x8000 and down(VK_MENU) & 0x8000 and down(VK_V) & 0x8000)


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        return
    log(f"downloading {dest.name}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "capri-desktop"})
    with urllib.request.urlopen(req) as res, open(tmp, "wb") as out:
        out.write(res.read())
    tmp.replace(dest)


class EnergyVAD:
    def reset(self) -> None:
        pass

    def prob(self, frame: np.ndarray) -> float:
        rms = float(np.sqrt(np.mean(np.square(frame), dtype=np.float32)))
        return 1.0 if rms > 0.015 else 0.0


class SileroVAD:
    def __init__(self, path: Path):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        self.sess = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
        self.names = [i.name for i in self.sess.get_inputs()]
        self.reset()

    def reset(self) -> None:
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.h = np.zeros((2, 1, 64), dtype=np.float32)
        self.c = np.zeros((2, 1, 64), dtype=np.float32)

    def prob(self, frame: np.ndarray) -> float:
        x = np.asarray(frame, dtype=np.float32).reshape(1, -1)
        sr = np.array(SAMPLE_RATE, dtype=np.int64)
        feed = {}
        for name in self.names:
            low = name.lower()
            if low in ("input", "input_0", "x"):
                feed[name] = x
            elif low in ("sr", "sampling_rate"):
                feed[name] = sr
            elif low == "state":
                feed[name] = self.state
            elif low in ("h", "h0"):
                feed[name] = self.h
            elif low in ("c", "c0"):
                feed[name] = self.c
        out = self.sess.run(None, feed)
        p = float(np.asarray(out[0]).reshape(-1)[0])
        if len(out) > 1:
            arr = np.asarray(out[1])
            if arr.shape == self.state.shape:
                self.state = arr
            elif arr.shape == self.h.shape:
                self.h = arr
                if len(out) > 2:
                    self.c = np.asarray(out[2])
        return p


class Engine:
    def __init__(self, loop: asyncio.AbstractEventLoop, token: str):
        self.loop = loop
        self.token = token
        self.clients: set = set()
        self.cfg = {
            "enabled": True,
            "wakeWord": True,
            "wakeMode": "both",
            "wakeThreshold": WAKE_THRESHOLD,
            "wakeModel": "hey_capri",
            "sttModel": "auto",
            "language": "es",
            "inputDevice": None,
            "debugSave": False,
            "tts": "auto",
            "ttsRef": None,
            "ttsMoods": {
                "burla": "ref/capri_mood_burla.wav",
                "emocion": "ref/capri_mood_emocion.wav",
                "aburrida": "ref/capri_mood_aburrida.wav",
                "seria": "ref/capri_mood_seria.wav",
            },
            "ttsSpeed": 1.0,
            "ttsSteps": 16,
            "replyMode": "voice",
            "ttsIdleUnloadMin": DEFAULT_IDLE_UNLOAD_MIN,
            "sttIdleUnloadMin": DEFAULT_IDLE_UNLOAD_MIN,
            "sleeping": False,
            "llmBaseUrl": "http://localhost:1235/v1",
            "localLlm": True,
            "muted": False,
            "volume": 0.7,
        }
        self.stream = None
        self._mic_error = None
        self.capturing = False
        self.hold = False
        # follow-up: she asked something, the mic opens without the wake word for follow_s seconds;
        # no speech by then and it closes quietly (no transcript, no Whisper)
        self.follow = False
        self.follow_s = 0.0
        self.buffer = np.zeros(0, dtype=np.float32)
        self.vad_buf = np.zeros(0, dtype=np.float32)
        self.wake_buf = np.zeros(0, dtype=np.float32)
        # whisper wake: short utterance heard while asleep, checked for "capri"
        self.wake_audio = np.zeros(0, dtype=np.float32)
        self.wake_vad = np.zeros(0, dtype=np.float32)
        self.wake_speech_ms = 0.0
        self.wake_silence_ms = 0.0
        self._wake_stt = False
        self.speech_ms = 0.0
        self.silence_ms = 0.0
        self.started_at = 0.0
        self.last_level = 0.0
        self._whisper = None
        self._wake = None
        self._vad = None
        self._lock = threading.Lock()
        self._stt_lock = threading.Lock()
        self._models_lock = threading.Lock()
        self._cfg_ready = False
        self._level_t = 0.0
        self._wake_log_t = 0.0
        self._wake_logged_shape = False
        self._stt_beam = 5
        self._audio_q = Queue(maxsize=MIC_QUEUE)
        self._audio_thread = None
        self._audio_run = False
        self._tts = None
        self._omni = None
        self._omni_loading = False
        self._want_tts = False
        self._session_tts = None
        self._tts_lock = threading.Lock()
        self._synth_lock = threading.Lock()
        self._greet_lock = threading.Lock()
        self._greet_texts: dict[str, str] = {}
        self._greet_busy = False
        self._closed = False
        self._speak_q: Queue = Queue()
        self._prep_q: Queue = Queue()
        self._speak_stop = threading.Event()
        self._speaking = False
        self._synth_busy = False
        self._last_audio = 0.0
        self._accept_speak = True
        self._speak_gen = 0
        self._live_id = 0
        self._held_phrase = ""
        self._reply_mood = None
        self._out = None
        self._sleep_since = 0.0
        self._mic_off_since = 0.0
        self._synth_thread = threading.Thread(target=self._synth_loop, name="capri-tts-synth", daemon=True)
        self._synth_thread.start()
        self._play_thread = threading.Thread(target=self._play_loop, name="capri-tts-play", daemon=True)
        self._play_thread.start()
        self._idle_thread = threading.Thread(target=self._idle_watch, name="capri-tts-idle", daemon=True)
        self._idle_thread.start()

    def apply_cfg(self, patch: dict) -> None:
        before = (self.cfg.get("enabled"), self.cfg.get("inputDevice"))
        local_llm_before = self.cfg.get("localLlm", True)
        was_muted = bool(self.cfg.get("muted"))
        was_sleeping = bool(self.cfg.get("sleeping"))
        for key in self.cfg:
            if key in patch:
                self.cfg[key] = patch[key]
        now = time.monotonic()
        if bool(self.cfg.get("sleeping")):
            if not was_sleeping:
                self._sleep_since = now
        else:
            self._sleep_since = 0.0
        if bool(self.cfg.get("enabled")):
            self._mic_off_since = 0.0
        elif before[0]:
            self._mic_off_since = now
        after = (self.cfg.get("enabled"), self.cfg.get("inputDevice"))
        if after != before or self.stream_needed() != (self.stream is not None):
            self.restart_stream()
        if bool(self.cfg.get("muted")) and not was_muted:
            self.stop_speak()
        if self._omni is not None:
            self._omni.steps = tts_steps(self.cfg.get("ttsSteps"))
        if self.reply_mode() != "voice":
            # The overlay may change modes while the mic is muted, and then the
            # session skips start_tts(): release the engines from here too.
            self._want_tts = False
            self._drop_tts(f"replyMode={self.reply_mode()}")
        local_llm_changed = self.cfg.get("localLlm", True) is not local_llm_before
        if local_llm_changed and self.reply_mode() == "voice" and not self.cfg.get("sleeping"):
            self._drop_tts("localLlm-change")
            self.start_tts()
        self._cfg_ready = True

    def list_devices(self) -> list[dict]:
        devices = []
        for i, d in enumerate(sd.query_devices()):
            if int(d.get("max_input_channels") or 0) > 0:
                devices.append({"id": i, "name": d.get("name") or f"input {i}"})
        return devices

    def broadcast(self, payload: dict) -> None:
        data = json.dumps(payload)
        for ws in list(self.clients):
            asyncio.run_coroutine_threadsafe(self._send(ws, data), self.loop)

    async def _send(self, ws, data: str) -> None:
        try:
            await ws.send(data)
        except Exception:
            self.clients.discard(ws)

    def send_now(self, payload: dict) -> None:
        if threading.current_thread() is threading.main_thread():
            data = json.dumps(payload)
            for ws in list(self.clients):
                self.loop.create_task(self._send(ws, data))
        else:
            self.broadcast(payload)

    def _vram_budget(self) -> tuple[int, int, bool]:
        free = free_vram_mib()
        base = str(self.cfg.get("llmBaseUrl") or "http://localhost:1235/v1")
        # A cloud provider answers, so Gemma will never load here: the GPU is OmniVoice's (her own
        # voice), and reserving memory for a model that never comes only forced Kokoro.
        local_llm = self.cfg.get("localLlm", True) is not False
        loaded = llm_has_model(base) if local_llm else False
        usable = usable_vram_mib(free, loaded, GEMMA_RESERVE_MIB if local_llm else 0)
        reserve = 0 if loaded or not local_llm else GEMMA_RESERVE_MIB
        log(f"vram free ~{free} MiB usable ~{usable} MiB llm_loaded={int(loaded)} reserve={reserve}")
        return free, usable, loaded

    def _tts_wants_gpu(self) -> bool:
        return str(self.cfg.get("tts") or "auto").lower() in ("auto", "omnivoice")

    def ensure_stt(self) -> None:
        with self._stt_lock:
            MODELS.mkdir(parents=True, exist_ok=True)
            if self._vad is None:
                path = MODELS / "silero_vad.onnx"
                try:
                    download(SILERO_URL, path)
                    self._vad = SileroVAD(path)
                    log("silero vad ready")
                except Exception as err:
                    log(f"silero vad fallback to energy: {err}")
                    self._vad = EnergyVAD()
            if self._wake is None and self.cfg.get("wakeWord") and self.wake_mode() != "whisper":
                self._wake = self._load_wake()
            if self._whisper is None:
                self._whisper = self._load_whisper()

    def ensure_models(self) -> None:
        self.ensure_stt()
        if self._cfg_ready:
            self.start_tts()

    def _unload_whisper(self) -> None:
        with self._stt_lock:
            whisper = self._whisper
            self._whisper = None
        if whisper is None:
            return
        del whisper
        try:
            release_memory()
        except Exception:
            pass
        log(f"stt unloaded reason=mic-idle vram_free={free_vram_mib()}")

    def _load_wake(self):
        model, fell_back = resolve_wake_model(self.cfg.get("wakeModel"))
        if fell_back:
            log(f"wake model {self.cfg.get('wakeModel') or 'hey_capri'} not found, using hey_jarvis")
        last_err = None
        for attempt in range(1, WAKE_ATTEMPTS + 1):
            try:
                Model, download_models = load_openwakeword()
                # a custom .onnx is already on disk; a built-in name is downloaded once
                if not model.lower().endswith(".onnx"):
                    download_models(model_names=[model], target_directory=str(MODELS))
                    download_models(model_names=[model])
                wake = Model(wakeword_models=[model], inference_framework="onnx")
                log(f"wake word {model} ready threshold={self.wake_threshold()}")
                return wake
            except Exception as err:
                last_err = err
                log(f"wake word failed attempt={attempt}/{WAKE_ATTEMPTS}: {err}")
                time.sleep(0.4 * attempt)
        log(f"wake word unavailable: {last_err}")
        self.broadcast({"type": "notice", "message": f"Wake word no arrancó: {last_err}"})
        return False

    def _load_whisper(self):
        WhisperModel = import_whisper_model()
        root = str(MODELS / "whisper")
        wanted = str(self.cfg.get("sttModel") or "auto").lower()
        self._stt_beam = 5
        free, usable, _loaded = self._vram_budget()
        keep_gpu = self._tts_wants_gpu()
        try_medium = (
            not keep_gpu
            and wanted in ("auto", "medium")
            and usable >= MEDIUM_VRAM_MIB
        )
        if try_medium:
            try:
                log(f"loading whisper medium (cuda float16) vram_free={free} vram_usable={usable}")
                model = self._whisper_boot(WhisperModel, "medium", "cuda", "float16", root)
                return model
            except Exception as err:
                log(f"whisper medium cuda failed: {err}")
        name = "small" if wanted in ("auto", "medium") else wanted
        if name not in ("base", "small", "medium"):
            name = "small"
        reason = "tts keeps gpu for omnivoice" if keep_gpu else "cpu"
        log(
            f"loading whisper {name} (cpu int8) reason={reason} beam={self._stt_beam} "
            f"vram_free={free} vram_usable={usable}"
        )
        try:
            return self._whisper_boot(WhisperModel, name, "cpu", "int8", root)
        except Exception as err:
            log(f"whisper failed: {err}")
            raise

    def _whisper_boot(self, WhisperModel, name, device, compute, root):
        timed_out = {"hit": False}

        def on_timeout():
            timed_out["hit"] = True
            log(f"whisper load timeout after {WHISPER_LOAD_S:.0f}s name={name} device={device}")
            self.broadcast({
                "type": "notice",
                "message": f"Whisper no terminó de cargar en {WHISPER_LOAD_S:.0f}s.",
            })

        timer = threading.Timer(WHISPER_LOAD_S, on_timeout)
        timer.daemon = True
        timer.start()
        t0 = time.perf_counter()
        try:
            model = WhisperModel(name, device=device, compute_type=compute, download_root=root)
        finally:
            timer.cancel()
        ms = (time.perf_counter() - t0) * 1000
        tag = f"{name} {device}"
        log(f"whisper ready name={name} device={device} {ms:.0f}ms")
        if timed_out["hit"]:
            log(f"whisper ready after timeout ({tag})")
        return model

    def wake_threshold(self) -> float:
        try:
            value = float(self.cfg.get("wakeThreshold"))
        except (TypeError, ValueError):
            value = WAKE_THRESHOLD
        if value <= 0 or value >= 1:
            value = WAKE_THRESHOLD
        if self._speaking:
            return max(value, WAKE_WHILE_TALKING)
        return value

    def _set_speaking(self, on: bool) -> None:
        on = bool(on)
        if on == bool(self._speaking):
            self._speaking = on
            return
        self._speaking = on
        log(f"wake threshold -> {self.wake_threshold():.2f}")

    def _note_audio(self) -> None:
        self._last_audio = time.monotonic()

    def _maybe_idle_talk(self) -> None:
        if not self._speaking:
            return
        if self._synth_busy or self._out is not None:
            return
        if not self._speak_q.empty() or not self._prep_q.empty():
            return
        if self._last_audio and time.monotonic() - self._last_audio < IDLE_TALK_S:
            return
        log("talking_done idle-timeout")
        self._set_speaking(False)
        self.broadcast({"type": "talking_done", "skipped": False})

    def _listen_limit(self) -> float:
        # a follow-up window gives the answer the usual time once it may have started
        return LISTEN_TIMEOUT_S + (self.follow_s if self.follow else 0.0)

    def _follow_quiet(self, elapsed: float) -> bool:
        return self.follow and self.speech_ms < MIN_SPEECH_MS and elapsed >= self.follow_s

    def _maybe_listen_timeout(self) -> None:
        if not self.capturing or self.hold:
            return
        elapsed = time.monotonic() - self.started_at
        if self._follow_quiet(elapsed):
            asyncio.run_coroutine_threadsafe(self.finish(reason="follow-quiet"), self.loop)
            return
        if elapsed < self._listen_limit():
            return
        log(
            f"listen timeout after {self._listen_limit():.0f}s "
            f"speech_ms={self.speech_ms:.0f} silence_ms={self.silence_ms:.0f} samples={self.buffer.size}"
        )
        asyncio.run_coroutine_threadsafe(self.finish(reason="timeout"), self.loop)

    def _idle_watch(self) -> None:
        while True:
            # Quicker while speaking / listening; slower when idle (fewer wakeups).
            busy = self._speaking or self.capturing or bool(getattr(self, "_wake_stt", False))
            time.sleep(0.25 if busy else 1.0)
            try:
                self._maybe_idle_talk()
                self._maybe_listen_timeout()
                self._maybe_unload_idle()
            except Exception:
                pass

    def _maybe_unload_idle(self) -> None:
        """DORMANT or muted for long enough: give the GPU/CPU models back."""
        now = time.monotonic()
        tts_limit = idle_unload_seconds(self.cfg.get("ttsIdleUnloadMin"))
        if tts_limit > 0 and self._sleep_since and now - self._sleep_since >= tts_limit:
            if self._omni is not None or self._omni_loading:
                self._want_tts = False
                self._drop_tts("dormant-idle")
        stt_limit = idle_unload_seconds(self.cfg.get("sttIdleUnloadMin"))
        if stt_limit > 0 and self._mic_off_since and now - self._mic_off_since >= stt_limit:
            if self._whisper is not None:
                self._unload_whisper()

    def stream_needed(self) -> bool:
        """Who needs the mic: not her while asleep with no wake word, not while muted."""
        if not self.cfg.get("enabled"):
            return False
        if self.cfg.get("muted"):
            return False
        return not (self.cfg.get("sleeping") and not self.cfg.get("wakeWord"))

    def restart_stream(self) -> None:
        self.stop_stream()
        if not self.stream_needed():
            self._mic_error = None
            log(
                f"mic released enabled={bool(self.cfg.get('enabled'))} "
                f"muted={bool(self.cfg.get('muted'))} sleeping={bool(self.cfg.get('sleeping'))} "
                f"wake={bool(self.cfg.get('wakeWord'))}"
            )
            self.broadcast({"type": "mic", "open": False, "needed": False, "message": ""})
            return
        device = None
        raw = self.cfg.get("inputDevice")
        if raw is not None and str(raw) != "":
            try:
                device = int(raw)
            except (TypeError, ValueError):
                device = None
        # shared mode: exclusive WASAPI would lock the mic away from push-to-talk apps
        extra = wasapi_extra_settings(device)
        try:
            self._audio_q = Queue(maxsize=MIC_QUEUE)
            self._audio_run = True
            self._audio_thread = threading.Thread(target=self._audio_loop, name="capri-mic", daemon=True)
            self._audio_thread.start()
            self.stream = self._open_stream(device, extra)
        except Exception as err:
            if extra is None:
                self._mic_failed(err)
                return
            log(f"mic failed with WASAPI shared mode ({err}); retrying without extra settings")
            try:
                self.stream = self._open_stream(device, None)
            except Exception as retry:
                self._mic_failed(retry)
                return
        self._mic_error = None
        log(
            f"mic stream device={device if device is not None else 'default'} "
            f"sr={self.stream.samplerate} ch={self.stream.channels} "
            f"block={MIC_BLOCK} queue={MIC_QUEUE}"
        )
        self.broadcast({"type": "mic", "open": True, "needed": True, "message": ""})

    def _open_stream(self, device, extra):
        stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=MIC_BLOCK,
            latency="high",
            device=device,
            extra_settings=extra,
            callback=self._on_audio,
        )
        try:
            stream.start()
        except Exception:
            try:
                stream.close()
            except Exception:
                pass
            raise
        return stream

    def _mic_failed(self, err) -> None:
        log(f"mic failed: {err}")
        self.stream = None
        self._mic_error = str(err)
        self.broadcast({"type": "error", "message": str(err)})
        self.broadcast({"type": "mic", "open": False, "needed": True, "message": str(err)})
        self.stop_stream()

    def stop_stream(self) -> None:
        self._audio_run = False
        try:
            self._audio_q.put_nowait(None)
        except Exception:
            pass
        if self._audio_thread and self._audio_thread.is_alive() and threading.current_thread() is not self._audio_thread:
            self._audio_thread.join(timeout=1.5)
        self._audio_thread = None
        if self.stream is not None:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None

    def begin_capture(self, hold: bool, follow: float = 0.0, wake: float | None = None) -> None:
        if not self.cfg.get("enabled") or self.stream is None:
            return
        if self._speaking:
            self.stop_speak()
        with self._lock:
            if self.capturing:
                return
            self.capturing = True
            self.hold = hold
            self.follow = follow > 0
            self.follow_s = follow
            self.buffer = np.zeros(0, dtype=np.float32)
            self.vad_buf = np.zeros(0, dtype=np.float32)
            self.speech_ms = 0.0
            self.silence_ms = 0.0
            self.started_at = time.monotonic()
            if self._vad:
                self._vad.reset()
        if follow > 0:
            log(f"follow-up listen {follow:.1f}s")
        payload = {"type": "listening", "followUp": follow > 0}
        if wake is not None:
            payload["wake"] = True
            payload["score"] = int(round(float(wake) * 100))
        self.broadcast(payload)

    def begin_follow(self, seconds) -> None:
        """She just asked something: listen for the answer without the wake word."""
        try:
            secs = float(seconds)
        except (TypeError, ValueError):
            secs = 0.0
        if secs <= 0:
            return
        secs = min(secs, FOLLOW_MAX_S)
        if self.capturing or self._speaking or self.cfg.get("sleeping") or bool(self.cfg.get("muted")):
            log(f"follow-up skipped capturing={self.capturing} speaking={self._speaking}")
            return
        self.begin_capture(hold=False, follow=secs)

    def request_ptt(self) -> None:
        """Ctrl+Alt+V toggles listening: the mic stays open until you speak and pause."""
        if self.capturing:
            return
        time.sleep(PTT_HOLD_DELAY)
        self.begin_capture(hold=False)

    def _on_audio(self, indata, frames, tinfo, status) -> None:
        if status and "overflow" not in str(status).lower():
            log(str(status))
        chunk = np.asarray(indata[:, 0], dtype=np.float32).copy()
        try:
            self._audio_q.put_nowait(chunk)
        except Full:
            try:
                self._audio_q.get_nowait()
            except Empty:
                pass
            try:
                self._audio_q.put_nowait(chunk)
            except Full:
                pass

    def _audio_loop(self) -> None:
        while self._audio_run:
            try:
                chunk = self._audio_q.get(timeout=0.25)
            except Empty:
                continue
            if chunk is None:
                break
            now = time.monotonic()
            rms = float(np.sqrt(np.mean(np.square(chunk), dtype=np.float32)))
            if now - self._level_t > 0.1 and self.capturing:
                self._level_t = now
                self.broadcast({"type": "level", "rms": min(1.0, rms * 8)})
            if self.capturing:
                self._capture_chunk(chunk, now)
            elif self.wake_live():
                if self.oww_live():
                    self._wake_chunk(chunk)
                if self.whisper_wake_live() and not self.capturing:
                    self._wake_listen_chunk(chunk)

    def reply_mode(self) -> str:
        mode = str(self.cfg.get("replyMode") or "voice").strip().lower()
        if mode in ("blips", "silent", "silence"):
            return "silent" if mode == "silence" else mode
        return "voice"

    def tts_enabled(self) -> bool:
        if self.reply_mode() != "voice":
            return False
        kind = str(self.cfg.get("tts") or "auto").lower()
        return kind not in ("off", "none", "false") and not bool(self.cfg.get("muted"))

    def _drain_q(self, q: Queue) -> None:
        while True:
            try:
                q.get_nowait()
            except Empty:
                break

    def _drain_speak_q(self) -> None:
        self._drain_q(self._speak_q)
        self._drain_q(self._prep_q)
        self._held_phrase = ""

    def _abort_out(self) -> None:
        out = self._out
        self._out = None
        if out is None:
            return
        try:
            out.abort()
        except Exception:
            pass
        try:
            out.close()
        except Exception:
            pass

    def _as_id(self, raw) -> int:
        try:
            return int(raw or 0)
        except (TypeError, ValueError):
            return 0

    def _accept_reply(self, rid: int, via: str) -> None:
        log(f"speak_start id={rid} via={via}")
        self._live_id = rid
        self._speak_gen += 1
        self._speak_stop.set()
        self._abort_out()
        self._drain_speak_q()
        self._speak_stop.clear()
        self._accept_speak = True
        self._session_tts = None
        self._bind_session_tts()

    def arm_speak(self, reply_id=None) -> None:
        rid = self._as_id(reply_id)
        if rid <= 0:
            rid = self._live_id + 1
        self._reply_mood = None
        self._accept_reply(rid, "speak_start")

    def enqueue_speak(self, text: str, reply_id=None, mood=None, calm: bool = False) -> None:
        line = str(text or "").strip()
        if not line:
            return
        if not self.tts_enabled():
            log("speak drop tts=off/muted")
            return
        rid = self._as_id(reply_id)
        if rid <= 0:
            rid = self._live_id if self._accept_speak else self._live_id + 1
        if rid < self._live_id:
            log(f"speak drop stale id={rid} live={self._live_id} {line[:48]!r}")
            return
        if rid > self._live_id:
            self._accept_reply(rid, "speak")
        elif not self._accept_speak:
            log(f"speak drop cut id={rid} {line[:48]!r}")
            return
        name = str(mood or ("seria" if calm else "") or "").strip().lower()
        if name:
            self._reply_mood = name
        if len(line) < SHORT_PHRASE:
            self._held_phrase = f"{self._held_phrase} {line}".strip() if self._held_phrase else line
            log(f"speak hold short id={rid} n={len(self._held_phrase)}")
            return
        if self._held_phrase:
            line = f"{self._held_phrase} {line}".strip()
            self._held_phrase = ""
        log(f"speak queued id={rid} n={len(line)} mood={self._reply_mood or 'playful'} {line[:48]!r}")
        self._speak_q.put(("speak", rid, line))

    def flush_speak(self, reply_id=None) -> None:
        rid = self._as_id(reply_id)
        if rid <= 0:
            rid = self._live_id
        if rid > self._live_id:
            self._accept_reply(rid, "flush")
        if not self.tts_enabled() or rid < self._live_id or (rid == self._live_id and not self._accept_speak):
            log(f"speak_flush skipped id={rid} live={self._live_id}")
            self.broadcast({"type": "talking_done", "skipped": True})
            return
        if self._held_phrase:
            held = self._held_phrase
            self._held_phrase = ""
            log(f"speak queued id={rid} n={len(held)} {held[:48]!r}")
            self._speak_q.put(("speak", rid, held))
        log(f"speak_flush id={rid}")
        self._speak_q.put(("flush", rid, None))

    def stop_speak(self, reply_id=None) -> None:
        rid = self._as_id(reply_id) or self._live_id
        log(f"stop_speak id={rid} live={self._live_id}")
        if rid and rid < self._live_id:
            log(f"stop_speak ignore stale id={rid}")
            return
        if rid == self._live_id or not rid:
            self._accept_speak = False
            self._speak_gen += 1
            self._speak_stop.set()
            self._abort_out()
            self._drain_speak_q()
            self._speak_q.put(("stop", rid, None))

    def _synth_loop(self) -> None:
        while True:
            try:
                item = self._speak_q.get()
            except Exception:
                continue
            kind, rid, payload = item if isinstance(item, tuple) else ("speak", self._live_id, item)
            if kind in ("stop", "flush"):
                self._prep_q.put((kind, rid, None, 0, self._speak_gen))
                continue
            if rid != self._live_id or not self._accept_speak:
                log(f"speak skip stale id={rid} live={self._live_id}")
                continue
            gen = self._speak_gen
            while self._prep_q.qsize() >= PREFETCH and not self._speak_stop.is_set() and gen == self._speak_gen:
                time.sleep(0.03)
            if gen != self._speak_gen or rid != self._live_id or not self._accept_speak:
                log("speak drop before synth")
                continue
            self._synth_busy = True
            t0 = time.perf_counter()
            if kind == "greet":
                greet_id, text = payload if isinstance(payload, tuple) and len(payload) == 2 else ("", "")
                pcm, sr = self._greet_audio(str(greet_id), str(text))
            else:
                pcm, sr = self._synth(str(payload))
            self._synth_busy = False
            ms = (time.perf_counter() - t0) * 1000
            log(f"synth id={rid} {ms:.0f}ms samples={pcm.size} sr={sr}")
            if pcm.size == 0:
                continue
            if gen != self._speak_gen or rid != self._live_id or not self._accept_speak:
                log("speak drop after synth")
                continue
            self._prep_q.put(("audio", rid, pcm, sr, gen))

    def _play_loop(self) -> None:
        session = False
        session_id = 0
        while True:
            try:
                item = self._prep_q.get()
            except Exception:
                continue
            kind, rid, pcm, sr, gen = item if isinstance(item, tuple) and len(item) == 5 else ("audio", self._live_id, None, 0, 0)
            if kind == "stop":
                was = session or self._speaking
                session = False
                session_id = 0
                self._set_speaking(False)
                self._speak_stop.clear()
                log(f"talking_done interrupted={was} id={rid}")
                if was:
                    self.broadcast({"type": "talking_done", "interrupted": True})
                continue
            if kind == "flush":
                if rid and rid != self._live_id:
                    log(f"speak_flush stale id={rid} live={self._live_id}")
                    continue
                if session:
                    session = False
                    self._set_speaking(False)
                    log(f"talking_done id={rid}")
                    self.broadcast({"type": "talking_done", "interrupted": False})
                else:
                    log(f"talking_done skipped id={rid}")
                    self.broadcast({"type": "talking_done", "skipped": True})
                continue
            if rid != self._live_id or not self._accept_speak or gen != self._speak_gen:
                log("play skip stale")
                continue
            if pcm is None or getattr(pcm, "size", 0) == 0:
                continue
            if not session or session_id != rid:
                session = True
                session_id = rid
                self._set_speaking(True)
                log(f"talking id={rid}")
                self.broadcast({"type": "talking"})
            self._note_audio()
            if not self._play(pcm, sr, gen):
                session = False
                session_id = 0
                self._set_speaking(False)
                continue
            self._note_audio()
            if self._speak_q.empty() and self._prep_q.empty() and not self._synth_busy:
                session = False
                session_id = 0
                self._set_speaking(False)
                log(f"talking_done queue-empty id={rid}")
                self.broadcast({"type": "talking_done", "interrupted": False})

    def _announce_tts(self, engine: str, state: str) -> None:
        log(f"tts state engine={engine} state={state}")
        self.broadcast({"type": "tts_state", "engine": engine, "state": state})

    def _bind_session_tts(self) -> None:
        with self._tts_lock:
            if self._omni is not None:
                self._session_tts = self._omni
                reason = "omnivoice"
            elif self._omni_loading:
                # Kokoro is reserved for real failures: while OmniVoice loads Capri
                # answers with blips instead of a voice she is about to replace.
                self._session_tts = None
                reason = "omnivoice_loading"
            else:
                self._session_tts = self._tts
                reason = "kokoro" if self._tts and not isinstance(self._tts, NullTTS) else "off"
        if reason == "omnivoice":
            # her voice is loaded: nothing to decide, so no VRAM probe. With LM Studio off (cloud chat)
            # that probe waits on its port and then `lms ps`, 3-8 s before every reply.
            log(f"tts engine=omnivoice reason={reason}")
            return
        free, usable, _loaded = self._vram_budget()
        if self._omni is not None or reason == "omnivoice_loading":
            engine = "omnivoice"
        elif reason == "kokoro":
            engine = "kokoro"
        else:
            engine = "off"
        log(f"tts engine={engine} reason={reason} vram_free={free} vram_usable={usable}")

    def _warn_low_vram(self) -> None:
        free = free_vram_mib()
        log(f"vram_free after tts {free} MiB")
        if free < VRAM_WARN_MIB:
            msg = f"VRAM baja (~{free} MiB). La voz puede fallar; cerrá apps que usen la GPU."
            if self.cfg.get("localLlm", True) is not False:
                msg = (
                    f"VRAM baja (~{free} MiB). La voz puede fallar; cerrá apps que usen la GPU "
                    "o bajá el modelo de LM Studio."
                )
            log(msg)
            self.broadcast({"type": "notice", "message": msg})

    def _drop_tts(self, reason: str = "off") -> None:
        with self._tts_lock:
            omni = self._omni
            kokoro = self._tts
            self._omni = None
            self._omni_loading = False
            self._tts = None
            self._session_tts = None
        if omni is None and kokoro is None:
            return
        engines = [e for e in (omni, kokoro) if e is not None and not isinstance(e, NullTTS)]
        if not engines:
            return
        for engine in engines:
            try:
                engine.close()
            except Exception:
                pass
        try:
            release_memory()
        except Exception:
            pass
        log(f"tts unloaded reason={reason} vram_free={free_vram_mib()}")

    def start_tts(self) -> None:
        mode = self.reply_mode()
        if mode != "voice":
            self._want_tts = False
            self._drop_tts(f"replyMode={mode}")
            log(f"tts engine=off reason=replyMode={mode} vram_free={free_vram_mib()} vram_usable=n/a")
            self._announce_tts("off", "off")
            return
        kind = str(self.cfg.get("tts") or "auto").strip().lower()
        if kind in ("off", "none", "false"):
            self._want_tts = False
            self._drop_tts("tts=off")
            log(f"tts engine=off reason=tts=off vram_free={free_vram_mib()} vram_usable=n/a")
            self._announce_tts("off", "off")
            return
        self._want_tts = True
        if kind == "kokoro":
            with self._tts_lock:
                if self._tts is None:
                    self._tts = load_kokoro(MODELS, log, self.cfg.get("ttsSpeed"))
            log(f"tts engine=kokoro reason=tts=kokoro vram_free={free_vram_mib()} vram_usable=n/a")
            if isinstance(self._tts, NullTTS):
                self._announce_tts("off", "off")
            else:
                self._announce_tts("kokoro", "ready")
            return
        with self._tts_lock:
            omni_ready = self._omni is not None
            loading = self._omni_loading
        if omni_ready:
            self._announce_tts("omnivoice", "ready")
            return
        if loading:
            self._announce_tts("omnivoice", "loading")
            return
        if self.cfg.get("sleeping"):
            # Folded into DORMANT: keep the VRAM free and load again on wake.
            self._want_tts = False
            log(f"tts engine=off reason=sleeping vram_free={free_vram_mib()} vram_usable=n/a")
            self._announce_tts("off", "off")
            return
        with self._tts_lock:
            self._omni_loading = True
        log(f"tts engine=omnivoice reason=loading vram_free={free_vram_mib()} vram_usable=n/a")
        self._announce_tts("omnivoice", "loading")
        threading.Thread(target=self._load_omni_bg, name="capri-omni", daemon=True).start()

    def _load_omni_bg(self) -> None:
        free, usable, _loaded = self._vram_budget()
        wav, txt = resolve_ref(ROOT, self.cfg.get("ttsRef"))
        verify_ref_transcript(txt, log, "ttsRef")
        mood_refs = {}
        for name, raw in dict(self.cfg.get("ttsMoods") or {}).items():
            key = str(name or "").strip().lower()
            if not key or not raw:
                continue
            m_wav, m_txt = resolve_ref(ROOT, raw)
            if not m_wav.is_file():
                log(f"tts mood wav missing label={key} path={m_wav}")
                continue
            if not verify_ref_transcript(m_txt, log, f"mood:{key}"):
                continue
            mood_refs[key] = (m_wav, m_txt)
        omni = OmniVoiceTTS(
            MODELS,
            log,
            wav,
            txt,
            self.cfg.get("ttsSpeed"),
            tts_steps(self.cfg.get("ttsSteps")),
            mood_refs=mood_refs,
        )
        try:
            omni.load(allow_cpu=str(self.cfg.get("tts") or "").lower() == "omnivoice", free_vram=usable)
        except Exception as err:
            omni.close()
            log(f"omnivoice unavailable: {err}")
            with self._tts_lock:
                self._omni_loading = False
            if not self._want_tts:
                self._announce_tts("off", "off")
                return
            kokoro = self._tts
            if kokoro is None:
                kokoro = load_kokoro(MODELS, log, self.cfg.get("ttsSpeed"))
            with self._tts_lock:
                self._tts = kokoro
            log(f"tts engine=kokoro reason=omnivoice-failed:{err} vram_free={free} vram_usable={usable}")
            self._announce_tts("kokoro", "fallback")
            return
        if not self._want_tts:
            omni.close()
            try:
                release_memory()
            except Exception:
                pass
            with self._tts_lock:
                self._omni_loading = False
            log(f"tts unloaded reason=late-load vram_free={free_vram_mib()}")
            log(f"tts engine=off reason=replyMode={self.reply_mode()} vram_free={free_vram_mib()} vram_usable=n/a")
            self._announce_tts("off", "off")
            return
        with self._tts_lock:
            self._omni = omni
            self._omni_loading = False
            self._session_tts = omni
        log(f"tts engine=omnivoice reason=ready vram_free={free_vram_mib()} vram_usable={usable}")
        self._announce_tts("omnivoice", "ready")
        self._warn_low_vram()

    def _synth(self, text: str, gain: bool = True, mood: str | None = None) -> tuple[np.ndarray, int]:
        if self._omni_loading and self._omni is None:
            # OmniVoice is on its way: stay silent here, the UI answers with blips.
            return np.zeros(0, dtype=np.float32), 24000
        engine = self._session_tts or self._omni or self._tts
        if engine is None:
            self.start_tts()
            engine = self._session_tts or self._omni or self._tts
        if engine is None:
            return np.zeros(0, dtype=np.float32), 24000
        use_mood = str(mood or getattr(self, "_reply_mood", None) or "").strip().lower() or None
        try:
            with self._synth_lock:
                try:
                    pcm, sr = engine.speak(text, mood=use_mood)
                except TypeError:
                    pcm, sr = engine.speak(text)
        except Exception as err:
            log(f"tts failed: {err}")
            return np.zeros(0, dtype=np.float32), 24000
        pcm = normalize_pcm(pcm)
        # Greeting caches keep the raw samples: the volume is applied when they are played.
        return (self._apply_gain(pcm) if gain else pcm), int(sr or 24000)

    def _apply_gain(self, pcm: np.ndarray) -> np.ndarray:
        try:
            gain = float(self.cfg.get("volume") if self.cfg.get("volume") is not None else 0.7)
        except (TypeError, ValueError):
            gain = 0.7
        gain = max(0.0, min(1.0, gain))
        return np.clip(pcm * gain, -1.0, 1.0)

    def prepare_greetings(self, items) -> None:
        """Cache the greetings that do not have a wav yet, once OmniVoice is ready."""
        fresh = False
        missing = []
        with self._greet_lock:
            for item in items if isinstance(items, list) else []:
                if not isinstance(item, dict):
                    continue
                ident = str(item.get("id") or "").strip()
                text = str(item.get("text") or "").strip()
                if greet_path(MODELS, ident) is None or not text:
                    continue
                self._greet_texts[ident] = text
            missing = self._greet_missing()
            if missing and not self._greet_busy:
                self._greet_busy = True
                fresh = True
        if fresh:
            log(f"greet pregen queued={len(missing)}")
            threading.Thread(target=self._greet_pregen, name="capri-greet", daemon=True).start()

    def _greet_missing(self) -> list[tuple[str, str]]:
        return [(ident, text) for ident, text in self._greet_texts.items() if not greet_path(MODELS, ident).is_file()]

    def _greet_pregen(self) -> None:
        try:
            # At boot the engine is still loading: wait for it instead of skipping the cache.
            if not self._await_omni():
                return
            done = 0
            for ident, text in self._greet_missing():
                if self._closed or not self._want_tts:
                    break
                if self._cache_greet(ident, text):
                    done += 1
            log(f"greet pregen done cached={done}")
        finally:
            with self._greet_lock:
                self._greet_busy = False

    def _await_omni(self, timeout: float = 120.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and not self._closed:
            if self._omni is not None:
                return True
            if not self._want_tts:
                return False
            with self._tts_lock:
                loading = self._omni_loading
                fallback = self._session_tts or self._tts
            if fallback is not None:
                # OmniVoice gave up and Kokoro is answering: don't bake its voice into the cache.
                return False
            if not loading:
                self.start_tts()
            time.sleep(0.5)
        return False

    def _cache_greet(self, ident: str, text: str) -> bool:
        path = greet_path(MODELS, ident)
        if path is None or path.is_file():
            return False
        pcm, sr = self._synth(text, gain=False)
        if pcm.size == 0:
            log(f"greet cache skip id={ident} reason=no-audio")
            return False
        try:
            write_wav(path, pcm, sr)
        except OSError as err:
            log(f"greet cache failed id={ident}: {err}")
            return False
        log(f"greet cached id={ident} samples={pcm.size} sr={sr}")
        return True

    def _greet_audio(self, ident: str, text: str) -> tuple[np.ndarray, int]:
        path = greet_path(MODELS, ident)
        if path is not None:
            cached = read_wav(path)
            if cached is not None:
                pcm, sr = cached
                log(f"greet play id={ident} cached samples={pcm.size} sr={sr}")
                return self._apply_gain(pcm), sr
        pcm, sr = self._synth(str(text), gain=False)
        if pcm.size == 0:
            return pcm, sr
        # Only OmniVoice greetings are worth keeping: never freeze a fallback voice in the cache.
        if path is not None and self._omni is not None:
            try:
                write_wav(path, pcm, sr)
                log(f"greet cached id={ident} samples={pcm.size} sr={sr}")
            except OSError as err:
                log(f"greet cache failed id={ident}: {err}")
        return self._apply_gain(pcm), sr

    def enqueue_greet(self, greet_id, text: str, reply_id=None) -> None:
        ident = str(greet_id or "").strip()
        line = str(text or "").strip()
        if greet_path(MODELS, ident) is None or not line:
            return
        rid = self._as_id(reply_id) or self._live_id
        if rid <= 0:
            log(f"greet drop without reply id={ident}")
            return
        log(f"greet id={rid} cache={ident}")
        self._speak_q.put(("greet", rid, (ident, line)))

    def _play(self, pcm: np.ndarray, sr: int, gen: int) -> bool:
        stream = None
        block = 2048
        try:
            stream = sd.OutputStream(samplerate=int(sr), channels=1, dtype="float32")
            self._out = stream
            stream.start()
            for i in range(0, pcm.size, block):
                if self._speak_stop.is_set() or gen != self._speak_gen:
                    self._abort_out()
                    return False
                chunk = pcm[i : i + block].reshape(-1, 1)
                stream.write(chunk)
            return True
        except Exception as err:
            log(f"playback failed: {err}")
            return True
        finally:
            if self._out is stream and stream is not None:
                try:
                    stream.stop()
                    stream.close()
                except Exception:
                    pass
                self._out = None

    def wake_mode(self) -> str:
        mode = str(self.cfg.get("wakeMode") or "both").strip().lower()
        return mode if mode in ("both", "oww", "whisper") else "both"

    def oww_live(self) -> bool:
        return (
            bool(self.cfg.get("wakeWord"))
            and self.wake_mode() != "whisper"
            and self._wake not in (None, False)
        )

    def whisper_wake_live(self) -> bool:
        return (
            bool(self.cfg.get("wakeWord"))
            and self.wake_mode() != "oww"
            and self._whisper is not None
        )

    def wake_live(self) -> bool:
        return self.oww_live() or self.whisper_wake_live()

    def arm_wake(self) -> None:
        self.wake_buf = np.zeros(0, dtype=np.float32)
        self._wake_reset_listen()
        if self._wake not in (None, False):
            try:
                self._wake.reset()
            except Exception as err:
                log(f"wake reset failed: {err}")
        if DEV:
            log("wake armed")

    def _wake_reset_listen(self) -> None:
        self.wake_audio = np.zeros(0, dtype=np.float32)
        self.wake_vad = np.zeros(0, dtype=np.float32)
        self.wake_speech_ms = 0.0
        self.wake_silence_ms = 0.0

    def _wake_listen_chunk(self, chunk: np.ndarray) -> None:
        """Whisper wake: a short utterance while asleep, checked for "capri"."""
        if self._speaking or self.capturing or self._wake_stt:
            return
        self.wake_audio = np.concatenate([self.wake_audio, chunk])
        self.wake_vad = np.concatenate([self.wake_vad, chunk])
        while self.wake_vad.size >= VAD_FRAME:
            frame = self.wake_vad[:VAD_FRAME]
            self.wake_vad = self.wake_vad[VAD_FRAME:]
            p = self._vad.prob(frame) if self._vad else 0.0
            dt = 1000.0 * VAD_FRAME / SAMPLE_RATE
            if p >= SPEECH_THRESHOLD:
                self.wake_speech_ms += dt
                self.wake_silence_ms = 0.0
            else:
                self.wake_silence_ms += dt
        ended = (
            self.wake_speech_ms >= WAKE_MIN_SPEECH_MS
            and self.wake_silence_ms >= WAKE_SILENCE_MS
        )
        duration = self.wake_audio.size / SAMPLE_RATE
        if not ended and duration < WAKE_SPEECH_MAX_S:
            return
        audio = self.wake_audio.copy()
        self._wake_reset_listen()
        if not ended or audio.size < SAMPLE_RATE * 0.25:
            return
        self._wake_stt = True
        threading.Thread(target=self._wake_transcribe, args=(audio,), name="capri-wake-stt", daemon=True).start()

    def _open_wake_follow(self, heard: str) -> None:
        """Wake-only utterance: rouse her and listen ~6s for the real command."""
        log(f"wake-only follow-up {heard!r}")
        self.begin_capture(hold=False, follow=WAKE_FOLLOW_S, wake=1.0)

    def _wake_transcribe(self, audio: np.ndarray) -> None:
        try:
            text = self.transcribe(audio)
        except Exception as err:
            log(f"wake whisper failed: {err}")
            return
        finally:
            self._wake_stt = False
        if not text:
            return
        command = wake_command_text(text)
        if command is None:
            log(f"wake whisper miss {text!r}")
            return
        if self.capturing:
            # openWakeWord beat us to it: one transcript, not two
            log(f"wake whisper skip (already listening) {text!r}")
            return
        if not fold_words(command):
            self._open_wake_follow(text)
            return
        log(f"wake whisper hit {text!r} -> {command!r}")
        self.broadcast({"type": "transcript", "text": command, "wake": "whisper"})

    def _wake_chunk(self, chunk: np.ndarray) -> None:
        self.wake_buf = np.concatenate([self.wake_buf, chunk])
        while self.wake_buf.size >= WAKE_FRAME:
            frame = self.wake_buf[:WAKE_FRAME]
            self.wake_buf = self.wake_buf[WAKE_FRAME:]
            pcm = as_pcm16(frame)
            if not self._wake_logged_shape:
                self._wake_logged_shape = True
                log(
                    f"wake frame n={pcm.size} sr={SAMPLE_RATE} dtype={pcm.dtype} "
                    f"rms={float(np.sqrt(np.mean(frame * frame))):.4f} mono=1"
                )
            try:
                scores = self._wake.predict(pcm)
            except Exception as err:
                log(f"wake predict failed: {err}")
                continue
            peak, named = wake_score_max(scores)
            now = time.monotonic()
            if DEV and now - self._wake_log_t > 0.4:
                self._wake_log_t = now
                log(f"wake score={peak:.3f} {named}")
            if peak >= self.wake_threshold():
                log(f"wake hit score={peak:.3f} threshold={self.wake_threshold():.2f} {named}")
                self.begin_capture(hold=False, wake=peak)

    def _capture_chunk(self, chunk: np.ndarray, now: float) -> None:
        with self._lock:
            if not self.capturing:
                return
            self.buffer = np.concatenate([self.buffer, chunk])
            self.vad_buf = np.concatenate([self.vad_buf, chunk])
            elapsed = now - self.started_at
            if self.hold and not ptt_held():
                asyncio.run_coroutine_threadsafe(self.finish(), self.loop)
                return
            while self.vad_buf.size >= VAD_FRAME:
                frame = self.vad_buf[:VAD_FRAME]
                self.vad_buf = self.vad_buf[VAD_FRAME:]
                p = self._vad.prob(frame) if self._vad else 0.0
                dt = 1000.0 * VAD_FRAME / SAMPLE_RATE
                if p >= SPEECH_THRESHOLD:
                    self.speech_ms += dt
                    self.silence_ms = 0.0
                else:
                    self.silence_ms += dt
            if self._follow_quiet(elapsed):
                asyncio.run_coroutine_threadsafe(self.finish(reason="follow-quiet"), self.loop)
                return
            limit = self._listen_limit()
            max_s = MAX_SECONDS + (self.follow_s if self.follow else 0.0)
            should_cut = (
                elapsed >= max_s
                or (not self.hold and elapsed >= limit)
                or (
                    not self.hold
                    and self.speech_ms >= MIN_SPEECH_MS
                    and self.silence_ms >= SILENCE_MS
                )
            )
            if should_cut:
                why = "max" if elapsed >= max_s else "timeout" if (not self.hold and elapsed >= limit) else "vad"
                asyncio.run_coroutine_threadsafe(self.finish(reason=why), self.loop)

    async def finish(self, reason: str = "vad") -> None:
        with self._lock:
            if not self.capturing:
                return
            self.capturing = False
            audio = self.buffer.copy()
            speech_ms = self.speech_ms
            silence_ms = self.silence_ms
            follow = self.follow
            self.follow = False
            self.follow_s = 0.0
            self.buffer = np.zeros(0, dtype=np.float32)
        log(
            f"listen end reason={reason} speech_ms={speech_ms:.0f} "
            f"silence_ms={silence_ms:.0f} samples={audio.size}"
        )
        self.arm_wake()
        if reason == "follow-quiet":
            # nobody answered: back to the wake word, nothing said, nothing transcribed
            self.broadcast({"type": "stopped", "quiet": True, "followUp": True})
            return
        self.broadcast({"type": "stopped", "followUp": follow})
        if audio.size < SAMPLE_RATE * 0.2:
            log(f"listen drop too-short samples={audio.size} reason={reason}")
            return
        if self.cfg.get("debugSave"):
            self._debug_wav(audio)
        try:
            text = await asyncio.wait_for(asyncio.to_thread(self.transcribe, audio), timeout=15)
        except asyncio.TimeoutError:
            log("stt timeout after 15s")
            return
        except Exception as err:
            log(f"stt failed: {err}")
            return
        text = (text or "").strip()
        if not text:
            log("stt empty")
            return
        # wake phrase may leak into the first capture after openWakeWord / whisper follow-up
        command = wake_command_text(text)
        if command is not None:
            if not fold_words(command):
                self._open_wake_follow(text)
                return
            text = command
        self.broadcast({"type": "transcript", "text": text, "followUp": follow})

    def transcribe(self, audio: np.ndarray) -> str:
        self.ensure_stt()
        whisper = self._whisper
        if whisper is None:
            raise RuntimeError("whisper model unavailable")
        segments, _info = whisper.transcribe(
            audio,
            language="es",
            task="transcribe",
            initial_prompt=STT_PROMPT,
            vad_filter=True,
            beam_size=self._stt_beam,
        )
        # whisper invents text on silence: drop the segments that are noise, then the echo
        text = " ".join(
            seg.text.strip()
            for seg in segments
            if seg.text
            and getattr(seg, "no_speech_prob", 0.0) <= 0.6
            and getattr(seg, "avg_logprob", 0.0) >= -1.0
        ).strip()
        if is_hallucination(text):
            if text:
                log(f"stt drop hallucination {text!r}")
            return ""
        return text

    def _debug_wav(self, audio: np.ndarray) -> None:
        import wave
        dest = MODELS / "debug"
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / f"utt-{int(time.time())}.wav"
        pcm = np.clip(audio * 32767, -32768, 32767).astype(np.int16)
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(SAMPLE_RATE)
            wav.writeframes(pcm.tobytes())
        log(f"debug wav {path}")

    def close(self) -> None:
        self._closed = True
        self.stop_speak()
        self.stop_stream()


def parse_json(raw: str) -> dict:
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def session(ws, engine: Engine) -> None:
    try:
        first = await asyncio.wait_for(ws.recv(), timeout=5)
    except Exception:
        await ws.close()
        return
    hello = parse_json(first)
    if hello.get("type") != "hello" or hello.get("token") != engine.token:
        await ws.close(code=4001, reason="unauthorized")
        return
    engine.clients.add(ws)
    await ws.send(json.dumps({"type": "ready"}))
    await ws.send(json.dumps({"type": "devices", "devices": engine.list_devices()}))
    await ws.send(json.dumps({
        "type": "mic",
        "open": engine.stream is not None,
        "needed": engine.stream_needed(),
        "message": engine._mic_error or "",
    }))
    try:
        async for raw in ws:
            msg = parse_json(raw)
            kind = msg.get("type")
            if kind == "config":
                engine.apply_cfg(msg)
                if engine.cfg.get("enabled"):
                    # STT loads in the background from boot: waiting here used to keep the
                    # control loop from answering a cached greet until Whisper was ready.
                    asyncio.get_running_loop().run_in_executor(None, engine.ensure_stt)
                    await asyncio.to_thread(engine.start_tts)
            elif kind == "ptt_start":
                await asyncio.to_thread(engine.request_ptt)
            elif kind == "follow_up":
                await asyncio.to_thread(engine.begin_follow, msg.get("seconds"))
            elif kind == "ptt_stop":
                if engine.capturing:
                    await engine.finish()
            elif kind == "list_devices":
                await ws.send(json.dumps({"type": "devices", "devices": engine.list_devices()}))
            elif kind == "speak_start":
                engine.arm_speak(msg.get("id"))
            elif kind == "speak":
                engine.enqueue_speak(
                    str(msg.get("text") or ""),
                    msg.get("id"),
                    mood=msg.get("mood"),
                    calm=bool(msg.get("calm")),
                )
            elif kind == "greet_prepare":
                engine.prepare_greetings(msg.get("items"))
            elif kind == "greet":
                engine.enqueue_greet(msg.get("greetId"), str(msg.get("text") or ""), msg.get("id"))
            elif kind == "speak_flush":
                engine.flush_speak(msg.get("id"))
            elif kind == "stop_speak":
                engine.stop_speak(msg.get("id"))
    finally:
        engine.clients.discard(ws)


async def amain() -> None:
    token = os.environ.get("CAPRI_VOICE_TOKEN") or ""
    port = int(os.environ.get("CAPRI_VOICE_PORT") or "47824")
    if not token:
        log("CAPRI_VOICE_TOKEN missing")
        sys.exit(1)
    MODELS.mkdir(parents=True, exist_ok=True)
    preload_torch(log)
    loop = asyncio.get_running_loop()
    engine = Engine(loop, token)
    engine.restart_stream()
    loop.run_in_executor(None, engine.ensure_stt)

    async def handler(ws, *_args):
        await session(ws, engine)

    async with websockets.serve(handler, "127.0.0.1", port):
        log(f"CAPRI_VOICE_READY {port}")
        print(f"CAPRI_VOICE_READY {port}", flush=True)
        try:
            await asyncio.Future()
        finally:
            engine.close()


if __name__ == "__main__":
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        pass
