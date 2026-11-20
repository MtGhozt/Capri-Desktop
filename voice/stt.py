"""STT and mic helpers, and Engine STT/capture mixin."""
from __future__ import annotations

import re
import sys
import time
import unicodedata
from pathlib import Path
from queue import Empty, Full, Queue

import numpy as np
import sounddevice as sd

S = None  # bound to server/__main__ by S.py after import


def end_silence_ms(configured, speech_ms: float) -> float:
    """Silence that closes a command listen (Ajustes › Oído: Corta / Normal / Larga).

    A short utterance gets the shorter pause, so a clipped false start ends fast; a real
    sentence lets you think for the configured pause.
    """
    try:
        base = float(configured)
    except (TypeError, ValueError):
        base = S.COMMAND_SILENCE_MS
    if not 300.0 <= base <= 4000.0:
        base = S.COMMAND_SILENCE_MS
    return min(base, S.SHORT_SILENCE_MS) if speech_ms < S.SHORT_SPEECH_MS else base


def as_pcm16(frame: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(np.clip(frame * 32767.0, -32768, 32767).astype(np.int16))


def fold_words(text: str) -> list[str]:
    """Lowercase words without accents or punctuation, for matching what Whisper wrote."""
    plain = unicodedata.normalize("NFD", str(text or ""))
    plain = "".join(ch for ch in plain if unicodedata.category(ch) != "Mn")
    return re.findall(r"[a-z0-9]+", plain.lower())


def is_hallucination(text: str, prompt: str | None = None) -> bool:
    """Whisper on silence invents the prompt: "Matías, Matías, Matías" is not speech."""
    if prompt is None:
        prompt = S.STT_PROMPT
    words = fold_words(text)
    if not words:
        return True
    if any(word in S.WAKE_NAMES for word in words):
        return False
    if len(words) >= 3 and len(set(words)) == 1:
        return True
    allowed = set(fold_words(prompt)) | {"matias"}
    return all(word in allowed for word in words)


def wasapi_extra_settings(device) -> object | None:
    """Shared-mode WASAPI only for a WASAPI device: other host APIs reject it (PaError -9984)."""
    if S.sys.platform != "win32" or not hasattr(S.sd, "WasapiSettings"):
        return None
    try:
        if device is None:
            device = S.sd.default.device[0]
        hostapi = int(S.sd.query_devices(device)["hostapi"])
        name = str(S.sd.query_hostapis(hostapi).get("name") or "")
    except Exception:
        return None
    if "WASAPI" not in name.upper():
        return None
    try:
        return S.sd.WasapiSettings(exclusive=False)
    except Exception:
        return None


def ptt_held() -> bool:
    if S.sys.platform != "win32":
        return False
    import ctypes
    down = ctypes.windll.user32.GetAsyncKeyState
    return bool(down(S.VK_CONTROL) & 0x8000 and down(S.VK_MENU) & 0x8000 and down(S.VK_V) & 0x8000)


def native_runtime_module(err) -> str | None:
    """The DLL/module whose native runtime is missing (VC++ x64), or None.

    onnxruntime: "DLL load failed while importing onnxruntime_pybind11_state: ..."
    ctranslate2: "Could not find module '...\\ctranslate2.dll' (or one of its dependencies)"
    """
    text = str(err)
    if "DLL load failed" in text:
        match = re.search(r"importing (\w+)", text)
        return match.group(1) if match else "native"
    if "Could not find module" in text and ".dll" in text.lower():
        match = re.search(r"module '([^']+)'", text)
        return Path(match.group(1)).name if match else "native"
    return None

class SttMixin:
    def ensure_stt(self) -> None:
        with self._stt_lock:
            if self._stt_loading:
                # slow CPU: the first load takes minutes. Don't queue a second warmup behind it.
                return
            self._stt_loading = True
        try:
            S.MODELS.mkdir(parents=True, exist_ok=True)
            if self._vad is None:
                path = S.MODELS / "silero_vad.onnx"
                try:
                    S.download(S.SILERO_URL, path)
                    self._vad = S.SileroVAD(path)
                    S.log("silero vad ready")
                except Exception as err:
                    S.log(f"silero vad fallback to energy: {err}")
                    self._vad = S.EnergyVAD(self.wake_energy())
            if self._wake is None and self.cfg.get("wakeWord") and self.wake_mode() != "whisper":
                self._wake = self._load_wake()
            if self._whisper is None and not self._stt_error:
                try:
                    self._whisper = self._load_whisper()
                except Exception as err:
                    # keep the reason here: an exception escaping this executor was reported
                    # once as "Future exception was never retrieved" and every utterance
                    # failed again. One line, then STT stays unavailable.
                    self._stt_error = str(err)
                    module = S.native_runtime_module(err)
                    if module:
                        self._report_runtime_missing(module)
                    else:
                        S.log(f"stt unavailable: {err}")
                    self.broadcast({"type": "stt", "available": False, "reason": self._stt_error})
        finally:
            with self._stt_lock:
                self._stt_loading = False

    def _unload_whisper(self) -> None:
        with self._stt_lock:
            whisper = self._whisper
            self._whisper = None
        if whisper is None:
            return
        del whisper
        try:
            S.release_memory()
        except Exception:
            pass
        S.log(f"stt unloaded reason=mic-idle vram_free={S.free_vram_mib()}")

    def _load_whisper(self):
        WhisperModel = S.import_whisper_model()
        root = str(S.MODELS / "whisper")
        wanted = str(self.cfg.get("sttModel") or "auto").lower()
        self._stt_beam = 5
        free, usable, _loaded = self._vram_budget()
        total = S.total_vram_mib()
        keep_gpu = self._tts_wants_gpu()
        # "auto" picks medium only on a 6 GB+ GPU; explicit "medium" still tries cuda.
        try_medium = (
            not keep_gpu
            and wanted in ("auto", "medium")
            and usable >= S.MEDIUM_VRAM_MIB
            and (wanted == "medium" or total >= S.MEDIUM_TOTAL_VRAM_MIB)
        )
        if try_medium:
            try:
                S.log(f"loading whisper medium (cuda float16) vram_free={free} vram_usable={usable} vram_total={total}")
                model = self._whisper_boot(WhisperModel, "medium", "cuda", "float16", root)
                return model
            except Exception as err:
                S.log(f"whisper medium cuda failed: {err}")
        name = "small" if wanted in ("auto", "medium") else wanted
        if name not in ("base", "small", "medium"):
            name = "small"
        reason = "tts keeps gpu for omnivoice" if keep_gpu else "cpu"
        S.log(
            f"loading whisper {name} (cpu int8) reason={reason} beam={self._stt_beam} "
            f"vram_free={free} vram_usable={usable} vram_total={total}"
        )
        try:
            return self._whisper_boot(WhisperModel, name, "cpu", "int8", root)
        except Exception as err:
            S.log(f"whisper failed: {err}")
            raise

    def _whisper_boot(self, WhisperModel, name, device, compute, root):
        timed_out = {"hit": False}

        def on_timeout():
            timed_out["hit"] = True
            S.log(f"whisper load timeout after {S.WHISPER_LOAD_S:.0f}s name={name} device={device}")
            self.broadcast({
                "type": "notice",
                "message": f"Whisper no terminó de cargar en {S.WHISPER_LOAD_S:.0f}s.",
            })

        timer = S.threading.Timer(S.WHISPER_LOAD_S, on_timeout)
        timer.daemon = True
        timer.start()
        t0 = S.time.perf_counter()
        downloading = not S.model_cached(root, S.WHISPER_REPOS.get(name, f"Systran/faster-whisper-{name}"))
        if downloading:
            self._set_download(True)
        try:
            model = WhisperModel(name, device=device, compute_type=compute, download_root=root)
        finally:
            timer.cancel()
            if downloading:
                self._set_download(False)
        ms = (S.time.perf_counter() - t0) * 1000
        tag = f"{name} {device}"
        S.log(f"whisper ready name={name} device={device} {ms:.0f}ms")
        if timed_out["hit"]:
            S.log(f"whisper ready after timeout ({tag})")
        return model

    def stream_needed(self) -> bool:
        """Who needs the mic: not her while asleep with no wake word, not while muted."""
        if not self.cfg.get("enabled"):
            return False
        if self.cfg.get("muted"):
            return False
        # Fullscreen game: wake is off but push-to-talk still needs the stream.
        if self.cfg.get("wakeMuted"):
            return True
        return not (self.cfg.get("sleeping") and not self.cfg.get("wakeWord"))

    def restart_stream(self) -> None:
        self.stop_stream()
        if not self.stream_needed():
            self._mic_error = None
            S.log(
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
        if device is None:
            try:
                if not [d for d in S.sd.query_devices() if int(d.get("max_input_channels") or 0) > 0]:
                    S.log("mic: no input device found")
            except Exception:
                pass
        # shared mode: exclusive WASAPI would lock the mic away from push-to-talk apps
        extra = S.wasapi_extra_settings(device)
        try:
            self._audio_q = S.Queue(maxsize=S.MIC_QUEUE)
            self._audio_run = True
            self._audio_thread = S.threading.Thread(target=self._audio_loop, name="capri-mic", daemon=True)
            self._audio_thread.start()
            self.stream = self._open_stream(device, extra)
        except Exception as err:
            if extra is None:
                self._mic_failed(err)
                return
            S.log(f"mic failed with WASAPI shared mode ({err}); retrying without extra settings")
            try:
                self.stream = self._open_stream(device, None)
            except Exception as retry:
                self._mic_failed(retry)
                return
        self._mic_error = None
        S.log(
            f"mic stream device={device if device is not None else 'default'} "
            f"sr={self.stream.samplerate} ch={self.stream.channels} "
            f"block={S.MIC_BLOCK} queue={S.MIC_QUEUE}"
        )
        self.broadcast({"type": "mic", "open": True, "needed": True, "message": ""})

    def _open_stream(self, device, extra):
        stream = S.sd.InputStream(
            samplerate=S.SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=S.MIC_BLOCK,
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
        S.log(f"mic failed: {err}")
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
        if self._audio_thread and self._audio_thread.is_alive() and S.threading.current_thread() is not self._audio_thread:
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
            self.buffer = S.np.zeros(0, dtype=S.np.float32)
            self.vad_buf = S.np.zeros(0, dtype=S.np.float32)
            self.speech_ms = 0.0
            self.silence_ms = 0.0
            self.started_at = S.time.monotonic()
            if self._vad:
                self._vad.reset()
        if follow > 0:
            S.log(f"follow-up listen {follow:.1f}s")
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
        secs = min(secs, S.FOLLOW_MAX_S)
        if self.capturing or self._speaking or self.cfg.get("sleeping") or bool(self.cfg.get("muted")):
            S.log(f"follow-up skipped capturing={self.capturing} speaking={self._speaking}")
            return
        self.begin_capture(hold=False, follow=secs)

    def request_ptt(self) -> None:
        """Ctrl+Alt+V toggles listening: the mic stays open until you speak and pause."""
        if self.capturing:
            return
        S.time.sleep(S.PTT_HOLD_DELAY)
        self.begin_capture(hold=False)

    def _on_audio(self, indata, frames, tinfo, status) -> None:
        if status and "overflow" not in str(status).lower():
            S.log(str(status))
        chunk = S.np.asarray(indata[:, 0], dtype=S.np.float32).copy()
        try:
            self._audio_q.put_nowait(chunk)
        except S.Full:
            try:
                self._audio_q.get_nowait()
            except S.Empty:
                pass
            try:
                self._audio_q.put_nowait(chunk)
            except S.Full:
                pass

    def _audio_loop(self) -> None:
        while self._audio_run:
            try:
                chunk = self._audio_q.get(timeout=0.25)
            except S.Empty:
                continue
            if chunk is None:
                break
            now = S.time.monotonic()
            rms = float(S.np.sqrt(S.np.mean(S.np.square(chunk), dtype=S.np.float32)))
            if rms < 0.001 and self.stream_needed():
                if not self._quiet_since:
                    self._quiet_since = now
                elif not self._quiet_logged and now - self._quiet_since >= S.SILENT_WARN_S:
                    self._quiet_logged = True
                    S.log("mic silent: 10 s of near-silence (muted device, wrong input, or nothing reaching Capri)")
            else:
                self._quiet_since = 0.0
                self._quiet_logged = False
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

    def _capture_chunk(self, chunk: S.np.ndarray, now: float) -> None:
        with self._lock:
            if not self.capturing:
                return
            self.buffer = S.np.concatenate([self.buffer, chunk])
            self.vad_buf = S.np.concatenate([self.vad_buf, chunk])
            elapsed = now - self.started_at
            if self.hold and not S.ptt_held():
                S.asyncio.run_coroutine_threadsafe(self.finish(), self.loop)
                return
            while self.vad_buf.size >= S.VAD_FRAME:
                frame = self.vad_buf[:S.VAD_FRAME]
                self.vad_buf = self.vad_buf[S.VAD_FRAME:]
                p = self._vad.prob(frame) if self._vad else 0.0
                dt = 1000.0 * S.VAD_FRAME / S.SAMPLE_RATE
                if p >= S.SPEECH_THRESHOLD:
                    self.speech_ms += dt
                    self.silence_ms = 0.0
                else:
                    self.silence_ms += dt
            if self._follow_quiet(elapsed):
                S.asyncio.run_coroutine_threadsafe(self.finish(reason="follow-quiet"), self.loop)
                return
            limit = self._listen_limit()
            max_s = S.MAX_SECONDS + (self.follow_s if self.follow else 0.0)
            should_cut = (
                elapsed >= max_s
                or (not self.hold and self.speech_ms < S.MIN_SPEECH_MS and elapsed >= limit)
                or (
                    not self.hold
                    and self.speech_ms >= S.MIN_SPEECH_MS
                    and self.silence_ms >= S.end_silence_ms(self.cfg.get("commandSilenceMs"), self.speech_ms)
                )
            )
            if should_cut:
                why = "max" if elapsed >= max_s else "timeout" if self.speech_ms < S.MIN_SPEECH_MS else "vad"
                S.asyncio.run_coroutine_threadsafe(self.finish(reason=why), self.loop)

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
            self.buffer = S.np.zeros(0, dtype=S.np.float32)
        ended = S.time.perf_counter()
        S.log(
            f"listen end reason={reason} speech_ms={speech_ms:.0f} "
            f"silence_ms={silence_ms:.0f} "
            f"end_ms={S.end_silence_ms(self.cfg.get('commandSilenceMs'), speech_ms):.0f} "
            f"samples={audio.size}"
        )
        self.arm_wake()
        if reason == "follow-quiet":
            # nobody answered: back to the wake word, nothing said, nothing transcribed
            self.broadcast({"type": "stopped", "quiet": True, "followUp": True})
            return
        self.broadcast({"type": "stopped", "followUp": follow})
        if audio.size < S.SAMPLE_RATE * 0.2:
            S.log(f"listen drop too-short samples={audio.size} reason={reason}")
            return
        if self._stt_error:
            # already explained once (voice.log + Ajustes): don't fail on every utterance
            return
        if self.cfg.get("debugSave"):
            self._debug_wav(audio)
        turn = self._open_turn(ended)
        try:
            text = await S.asyncio.wait_for(S.asyncio.to_thread(self.transcribe, audio), timeout=15)
        except S.asyncio.TimeoutError:
            self._drop_turn(turn)
            S.log("stt timeout after 15s")
            return
        except Exception as err:
            self._drop_turn(turn)
            S.log(f"stt failed: {err}")
            return
        text = (text or "").strip()
        if not text:
            self._drop_turn(turn)
            S.log("stt empty")
            return
        # wake phrase may leak into the first capture after openWakeWord / whisper follow-up
        command = S.wake_command_text(text)
        if command is not None:
            if not S.fold_words(command):
                self._drop_turn(turn)
                self._open_wake_follow(text)
                return
            text = command
        stt = int(round((S.time.perf_counter() - ended) * 1000))
        slot = self._ensure_slot(turn)
        if slot is not None:
            slot["stt"] = stt
        self.broadcast({
            "type": "transcript", "text": text, "followUp": follow, "turn": turn, "stt": stt,
        })

    def transcribe(self, audio: S.np.ndarray) -> str:
        self.ensure_stt()
        whisper = self._whisper
        if whisper is None:
            raise RuntimeError(self._stt_error or "whisper model unavailable")
        segments, _info = whisper.transcribe(
            audio,
            language="es",
            task="transcribe",
            initial_prompt=S.STT_PROMPT,
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
        if S.is_hallucination(text):
            if text:
                S.log(f"stt drop hallucination {text!r}")
            return ""
        return text

    def _debug_wav(self, audio: S.np.ndarray) -> None:
        import wave
        dest = S.MODELS / "debug"
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / f"utt-{int(S.time.time())}.wav"
        pcm = S.np.clip(audio * 32767, -32768, 32767).astype(S.np.int16)
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(S.SAMPLE_RATE)
            wav.writeframes(pcm.tobytes())
        S.log(f"debug wav {path}")

