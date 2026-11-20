"""Capri voice sidecar: mic -> VAD -> STT, TTS playback, local WebSocket on 127.0.0.1."""
from __future__ import annotations

import asyncio
import json
import os
import re
import ssl
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
from heavy import IMPORT_LOCK, import_omnivoice, import_whisper_model, preload_torch
from tts import (
    NullTTS,
    OMNI_MODEL,
    OmniVoiceTTS,
    OmniVoiceUnavailable,
    fallback_message,
    load_kokoro,
    model_cached,
    normalize_pcm,
    release_memory,
    resolve_ref,
    tts_steps,
    verify_ref_transcript,
)
from vram import GEMMA_RESERVE_MIB, VRAM_WARN_MIB, llm_has_model, usable_vram_mib

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"
# Cross-process: only one OmniVoice load at a time (orphan sidecars / overlapping restarts).
OMNI_LOCK_FILE = MODELS / ".omnivoice.lock"
OMNI_BLOCK_FILE = MODELS / ".omni_blocked"
OMNI_LOCK_STALE_S = 120.0
OMNI_LOCK_WAIT_S = 60.0
SAMPLE_RATE = 16000
VAD_FRAME = 512
MIC_BLOCK = 4096
MIC_QUEUE = 48
WAKE_FRAME = 1280
MEDIUM_VRAM_MIB = 2800
# auto: a small GPU (GTX 1650 4 GB) has enough *free* VRAM for medium cuda on paper, but the
# download + load takes ~117 s, past the old 60 s load timeout: every STT then timed out.
MEDIUM_TOTAL_VRAM_MIB = 6144
LISTEN_TIMEOUT_S = 10.0
# CPU-only PCs take ~170-180 s on the first Whisper load: 4 min leaves margin without
# changing which device the loader picks.
WHISPER_LOAD_S = 240.0
# faster-whisper's HF repos: the cache folder is what tells a first-time download from a cached load.
WHISPER_REPOS = {
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
}
WAKE_ATTEMPTS = 3
PREFETCH = 2
SHORT_PHRASE = 20
MAX_SECONDS = 30
COMMAND_SILENCE_MS = 1400.0
SHORT_SPEECH_MS = 1500.0
SHORT_SILENCE_MS = 1000.0
MIN_SPEECH_MS = 250
WAKE_THRESHOLD = 0.2
WAKE_WHILE_TALKING = 0.5
TTS_SETTINGS = ("tts", "ttsRef", "ttsDesign", "ttsMoods", "ttsSpeed", "ttsSteps")
IDLE_TALK_S = 2.0
DEFAULT_IDLE_UNLOAD_MIN = 10.0
SPEECH_THRESHOLD = 0.5
PTT_HOLD_DELAY = 0.12
FOLLOW_MAX_S = 30.0
WAKE_ENERGY = 0.015
SILENT_WARN_S = 10.0
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


def idle_unload_seconds(value, default: float = DEFAULT_IDLE_UNLOAD_MIN) -> float:
    """Minutes from config -> seconds; 0 disables the unload, bad values use the default."""
    try:
        minutes = float(value)
    except (TypeError, ValueError):
        minutes = default
    return max(0.0, minutes) * 60.0


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        return
    log(f"downloading {dest.name}")
    # Per-pid temp: a sidecar still downloading during a reinstall must not collide with the new one.
    tmp = dest.with_suffix(dest.suffix + f".{os.getpid()}.part")
    req = urllib.request.Request(url, headers={"User-Agent": "capri-desktop"})
    try:
        with urllib.request.urlopen(req, context=ssl_context()) as res, open(tmp, "wb") as out:
            out.write(res.read())
    except ssl.SSLCertVerificationError as err:
        # old root store or an antivirus MITM: never disable verification, say where to look
        log(f"download {dest.name} certificate failed: {err} (posible antivirus inspeccionando HTTPS)")
        raise
    if dest.exists() and dest.stat().st_size > 1000:
        tmp.unlink(missing_ok=True)  # another process finished first: keep its file
    else:
        tmp.replace(dest)

def ssl_context() -> ssl.SSLContext:
    """The venv's certifi bundle when it is there: Python's own store can be too old."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()

# Sibling modules (helpers + mixins). Import after constants/log/download so they can `import server`.
from wake import (  # noqa: E402
    BUILTIN_WAKE,
    EnergyVAD,
    SileroVAD,
    WakeMixin,
    _is_wake_name,
    _plain_tokens,
    load_openwakeword,
    resolve_wake_model,
    strip_wake_phrase,
    wake_command_text,
    wake_phrase_match,
    wake_score_max,
)
from stt import (  # noqa: E402
    SttMixin,
    as_pcm16,
    end_silence_ms,
    fold_words,
    is_hallucination,
    native_runtime_module,
    ptt_held,
    wasapi_extra_settings,
)
from tts_runtime import (  # noqa: E402
    TtsRuntimeMixin,
    free_vram_mib,
    nvidia_smi_mib,
    release_omni_lock,
    total_vram_mib,
    try_acquire_omni_lock,
)

import wake as _wake_mod  # noqa: E402
import stt as _stt_mod  # noqa: E402
import tts_runtime as _tts_runtime_mod  # noqa: E402
_host = sys.modules[__name__]
_wake_mod.S = _stt_mod.S = _tts_runtime_mod.S = _host


class Engine(WakeMixin, SttMixin, TtsRuntimeMixin):
    def __init__(self, loop: asyncio.AbstractEventLoop, token: str):
        self.loop = loop
        self.token = token
        self.clients: set = set()
        self.cfg = {
            "enabled": True,
            "wakeWord": True,
            "wakeMuted": False,
            "wakeMode": "both",
            "wakeThreshold": WAKE_THRESHOLD,
            "wakeSensitivity": "normal",
            "wakeMinSpeechMs": WAKE_MIN_SPEECH_MS,
            "wakeEnergy": WAKE_ENERGY,
            "wakeModel": "hey_capri",
            "commandSilenceMs": COMMAND_SILENCE_MS,
            "sttModel": "auto",
            "language": "es",
            "inputDevice": None,
            "debugSave": False,
            "tts": "auto",
            "ttsRef": None,
            "ttsDesign": "voz femenina joven, juguetona, español latino, clara",
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
        self._stt_error = ""
        self._stt_loading = False
        self._runtime_reported = False
        self._lock = threading.Lock()
        self._stt_lock = threading.Lock()
        self._models_lock = threading.Lock()
        self._cfg_ready = False
        self._level_t = 0.0
        self._quiet_since = 0.0
        self._quiet_logged = False
        self._wake_log_t = 0.0
        self._wake_logged_shape = False
        self._stt_beam = 5
        self._audio_q = Queue(maxsize=MIC_QUEUE)
        self._audio_thread = None
        self._audio_run = False
        self._tts = None
        self._omni = None
        self._omni_loading = False
        self._omni_blocked = None
        self._omni_notice_shown = False
        self._omni_gen = 0  # bumped on drop / new load; stale threads must not broadcast
        self._want_tts = False
        self._tts_state = ("off", "off")
        self._tts_announced = False
        self._downloads = 0
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
        tts_before = tuple(self.cfg.get(key) for key in TTS_SETTINGS)
        for key in self.cfg:
            if key in patch:
                self.cfg[key] = patch[key]
        # An explicit voice change may retry OmniVoice; a plain config resend must not.
        if any(self.cfg.get(key) != value for key, value in zip(TTS_SETTINGS, tts_before)):
            self._clear_omni_block()
        if any(k in patch for k in ("wakeSensitivity", "wakeThreshold", "wakeMinSpeechMs", "wakeEnergy")):
            log(
                f"wake config sensitivity={self.cfg.get('wakeSensitivity')} "
                f"threshold={self.wake_threshold():.2f} min_speech_ms={self.wake_min_speech_ms():.0f} "
                f"energy={self.wake_energy():.3f}"
            )
        if "wakeEnergy" in patch and isinstance(self._vad, EnergyVAD):
            self._vad.threshold = self.wake_energy()
        now = time.monotonic()
        waking = False
        if bool(self.cfg.get("sleeping")):
            if not was_sleeping:
                self._sleep_since = now
        else:
            waking = was_sleeping
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
        elif waking and self.reply_mode() == "voice" and not self.cfg.get("sleeping"):
            # Leaving DORMANT: a fresh/off engine must start again (resume + unfold).
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

    def _report_runtime_missing(self, module: str) -> None:
        if self._runtime_reported:
            return
        self._runtime_reported = True
        log(f"native runtime missing: {module}")
        self.broadcast({"type": "runtime_missing", "module": module})

    def ensure_models(self) -> None:
        self.ensure_stt()
        if self._cfg_ready:
            self.start_tts()

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
        self._broadcast_talk({"type": "talking_done", "skipped": False}, self._live_id)

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
        # nobody spoke yet: give up. Once speech starts, MAX_SECONDS is the only cap, so a long
        # sentence with thinking pauses is not cut at 10 s.
        if elapsed < self._listen_limit() or self.speech_ms >= MIN_SPEECH_MS:
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

    def _as_id(self, raw) -> int:
        try:
            return int(raw or 0)
        except (TypeError, ValueError):
            return 0

    def _open_turn(self, t0: float | None = None) -> int:
        # Even ids. Main's typed turns are odd, so the two sides never share a number.
        seq = getattr(self, "_turn_seq", 0) + 2
        self._turn_seq = seq
        if not hasattr(self, "_turns"):
            self._turns = {}
        self._turns[seq] = {
            "t0": time.perf_counter() if t0 is None else t0,
            "reply_at": None,
            "chunk_at": None,
            "synth": 0.0,
            "engine": "",
        }
        if len(self._turns) > 24:
            for key in list(self._turns)[:8]:
                if key != seq:
                    self._turns.pop(key, None)
        return seq

    def _drop_turn(self, turn: int) -> None:
        turns = getattr(self, "_turns", None)
        if turns is not None:
            turns.pop(int(turn or 0), None)

    def _ensure_slot(self, turn: int) -> dict | None:
        turn = int(turn or 0)
        if turn <= 0:
            return None
        if not hasattr(self, "_turns"):
            self._turns = {}
        slot = self._turns.get(turn)
        if slot is None:
            slot = {"t0": None, "reply_at": None, "chunk_at": None, "synth": 0.0, "engine": ""}
            self._turns[turn] = slot
        return slot

    def _turn_for(self, rid) -> int:
        try:
            return int(getattr(self, "_rid_turn", {}).get(int(rid or 0), 0) or 0)
        except (TypeError, ValueError):
            return 0

    def note_reply_turn(self, reply_id, turn) -> None:
        rid = self._as_id(reply_id)
        tid = self._as_id(turn)
        if rid <= 0 or tid <= 0:
            return
        if not hasattr(self, "_rid_turn"):
            self._rid_turn = {}
        self._rid_turn[rid] = tid
        self._ensure_slot(tid)

    def _mark_reply(self, rid: int) -> None:
        slot = self._ensure_slot(self._turn_for(rid))
        if slot is not None and slot.get("reply_at") is None:
            slot["reply_at"] = time.perf_counter()

    def _mark_synth(self, rid: int, synth_ms: float) -> None:
        slot = self._ensure_slot(self._turn_for(rid))
        if slot is None:
            return
        slot["synth"] = float(slot.get("synth") or 0) + float(synth_ms)
        label = getattr(self, "_last_tts_engine", "") or ""
        if label and not slot.get("engine"):
            slot["engine"] = label
        if slot.get("chunk_at") is None:
            slot["chunk_at"] = time.perf_counter()
            if slot.get("reply_at") is not None:
                slot["tts_first"] = (slot["chunk_at"] - slot["reply_at"]) * 1000

    def _mark_play(self, rid: int) -> None:
        slot = self._ensure_slot(self._turn_for(rid))
        if slot is None or slot.get("play") is not None:
            return
        now = time.perf_counter()
        if slot.get("chunk_at") is not None:
            slot["play"] = (now - slot["chunk_at"]) * 1000
        if slot.get("t0") is not None:
            slot["total"] = (now - slot["t0"]) * 1000

    def _timing_fields(self, turn: int) -> dict:
        slot = (getattr(self, "_turns", {}) or {}).get(int(turn or 0))
        if not slot:
            return {}
        out = {"turn": int(turn)}
        for key in ("stt", "tts_first", "synth", "play", "total"):
            value = slot.get(key)
            if isinstance(value, (int, float)):
                out[key] = int(round(value))
        engine = slot.get("engine") or ""
        if engine:
            out["engine"] = engine
        return out

    def _broadcast_talk(self, payload: dict, rid=0) -> None:
        turn = self._turn_for(rid)
        if turn:
            payload = {**payload, **self._timing_fields(turn)}
            if payload.get("type") == "talking_done" and not payload.get("interrupted"):
                self._drop_turn(turn)
        self.broadcast(payload)

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
    if engine._downloads > 0:
        await ws.send(json.dumps({"type": "tts_state", "engine": "voice", "state": "downloading"}))
    try:
        async for raw in ws:
            msg = parse_json(raw)
            kind = msg.get("type")
            if kind == "config":
                engine.apply_cfg(msg)
                if engine.cfg.get("enabled"):
                    # torch only for the engine that needs it: a light install (no -OmniVoice)
                    # has no torch, and preloading it used to take the whole sidecar down.
                    if engine._tts_wants_gpu():
                        await asyncio.to_thread(preload_torch, log)
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
                engine.note_reply_turn(msg.get("id"), msg.get("turn"))
                engine.arm_speak(msg.get("id"))
            elif kind == "speak":
                engine.note_reply_turn(msg.get("id"), msg.get("turn"))
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
                engine.note_reply_turn(msg.get("id"), msg.get("turn"))
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
    server_pid_file = MODELS / ".server.pid"
    try:
        server_pid_file.write_text(str(os.getpid()), encoding="utf-8")
    except OSError:
        pass
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
            try:
                server_pid_file.unlink(missing_ok=True)
            except Exception:
                pass
            engine.close()


if __name__ == "__main__":
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        pass
