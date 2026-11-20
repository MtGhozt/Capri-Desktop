"""Wake word helpers, VAD classes, and Engine wake mixin."""
from __future__ import annotations

import os
import re
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np

from heavy import IMPORT_LOCK

S = None  # bound to server/__main__ by S.py after import


def load_openwakeword():
    """Import the pip package, not a local file/folder named openwakeword."""
    blocked = {os.path.abspath(p) for p in (os.getcwd(), str(S.ROOT), str(S.MODELS))}
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


BUILTIN_WAKE = ("alexa", "hey_mycroft", "hey_jarvis", "hey_rhasspy", "timer", "weather")

# openWakeWord ships a few models; anything else is a custom .onnx we train (docs/wake-word.md).
def resolve_wake_model(value, models: Path | None = None) -> tuple[str | None, bool]:
    """wakeModel -> (path/name openWakeWord can load, whether the model is missing).

    Missing means no openWakeWord at all: there is no stand-in model, the wake word is
    Whisper hearing "Capri" (wakeMode both/whisper).
    """
    if models is None:
        models = S.MODELS
    raw = str(value or "hey_capri").strip()
    looks_like_path = raw.lower().endswith(".onnx") or "/" in raw or "\\" in raw
    if looks_like_path:
        path = Path(raw)
        if not path.is_absolute():
            path = models / path
        return (str(path), False) if path.is_file() else (None, True)
    if raw.lower() in BUILTIN_WAKE:
        return raw.lower(), False
    custom = models / f"{raw}.onnx"
    return (str(custom), False) if custom.is_file() else (None, True)


def wake_score_max(scores) -> tuple[float, dict]:
    if not isinstance(scores, dict):
        scores = {"score": scores}
    out = {}
    for key, raw in scores.items():
        out[str(key)] = float(np.max(np.asarray(raw, dtype=np.float64)))
    return (max(out.values()) if out else 0.0), out


def _is_wake_name(word: str) -> bool:
    return word in S.WAKE_NAMES or bool(S.WAKE_MANGLED.match(word))


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
    if plain[0] in S.WAKE_PREFIX and len(plain) > 1 and _is_wake_name(plain[1]):
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


class EnergyVAD:
    def __init__(self, threshold: float | None = None):
        if threshold is None:
            threshold = S.WAKE_ENERGY
        self.threshold = threshold

    def reset(self) -> None:
        pass

    def prob(self, frame: np.ndarray) -> float:
        rms = float(np.sqrt(np.mean(np.square(frame), dtype=np.float32)))
        return 1.0 if rms > self.threshold else 0.0


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
        sr = np.array(S.SAMPLE_RATE, dtype=np.int64)
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


class WakeMixin:
    def _load_wake(self):
        model, missing = S.resolve_wake_model(self.cfg.get("wakeModel"))
        if missing:
            name = self.cfg.get("wakeModel") or "hey_capri"
            how = (
                'wake word is Whisper "Capri" only'
                if self.wake_mode() != "oww"
                else "no wake word until that model exists"
            )
            S.log(f"wake model {name} not found in {S.MODELS}; openWakeWord off, {how}")
            self.cfg["wakeMode"] = "whisper"
            self.broadcast({
                "type": "notice",
                "level": "info",
                "message": "El 'Hey Capri' no pudo arrancar; uso la detección por voz mientras tanto. Detalles en el log.",
            })
            return False
        last_err = None
        runtime = None
        for attempt in range(1, S.WAKE_ATTEMPTS + 1):
            try:
                Model, download_models = S.load_openwakeword()
                if attempt == 1:
                    # The installer normally seeds these; repair an incomplete venv once.
                    download_models()
                    import openwakeword
                    missing_resources = [
                        name for name, info in openwakeword.FEATURE_MODELS.items()
                        if not S.Path(info["model_path"]).exists()
                        or not S.Path(info["model_path"]).with_suffix(".onnx").exists()
                    ]
                    if missing_resources:
                        raise FileNotFoundError(
                            f"openWakeWord resources missing after download: {', '.join(missing_resources)}"
                        )
                # a custom .onnx is already on disk; a built-in name is downloaded once
                if not model.lower().endswith(".onnx"):
                    download_models(model_names=[model])
                wake = Model(
                    wakeword_models=[model],
                    inference_framework="onnx",
                )
                S.log(f"wake word {model} ready threshold={self.wake_threshold()}")
                return wake
            except Exception as err:
                last_err = err
                runtime = S.native_runtime_module(err)
                if runtime:
                    # no VC++ runtime: the next attempt fails the same way
                    self._report_runtime_missing(runtime)
                    break
                S.log(f"wake word failed attempt={attempt}/{S.WAKE_ATTEMPTS}: {err}")
                S.time.sleep(0.4 * attempt)
        if not runtime:
            S.log(f"wake word unavailable: {last_err}")
            self.broadcast({
                "type": "notice",
                "level": "info",
                "message": "El 'Hey Capri' no pudo arrancar; uso la detección por voz mientras tanto. Detalles en el log.",
            })
        self.cfg["wakeMode"] = "whisper"
        return False

    def wake_threshold(self) -> float:
        try:
            value = float(self.cfg.get("wakeThreshold"))
        except (TypeError, ValueError):
            value = S.WAKE_THRESHOLD
        if value <= 0 or value >= 1:
            value = S.WAKE_THRESHOLD
        if self._speaking:
            return max(value, S.WAKE_WHILE_TALKING)
        return value

    def wake_min_speech_ms(self) -> float:
        """Wake sensitivity (Baja/Normal/Alta) also moves how much speech counts as an utterance."""
        try:
            value = float(self.cfg.get("wakeMinSpeechMs"))
        except (TypeError, ValueError):
            value = S.WAKE_MIN_SPEECH_MS
        return value if 50.0 <= value <= 2000.0 else S.WAKE_MIN_SPEECH_MS

    def wake_energy(self) -> float:
        try:
            value = float(self.cfg.get("wakeEnergy"))
        except (TypeError, ValueError):
            value = S.WAKE_ENERGY
        return value if 0.0005 <= value <= 0.2 else S.WAKE_ENERGY

    def wake_mode(self) -> str:
        mode = str(self.cfg.get("wakeMode") or "both").strip().lower()
        return mode if mode in ("both", "oww", "whisper") else "both"

    def oww_live(self) -> bool:
        return (
            bool(self.cfg.get("wakeWord"))
            and not bool(self.cfg.get("wakeMuted"))
            and self.wake_mode() != "whisper"
            and self._wake not in (None, False)
        )

    def whisper_wake_live(self) -> bool:
        return (
            bool(self.cfg.get("wakeWord"))
            and not bool(self.cfg.get("wakeMuted"))
            and self.wake_mode() != "oww"
            and self._whisper is not None
        )

    def wake_live(self) -> bool:
        return self.oww_live() or self.whisper_wake_live()

    def arm_wake(self) -> None:
        self.wake_buf = S.np.zeros(0, dtype=S.np.float32)
        self._wake_reset_listen()
        if self._wake not in (None, False):
            try:
                self._wake.reset()
            except Exception as err:
                S.log(f"wake reset failed: {err}")
        if S.DEV:
            S.log("wake armed")

    def _wake_reset_listen(self) -> None:
        self.wake_audio = S.np.zeros(0, dtype=S.np.float32)
        self.wake_vad = S.np.zeros(0, dtype=S.np.float32)
        self.wake_speech_ms = 0.0
        self.wake_silence_ms = 0.0

    def _wake_listen_chunk(self, chunk: S.np.ndarray) -> None:
        """Whisper wake: a short utterance while asleep, checked for "capri"."""
        if self._speaking or self.capturing or self._wake_stt:
            return
        self.wake_audio = S.np.concatenate([self.wake_audio, chunk])
        self.wake_vad = S.np.concatenate([self.wake_vad, chunk])
        while self.wake_vad.size >= S.VAD_FRAME:
            frame = self.wake_vad[:S.VAD_FRAME]
            self.wake_vad = self.wake_vad[S.VAD_FRAME:]
            p = self._vad.prob(frame) if self._vad else 0.0
            dt = 1000.0 * S.VAD_FRAME / S.SAMPLE_RATE
            if p >= S.SPEECH_THRESHOLD:
                self.wake_speech_ms += dt
                self.wake_silence_ms = 0.0
            else:
                self.wake_silence_ms += dt
        ended = (
            self.wake_speech_ms >= self.wake_min_speech_ms()
            and self.wake_silence_ms >= S.WAKE_SILENCE_MS
        )
        duration = self.wake_audio.size / S.SAMPLE_RATE
        if not ended and duration < S.WAKE_SPEECH_MAX_S:
            return
        audio = self.wake_audio.copy()
        self._wake_reset_listen()
        if not ended or audio.size < S.SAMPLE_RATE * 0.25:
            return
        self._wake_stt = True
        started = S.time.perf_counter()
        S.threading.Thread(
            target=self._wake_transcribe, args=(audio, started), name="capri-wake-stt", daemon=True,
        ).start()

    def _open_wake_follow(self, heard: str) -> None:
        """Wake-only utterance: rouse her and listen ~6s for the real command."""
        S.log(f"wake-only follow-up {heard!r}")
        self.begin_capture(hold=False, follow=S.WAKE_FOLLOW_S, wake=1.0)

    def _wake_transcribe(self, audio: S.np.ndarray, ended: float | None = None) -> None:
        if self._stt_error:
            self._wake_stt = False
            return
        try:
            text = self.transcribe(audio)
        except Exception as err:
            S.log(f"wake whisper failed: {err}")
            return
        finally:
            self._wake_stt = False
        if not text:
            return
        command = S.wake_command_text(text)
        if command is None:
            S.log(f"wake miss: heard {text!r} (no Capri at the start)")
            return
        if self.capturing:
            # openWakeWord beat us to it: one transcript, not two
            S.log(f"wake whisper skip (already listening) {text!r}")
            return
        if not S.fold_words(command):
            self._open_wake_follow(text)
            return
        S.log(f"wake whisper hit {text!r} -> {command!r}")
        started = S.time.perf_counter() if ended is None else ended
        turn = self._open_turn(started)
        stt = int(round((S.time.perf_counter() - started) * 1000))
        slot = self._ensure_slot(turn)
        if slot is not None:
            slot["stt"] = stt
        self.broadcast({
            "type": "transcript", "text": command, "wake": "whisper", "turn": turn, "stt": stt,
        })

    def _wake_chunk(self, chunk: S.np.ndarray) -> None:
        self.wake_buf = S.np.concatenate([self.wake_buf, chunk])
        while self.wake_buf.size >= S.WAKE_FRAME:
            frame = self.wake_buf[:S.WAKE_FRAME]
            self.wake_buf = self.wake_buf[S.WAKE_FRAME:]
            pcm = S.as_pcm16(frame)
            if not self._wake_logged_shape:
                self._wake_logged_shape = True
                S.log(
                    f"wake frame n={pcm.size} sr={S.SAMPLE_RATE} dtype={pcm.dtype} "
                    f"rms={float(S.np.sqrt(S.np.mean(frame * frame))):.4f} mono=1"
                )
            try:
                scores = self._wake.predict(pcm)
            except Exception as err:
                S.log(f"wake predict failed: {err}")
                continue
            peak, named = S.wake_score_max(scores)
            now = S.time.monotonic()
            if S.DEV and now - self._wake_log_t > 0.4:
                self._wake_log_t = now
                S.log(f"wake score={peak:.3f} {named}")
            if peak >= self.wake_threshold():
                S.log(f"wake hit score={peak:.3f} threshold={self.wake_threshold():.2f} {named}")
                self.begin_capture(hold=False, wake=peak)

