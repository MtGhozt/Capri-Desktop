"""Capri voice sidecar: mic -> VAD -> STT, TTS playback, local WebSocket on 127.0.0.1."""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from queue import Empty, Full, Queue

import numpy as np
import sounddevice as sd
import websockets

from tts import (
    NullTTS,
    OmniVoiceTTS,
    load_kokoro,
    normalize_pcm,
    resolve_ref,
    tts_steps,
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
PREFETCH = 2
SHORT_PHRASE = 20
MAX_SECONDS = 15
SILENCE_MS = 700
MIN_SPEECH_MS = 250
WAKE_THRESHOLD = 0.2
WAKE_WHILE_TALKING = 0.5
IDLE_TALK_S = 2.0
SPEECH_THRESHOLD = 0.5
PTT_HOLD_DELAY = 0.12
STT_PROMPT = "Capri, choom, Matias"
SILERO_URL = (
    "https://github.com/snakers4/silero-vad/raw/v5.1.2/"
    "src/silero_vad/data/silero_vad.onnx"
)

VK_CONTROL = 0x11
VK_MENU = 0x12
VK_V = 0x56


os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
DEV = os.environ.get("CAPRI_DEV") == "1"
LOG_FILE = os.environ.get("CAPRI_VOICE_LOG") or ""


def log(msg: str) -> None:
    line = f"[capri-voice] {msg}"
    print(line, flush=True)
    if not LOG_FILE:
        return
    try:
        path = Path(LOG_FILE)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(time.strftime("%Y-%m-%dT%H:%M:%S") + " " + line + "\n")
    except OSError:
        pass


def load_openwakeword():
    """Import the pip package, not a local file/folder named openwakeword."""
    import sys
    blocked = {os.path.abspath(p) for p in (os.getcwd(), str(ROOT), str(MODELS))}
    saved = sys.path[:]
    sys.path[:] = [p for p in saved if p not in ("", ".") and os.path.abspath(p) not in blocked]
    try:
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


def as_pcm16(frame: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(np.clip(frame * 32767.0, -32768, 32767).astype(np.int16))


def wake_score_max(scores) -> tuple[float, dict]:
    if not isinstance(scores, dict):
        scores = {"score": scores}
    out = {}
    for key, raw in scores.items():
        out[str(key)] = float(np.max(np.asarray(raw, dtype=np.float64)))
    return (max(out.values()) if out else 0.0), out


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
            "wakeThreshold": WAKE_THRESHOLD,
            "wakeModel": "hey_jarvis",
            "sttModel": "auto",
            "language": "es",
            "inputDevice": None,
            "debugSave": False,
            "tts": "auto",
            "ttsRef": None,
            "ttsSpeed": 1.0,
            "ttsSteps": 16,
            "replyMode": "voice",
            "llmBaseUrl": "http://localhost:1235/v1",
            "muted": False,
            "volume": 0.7,
        }
        self.stream = None
        self.capturing = False
        self.hold = False
        self.buffer = np.zeros(0, dtype=np.float32)
        self.vad_buf = np.zeros(0, dtype=np.float32)
        self.wake_buf = np.zeros(0, dtype=np.float32)
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
        self._out = None
        self._synth_thread = threading.Thread(target=self._synth_loop, name="capri-tts-synth", daemon=True)
        self._synth_thread.start()
        self._play_thread = threading.Thread(target=self._play_loop, name="capri-tts-play", daemon=True)
        self._play_thread.start()
        self._idle_thread = threading.Thread(target=self._idle_watch, name="capri-tts-idle", daemon=True)
        self._idle_thread.start()

    def apply_cfg(self, patch: dict) -> None:
        before = (self.cfg.get("enabled"), self.cfg.get("inputDevice"))
        was_muted = bool(self.cfg.get("muted"))
        for key in self.cfg:
            if key in patch:
                self.cfg[key] = patch[key]
        after = (self.cfg.get("enabled"), self.cfg.get("inputDevice"))
        if after != before:
            self.restart_stream()
        if bool(self.cfg.get("muted")) and not was_muted:
            self.stop_speak()
        if self._omni is not None:
            self._omni.steps = tts_steps(self.cfg.get("ttsSteps"))
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
        loaded = llm_has_model(base)
        usable = usable_vram_mib(free, loaded)
        reserve = 0 if loaded else GEMMA_RESERVE_MIB
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
            if self._wake is None and self.cfg.get("wakeWord"):
                try:
                    Model, download_models = load_openwakeword()
                    model = self.cfg.get("wakeModel") or "hey_jarvis"
                    download_models(model_names=[model], target_directory=str(MODELS))
                    download_models(model_names=[model])
                    custom = sorted(MODELS.glob(f"*{model}*.onnx"))
                    names = [str(custom[0])] if custom else [model]
                    self._wake = Model(wakeword_models=names, inference_framework="onnx")
                    log(f"wake word {model} ready threshold={self.wake_threshold()} onnx={names}")
                except Exception as err:
                    log(f"wake word unavailable: {err}")
                    self._wake = False
            if self._whisper is None:
                self._whisper = self._load_whisper()

    def ensure_models(self) -> None:
        self.ensure_stt()
        if self._cfg_ready:
            self.start_tts()

    def _load_whisper(self):
        from faster_whisper import WhisperModel
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
                model = WhisperModel("medium", device="cuda", compute_type="float16", download_root=root)
                log("whisper medium cuda ready")
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
        return WhisperModel(name, device="cpu", compute_type="int8", download_root=root)

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

    def _maybe_listen_timeout(self) -> None:
        if not self.capturing or self.hold:
            return
        if time.monotonic() - self.started_at < LISTEN_TIMEOUT_S:
            return
        log(
            f"listen timeout after {LISTEN_TIMEOUT_S:.0f}s "
            f"speech_ms={self.speech_ms:.0f} silence_ms={self.silence_ms:.0f} samples={self.buffer.size}"
        )
        asyncio.run_coroutine_threadsafe(self.finish(reason="timeout"), self.loop)

    def _idle_watch(self) -> None:
        while True:
            time.sleep(0.25)
            try:
                self._maybe_idle_talk()
                self._maybe_listen_timeout()
            except Exception:
                pass

    def restart_stream(self) -> None:
        self.stop_stream()
        if not self.cfg.get("enabled"):
            log("mic disabled")
            return
        device = None
        raw = self.cfg.get("inputDevice")
        if raw is not None and str(raw) != "":
            try:
                device = int(raw)
            except (TypeError, ValueError):
                device = None
        try:
            self._audio_q = Queue(maxsize=MIC_QUEUE)
            self._audio_run = True
            self._audio_thread = threading.Thread(target=self._audio_loop, name="capri-mic", daemon=True)
            self._audio_thread.start()
            self.stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="float32",
                blocksize=MIC_BLOCK,
                latency="high",
                device=device,
                callback=self._on_audio,
            )
            self.stream.start()
            log(
                f"mic stream device={device if device is not None else 'default'} "
                f"sr={self.stream.samplerate} ch={self.stream.channels} "
                f"block={MIC_BLOCK} queue={MIC_QUEUE}"
            )
        except Exception as err:
            log(f"mic failed: {err}")
            self.broadcast({"type": "error", "message": str(err)})
            self.stream = None
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

    def begin_capture(self, hold: bool) -> None:
        if not self.cfg.get("enabled") or self.stream is None:
            return
        if self._speaking:
            self.stop_speak()
        with self._lock:
            if self.capturing:
                return
            self.capturing = True
            self.hold = hold
            self.buffer = np.zeros(0, dtype=np.float32)
            self.vad_buf = np.zeros(0, dtype=np.float32)
            self.speech_ms = 0.0
            self.silence_ms = 0.0
            self.started_at = time.monotonic()
            if self._vad:
                self._vad.reset()
        self.broadcast({"type": "listening"})

    def request_ptt(self) -> None:
        if self.capturing:
            return
        time.sleep(PTT_HOLD_DELAY)
        self.begin_capture(hold=ptt_held())

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
                self._wake_chunk(chunk)

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
        self._accept_reply(rid, "speak_start")

    def enqueue_speak(self, text: str, reply_id=None) -> None:
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
        if len(line) < SHORT_PHRASE:
            self._held_phrase = f"{self._held_phrase} {line}".strip() if self._held_phrase else line
            log(f"speak hold short id={rid} n={len(self._held_phrase)}")
            return
        if self._held_phrase:
            line = f"{self._held_phrase} {line}".strip()
            self._held_phrase = ""
        log(f"speak queued id={rid} n={len(line)} {line[:48]!r}")
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
            kind, rid, text = item if isinstance(item, tuple) else ("speak", self._live_id, item)
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
            pcm, sr = self._synth(str(text))
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

    def _bind_session_tts(self) -> None:
        with self._tts_lock:
            if self._omni is not None:
                self._session_tts = self._omni
                reason = "omnivoice"
            elif self._omni_loading:
                self._session_tts = self._tts
                reason = "omnivoice_loading"
            else:
                self._session_tts = self._tts
                reason = "kokoro" if self._tts and not isinstance(self._tts, NullTTS) else "off"
        free, usable, _loaded = self._vram_budget()
        engine = "omnivoice" if self._session_tts is self._omni and self._omni is not None else (
            "kokoro" if reason in ("kokoro", "omnivoice_loading") else "off"
        )
        log(f"tts engine={engine} reason={reason} vram_free={free} vram_usable={usable}")

    def _warn_low_vram(self) -> None:
        free = free_vram_mib()
        log(f"vram_free after tts {free} MiB")
        if free < VRAM_WARN_MIB:
            msg = f"VRAM baja (~{free} MiB). Gemma y OmniVoice están al límite."
            log(msg)
            self.broadcast({"type": "notice", "message": msg})

    def _drop_tts(self) -> None:
        with self._tts_lock:
            omni = self._omni
            self._omni = None
            self._omni_loading = False
            self._tts = None
            self._session_tts = None
        if omni is not None:
            try:
                omni.close()
            except Exception:
                pass

    def start_tts(self) -> None:
        if self.reply_mode() != "voice":
            self._want_tts = False
            self._drop_tts()
            log(f"tts engine=off reason=replyMode={self.reply_mode()} vram_free={free_vram_mib()} vram_usable=n/a")
            return
        kind = str(self.cfg.get("tts") or "auto").strip().lower()
        if kind in ("off", "none", "false"):
            self._want_tts = False
            self._drop_tts()
            log(f"tts engine=off reason=tts=off vram_free={free_vram_mib()} vram_usable=n/a")
            return
        self._want_tts = True
        with self._tts_lock:
            if self._tts is None:
                speed = self.cfg.get("ttsSpeed")
                self._tts = load_kokoro(MODELS, log, speed)
                reason = "omnivoice_loading" if kind in ("auto", "omnivoice") else "tts=kokoro"
                log(f"tts engine=kokoro reason={reason} vram_free={free_vram_mib()} vram_usable=n/a")
            want_omni = kind in ("auto", "omnivoice")
            if want_omni and self._omni is None and not self._omni_loading:
                self._omni_loading = True
                threading.Thread(target=self._load_omni_bg, name="capri-omni", daemon=True).start()

    def _load_omni_bg(self) -> None:
        free, usable, _loaded = self._vram_budget()
        wav, txt = resolve_ref(ROOT, self.cfg.get("ttsRef"))
        omni = OmniVoiceTTS(
            MODELS,
            log,
            wav,
            txt,
            self.cfg.get("ttsSpeed"),
            tts_steps(self.cfg.get("ttsSteps")),
        )
        try:
            omni.load(allow_cpu=str(self.cfg.get("tts") or "").lower() == "omnivoice", free_vram=usable)
        except Exception as err:
            omni.close()
            log(f"omnivoice unavailable: {err}")
            log(f"tts engine=kokoro reason=omnivoice-failed:{err} vram_free={free} vram_usable={usable}")
            with self._tts_lock:
                self._omni_loading = False
            return
        if not self._want_tts:
            omni.close()
            with self._tts_lock:
                self._omni_loading = False
            log(f"tts engine=off reason=replyMode={self.reply_mode()} vram_free={free_vram_mib()} vram_usable=n/a")
            return
        with self._tts_lock:
            self._omni = omni
            self._omni_loading = False
        log(f"tts engine=omnivoice reason=ready vram_free={free_vram_mib()} vram_usable={usable}")
        self._warn_low_vram()

    def _synth(self, text: str) -> tuple[np.ndarray, int]:
        engine = self._session_tts or self._omni or self._tts
        if engine is None:
            self.start_tts()
            engine = self._session_tts or self._omni or self._tts
        if engine is None:
            return np.zeros(0, dtype=np.float32), 24000
        try:
            pcm, sr = engine.speak(text)
        except Exception as err:
            log(f"tts failed: {err}")
            return np.zeros(0, dtype=np.float32), 24000
        pcm = normalize_pcm(pcm)
        try:
            gain = float(self.cfg.get("volume") if self.cfg.get("volume") is not None else 0.7)
        except (TypeError, ValueError):
            gain = 0.7
        gain = max(0.0, min(1.0, gain))
        pcm = np.clip(pcm * gain, -1.0, 1.0)
        return pcm, int(sr or 24000)

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

    def wake_live(self) -> bool:
        return bool(self.cfg.get("wakeWord")) and self._wake not in (None, False)

    def arm_wake(self) -> None:
        self.wake_buf = np.zeros(0, dtype=np.float32)
        if self._wake not in (None, False):
            try:
                self._wake.reset()
            except Exception as err:
                log(f"wake reset failed: {err}")
        if DEV:
            log("wake armed")

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
                self.begin_capture(hold=False)

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
            should_cut = (
                elapsed >= MAX_SECONDS
                or (not self.hold and elapsed >= LISTEN_TIMEOUT_S)
                or (
                    not self.hold
                    and self.speech_ms >= MIN_SPEECH_MS
                    and self.silence_ms >= SILENCE_MS
                )
            )
            if should_cut:
                why = "max" if elapsed >= MAX_SECONDS else "timeout" if elapsed >= LISTEN_TIMEOUT_S else "vad"
                asyncio.run_coroutine_threadsafe(self.finish(reason=why), self.loop)

    async def finish(self, reason: str = "vad") -> None:
        with self._lock:
            if not self.capturing:
                return
            self.capturing = False
            audio = self.buffer.copy()
            speech_ms = self.speech_ms
            silence_ms = self.silence_ms
            self.buffer = np.zeros(0, dtype=np.float32)
        log(
            f"listen end reason={reason} speech_ms={speech_ms:.0f} "
            f"silence_ms={silence_ms:.0f} samples={audio.size}"
        )
        self.arm_wake()
        self.broadcast({"type": "stopped"})
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
        if text:
            self.broadcast({"type": "transcript", "text": text})
        else:
            log("stt empty")

    def transcribe(self, audio: np.ndarray) -> str:
        self.ensure_stt()
        segments, _info = self._whisper.transcribe(
            audio,
            language="es",
            task="transcribe",
            initial_prompt=STT_PROMPT,
            vad_filter=False,
            beam_size=self._stt_beam,
        )
        return " ".join(seg.text.strip() for seg in segments if seg.text).strip()

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
    try:
        async for raw in ws:
            msg = parse_json(raw)
            kind = msg.get("type")
            if kind == "config":
                engine.apply_cfg(msg)
                if engine.cfg.get("enabled"):
                    await asyncio.gather(
                        asyncio.to_thread(engine.ensure_stt),
                        asyncio.to_thread(engine.start_tts),
                    )
            elif kind == "ptt_start":
                await asyncio.to_thread(engine.request_ptt)
            elif kind == "ptt_stop":
                if engine.capturing:
                    await engine.finish()
            elif kind == "list_devices":
                await ws.send(json.dumps({"type": "devices", "devices": engine.list_devices()}))
            elif kind == "speak_start":
                engine.arm_speak(msg.get("id"))
            elif kind == "speak":
                engine.enqueue_speak(str(msg.get("text") or ""), msg.get("id"))
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
