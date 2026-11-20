"""OmniVoice lock / VRAM helpers and Engine TTS runtime mixin."""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from queue import Empty, Queue

import numpy as np
import sounddevice as sd

S = None  # bound to server/__main__ by S.py after import


def try_acquire_omni_lock(
    path: Path | None = None,
    *,
    stale_s: float | None = None,
    wait_s: float | None = None,
    sleep_fn=time.sleep,
    now=None,
) -> bool:
    """Exclusive create of the lock file. Wait for another loader; steal if stale (~2 min)."""
    if path is None:
        path = S.OMNI_LOCK_FILE
    if stale_s is None:
        stale_s = S.OMNI_LOCK_STALE_S
    if wait_s is None:
        wait_s = S.OMNI_LOCK_WAIT_S
    clock = now or time.time
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = clock() + max(0.0, wait_s)
    while True:
        try:
            fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            try:
                os.write(fd, f"{os.getpid()}\n{clock()}\n".encode("utf-8"))
            finally:
                os.close(fd)
            return True
        except FileExistsError:
            try:
                age = clock() - path.stat().st_mtime
            except OSError:
                age = stale_s + 1
            if age >= stale_s:
                try:
                    path.unlink()
                    continue
                except OSError:
                    pass
            if clock() >= deadline:
                return False
            sleep_fn(0.4)
        except OSError:
            if clock() >= deadline:
                return False
            sleep_fn(0.4)


def release_omni_lock(path: Path | None = None) -> None:
    try:
        Path(path or S.OMNI_LOCK_FILE).unlink(missing_ok=True)
    except OSError:
        pass

def nvidia_smi_mib(field: str) -> int:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", f"--query-gpu={field}", "--format=csv,noheader,nounits"],
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        return int(out.strip().splitlines()[0].split()[0])
    except Exception:
        return 0


def free_vram_mib() -> int:
    return nvidia_smi_mib("memory.free")


def total_vram_mib() -> int:
    return nvidia_smi_mib("memory.total")

class TtsRuntimeMixin:
    def _vram_budget(self) -> tuple[int, int, bool]:
        free = S.free_vram_mib()
        base = str(self.cfg.get("llmBaseUrl") or "http://localhost:1235/v1")
        # A cloud provider answers, so Gemma will never load here: the GPU is OmniVoice's (her own
        # voice), and reserving memory for a model that never comes only forced Kokoro.
        local_llm = self.cfg.get("localLlm", True) is not False
        loaded = S.llm_has_model(base) if local_llm else False
        usable = S.usable_vram_mib(free, loaded, S.GEMMA_RESERVE_MIB if local_llm else 0)
        reserve = 0 if loaded or not local_llm else S.GEMMA_RESERVE_MIB
        S.log(f"vram free ~{free} MiB usable ~{usable} MiB llm_loaded={int(loaded)} reserve={reserve}")
        return free, usable, loaded

    def _tts_wants_gpu(self) -> bool:
        return str(self.cfg.get("tts") or "auto").lower() in ("auto", "omnivoice")

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

    def _drain_q(self, q: S.Queue) -> None:
        while True:
            try:
                q.get_nowait()
            except S.Empty:
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

    def _engine_label(self, engine) -> str:
        if isinstance(engine, S.OmniVoiceTTS):
            device = str(getattr(engine, "device", "") or "")
            return "omnivoice-cuda" if device.startswith("cuda") else "omnivoice-cpu"
        if engine is None or isinstance(engine, S.NullTTS):
            return ""
        return "kokoro"

    def _accept_reply(self, rid: int, via: str) -> None:
        S.log(f"speak_start id={rid} via={via}")
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
            S.log("speak drop tts=off/muted")
            return
        rid = self._as_id(reply_id)
        if rid <= 0:
            rid = self._live_id if self._accept_speak else self._live_id + 1
        if rid < self._live_id:
            S.log(f"speak drop stale id={rid} live={self._live_id} {self._speak_preview(line)!r}")
            return
        if rid > self._live_id:
            self._accept_reply(rid, "speak")
        elif not self._accept_speak:
            S.log(f"speak drop cut id={rid} {self._speak_preview(line)!r}")
            return
        self._mark_reply(rid)
        name = str(mood or ("seria" if calm else "") or "").strip().lower()
        if name:
            self._reply_mood = name
        if len(line) < S.SHORT_PHRASE:
            self._held_phrase = f"{self._held_phrase} {line}".strip() if self._held_phrase else line
            S.log(f"speak hold short id={rid} n={len(self._held_phrase)}")
            return
        if self._held_phrase:
            line = f"{self._held_phrase} {line}".strip()
            self._held_phrase = ""
        S.log(f"speak queued id={rid} n={len(line)} mood={self._reply_mood or 'playful'} {self._speak_preview(line)!r}")
        self._speak_q.put(("speak", rid, line))

    def _speak_preview(self, line: str) -> str:
        # full text only while debugging voice (voice.debugSave); keep logs short otherwise
        text = str(line or "")
        if self.cfg.get("debugSave"):
            return text
        return text[:48]

    def flush_speak(self, reply_id=None) -> None:
        rid = self._as_id(reply_id)
        if rid <= 0:
            rid = self._live_id
        if rid > self._live_id:
            self._accept_reply(rid, "flush")
        if not self.tts_enabled() or rid < self._live_id or (rid == self._live_id and not self._accept_speak):
            S.log(f"speak_flush skipped id={rid} live={self._live_id}")
            self._broadcast_talk({"type": "talking_done", "skipped": True}, rid)
            return
        if self._held_phrase:
            held = self._held_phrase
            self._held_phrase = ""
            S.log(f"speak queued id={rid} n={len(held)} {self._speak_preview(held)!r}")
            self._speak_q.put(("speak", rid, held))
        S.log(f"speak_flush id={rid}")
        self._speak_q.put(("flush", rid, None))

    def stop_speak(self, reply_id=None) -> None:
        rid = self._as_id(reply_id) or self._live_id
        S.log(f"stop_speak id={rid} live={self._live_id}")
        if rid and rid < self._live_id:
            S.log(f"stop_speak ignore stale id={rid}")
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
                S.log(f"speak skip stale id={rid} live={self._live_id}")
                continue
            gen = self._speak_gen
            while self._prep_q.qsize() >= S.PREFETCH and not self._speak_stop.is_set() and gen == self._speak_gen:
                S.time.sleep(0.03)
            if gen != self._speak_gen or rid != self._live_id or not self._accept_speak:
                S.log("speak drop before synth")
                continue
            self._synth_busy = True
            t0 = S.time.perf_counter()
            if kind == "greet":
                greet_id, text = payload if isinstance(payload, tuple) and len(payload) == 2 else ("", "")
                pcm, sr = self._greet_audio(str(greet_id), str(text))
            else:
                # A clone line spoken by Kokoro is the wrong person: hold the reply until the clone
                # is up (or a real failure already fell back), still honouring stop/flush.
                while self._omni_loading and not self._omni_blocked and self._want_tts:
                    if gen != self._speak_gen or rid != self._live_id or not self._accept_speak:
                        break
                    S.time.sleep(0.05)
                if gen != self._speak_gen or rid != self._live_id or not self._accept_speak:
                    self._synth_busy = False
                    S.log("speak drop before synth")
                    continue
                pcm, sr = self._synth(str(payload))
            self._synth_busy = False
            ms = (S.time.perf_counter() - t0) * 1000
            S.log(f"synth id={rid} {ms:.0f}ms samples={pcm.size} sr={sr}")
            if pcm.size == 0:
                if gen == self._speak_gen and rid == self._live_id and self._accept_speak:
                    why = "omnivoice-loading" if self._omni_loading else (
                        "omnivoice-blocked" if self._omni_blocked else "no-engine"
                    )
                    self._finish_empty_synth(rid, why)
                continue
            if gen != self._speak_gen or rid != self._live_id or not self._accept_speak:
                S.log("speak drop after synth")
                continue
            self._mark_synth(rid, ms)
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
                S.log(f"talking_done interrupted={was} id={rid}")
                if was:
                    self._broadcast_talk({"type": "talking_done", "interrupted": True}, rid)
                continue
            if kind == "flush":
                if rid and rid != self._live_id:
                    S.log(f"speak_flush stale id={rid} live={self._live_id}")
                    continue
                if session:
                    session = False
                    self._set_speaking(False)
                    S.log(f"talking_done id={rid}")
                    self._broadcast_talk({"type": "talking_done", "interrupted": False}, rid)
                else:
                    S.log(f"talking_done skipped id={rid}")
                    self._broadcast_talk({"type": "talking_done", "skipped": True}, rid)
                continue
            if rid != self._live_id or not self._accept_speak or gen != self._speak_gen:
                S.log("play skip stale")
                continue
            if pcm is None or getattr(pcm, "size", 0) == 0:
                continue
            if not session or session_id != rid:
                session = True
                session_id = rid
                self._set_speaking(True)
                S.log(f"talking id={rid}")
                self._broadcast_talk({"type": "talking"}, rid)
            self._note_audio()
            if not self._play(pcm, sr, gen, rid=rid):
                session = False
                session_id = 0
                self._set_speaking(False)
                continue
            self._note_audio()
            if self._speak_q.empty() and self._prep_q.empty() and not self._synth_busy:
                session = False
                session_id = 0
                self._set_speaking(False)
                S.log(f"talking_done queue-empty id={rid}")
                self._broadcast_talk({"type": "talking_done", "interrupted": False}, rid)

    def _announce_tts(self, engine: str, state: str) -> None:
        self._tts_state = (engine, state)
        self._tts_announced = True
        if state != "downloading" and getattr(self, "_downloads", 0) > 0:
            engine, state = "voice", "downloading"
        reason = ""
        if engine == "off" and bool(self.cfg.get("sleeping")):
            reason = "sleeping"
        S.log(f"tts state engine={engine} state={state}{f' reason={reason}' if reason else ''}")
        payload = {"type": "tts_state", "engine": engine, "state": state}
        if reason:
            payload["reason"] = reason
        self.broadcast(payload)

    def _set_download(self, on: bool) -> None:
        """A first-time Hugging Face download: say so, so the long wait is not a frozen bar."""
        self._downloads = max(0, getattr(self, "_downloads", 0) + (1 if on else -1))
        if self._downloads:
            self.broadcast({"type": "tts_state", "engine": "voice", "state": "downloading"})
        elif getattr(self, "_tts_announced", False):
            self._announce_tts(*self._tts_state)

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
                reason = "kokoro" if self._tts and not isinstance(self._tts, S.NullTTS) else "off"
        if reason == "omnivoice":
            # her voice is loaded: nothing to decide, so no VRAM probe. With LM Studio off (cloud chat)
            # that probe waits on its port and then `lms ps`, 3-8 s before every reply.
            S.log(f"tts engine=omnivoice reason={reason}")
            return
        free, usable, _loaded = self._vram_budget()
        if self._omni is not None or reason == "omnivoice_loading":
            engine = "omnivoice"
        elif reason == "kokoro":
            engine = "kokoro"
        else:
            engine = "off"
        S.log(f"tts engine={engine} reason={reason} vram_free={free} vram_usable={usable}")

    def _warn_low_vram(self) -> None:
        free = S.free_vram_mib()
        S.log(f"vram_free after tts {free} MiB")
        if free < S.VRAM_WARN_MIB:
            msg = f"VRAM baja (~{free} MiB). La voz puede fallar; cerrá apps que usen la GPU."
            if self.cfg.get("localLlm", True) is not False:
                msg = (
                    f"VRAM baja (~{free} MiB). La voz puede fallar; cerrá apps que usen la GPU "
                    "o bajá el modelo de LM Studio."
                )
            S.log(msg)
            self.broadcast({"type": "notice", "message": msg})

    def _drop_tts(self, reason: str = "off") -> None:
        with self._tts_lock:
            omni = self._omni
            kokoro = self._tts
            self._omni = None
            self._omni_loading = False
            self._omni_gen += 1  # in-flight load must not announce fallback/ready
            self._tts = None
            self._session_tts = None
        if omni is None and kokoro is None:
            return
        engines = [e for e in (omni, kokoro) if e is not None and not isinstance(e, S.NullTTS)]
        if not engines:
            return
        for engine in engines:
            try:
                engine.close()
            except Exception:
                pass
        try:
            S.release_memory()
        except Exception:
            pass
        S.log(f"tts unloaded reason={reason} vram_free={S.free_vram_mib()}")

    def _omni_gen_alive(self, gen: int) -> bool:
        with self._tts_lock:
            return gen == self._omni_gen

    def _read_omni_block(self) -> str | None:
        try:
            text = S.OMNI_BLOCK_FILE.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        return text or None

    def _write_omni_block(self, reason: str) -> None:
        try:
            S.MODELS.mkdir(parents=True, exist_ok=True)
            S.OMNI_BLOCK_FILE.write_text(str(reason or "blocked")[:400], encoding="utf-8")
        except OSError as err:
            S.log(f"omni block file write failed: {err}")

    def _clear_omni_block(self) -> None:
        self._omni_blocked = None
        self._omni_notice_shown = False
        try:
            S.OMNI_BLOCK_FILE.unlink(missing_ok=True)
        except OSError:
            pass

    def _ensure_kokoro(self):
        with self._tts_lock:
            if self._tts is None:
                self._tts = S.load_kokoro(S.MODELS, S.log, self.cfg.get("ttsSpeed"))
            return self._tts

    def _finish_empty_synth(self, rid: int, reason: str) -> None:
        S.log(f"synth empty id={rid} reason={reason}")
        self._broadcast_talk({"type": "talking"}, rid)
        self._broadcast_talk({"type": "talking_done", "interrupted": False, "empty": True}, rid)

    def start_tts(self) -> None:
        mode = self.reply_mode()
        if mode != "voice":
            self._want_tts = False
            self._drop_tts(f"replyMode={mode}")
            S.log(f"tts engine=off reason=replyMode={mode} vram_free={S.free_vram_mib()} vram_usable=n/a")
            self._announce_tts("off", "off")
            return
        kind = str(self.cfg.get("tts") or "auto").strip().lower()
        if kind in ("off", "none", "false"):
            self._want_tts = False
            self._drop_tts("tts=off")
            S.log(f"tts engine=off reason=tts=off vram_free={S.free_vram_mib()} vram_usable=n/a")
            self._announce_tts("off", "off")
            return
        self._want_tts = True
        if kind == "kokoro":
            self._ensure_kokoro()
            S.log(f"tts engine=kokoro reason=tts=kokoro vram_free={S.free_vram_mib()} vram_usable=n/a")
            if isinstance(self._tts, S.NullTTS):
                self._announce_tts("off", "off")
            else:
                self._announce_tts("kokoro", "ready")
            return
        # A light install (setup.ps1 without -OmniVoice) has no torch by design: Kokoro is its
        # normal engine here, not a fallback. preload_torch records the miss once (cached after).
        if kind == "auto" and not self.cfg.get("ttsRef") and not self.cfg.get("sleeping"):
            if not S.preload_torch(S.log):
                self._ensure_kokoro()
                S.log(f"tts engine=kokoro reason=no-torch vram_free={S.free_vram_mib()} vram_usable=n/a")
                if isinstance(self._tts, S.NullTTS):
                    self._announce_tts("off", "off")
                else:
                    self._announce_tts("kokoro", "ready")
                return
        # Survive sidecar restarts: a prior ImportError/VRAM block stays until TTS settings change.
        if not self._omni_blocked:
            saved = self._read_omni_block()
            if saved:
                self._omni_blocked = saved
        # Check+set+spawn under one lock so two start_tts calls never both spawn a load.
        with self._tts_lock:
            if self._omni is not None:
                # Clone already up: never take the blocked/Kokoro branch over a live engine.
                action = "ready"
                gen = 0
            elif self._omni_blocked:
                action = "blocked"
                gen = 0
            elif self._omni_loading:
                action = "loading"
                gen = 0
            elif self.cfg.get("sleeping"):
                action = "sleeping"
                gen = 0
            else:
                self._omni_loading = True
                self._omni_gen += 1
                gen = self._omni_gen
                action = "spawn"
        if action == "ready":
            self._announce_tts("omnivoice", "ready")
            return
        if action == "blocked":
            # A permanent failure (no torch, unusable GPU): Kokoro until settings change.
            self._ensure_kokoro()
            if not self._omni_notice_shown:
                self._omni_notice_shown = True
                self.broadcast({
                    "type": "notice",
                    "message": S.fallback_message(self._omni_blocked),
                })
            if self._tts_state != ("kokoro", "fallback"):
                S.log(f"tts engine=kokoro reason=omnivoice-blocked:{self._omni_blocked} vram_free={S.free_vram_mib()} vram_usable=n/a")
                self._announce_tts("kokoro", "fallback")
            return
        if action == "loading":
            # Already loading: do not re-spam "Cargando voz…" on every speak/config.
            if self._tts_state != ("omnivoice", "loading"):
                self._announce_tts("omnivoice", "loading")
            return
        if action == "sleeping":
            # Folded into DORMANT: keep the VRAM free and load again on wake.
            self._want_tts = False
            S.log(f"tts engine=off reason=sleeping vram_free={S.free_vram_mib()} vram_usable=n/a")
            self._announce_tts("off", "off")
            return
        S.log(f"tts engine=omnivoice reason=loading vram_free={S.free_vram_mib()} vram_usable=n/a")
        self._announce_tts("omnivoice", "loading")
        S.threading.Thread(target=self._load_omni_bg, args=(gen,), name="capri-omni", daemon=True).start()

    def _load_omni_bg(self, gen: int | None = None) -> None:
        if gen is None:
            with self._tts_lock:
                gen = self._omni_gen
        held_lock = False
        try:
            while not held_lock:
                if not self._omni_gen_alive(gen):
                    S.log(f"omnivoice load discarded reason=stale-gen gen={gen}")
                    with self._tts_lock:
                        if gen == self._omni_gen:
                            self._omni_loading = False
                    return
                held_lock = S.try_acquire_omni_lock()
                if not held_lock:
                    if not self._omni_gen_alive(gen):
                        S.log(f"omnivoice load discarded reason=stale-gen gen={gen}")
                        with self._tts_lock:
                            if gen == self._omni_gen:
                                self._omni_loading = False
                        return
                    if not self._want_tts:
                        with self._tts_lock:
                            if gen == self._omni_gen:
                                self._omni_loading = False
                        self._announce_tts("off", "off")
                        return
                    S.log("omnivoice lock busy: another sidecar is loading; staying on Cargando voz… and waiting for lock release")
                    if self._tts_state != ("omnivoice", "loading"):
                        self._announce_tts("omnivoice", "loading")
                    S.time.sleep(0.5)
            if not self._omni_gen_alive(gen):
                S.log(f"omnivoice load discarded reason=stale-gen gen={gen}")
                with self._tts_lock:
                    if gen == self._omni_gen:
                        self._omni_loading = False
                return
            free, usable, _loaded = self._vram_budget()
            wav, txt = S.resolve_ref(S.ROOT, self.cfg.get("ttsRef"))
            if wav is not None and txt is not None:
                S.verify_ref_transcript(txt, S.log, "ttsRef")
            mood_refs = {}
            for name, raw in dict(self.cfg.get("ttsMoods") or {}).items():
                key = str(name or "").strip().lower()
                if not key or not raw:
                    continue
                m_wav, m_txt = S.resolve_ref(S.ROOT, raw)
                if m_wav is None or m_txt is None or not m_wav.is_file():
                    S.log(f"tts mood wav missing label={key} path={m_wav}")
                    continue
                if not S.verify_ref_transcript(m_txt, S.log, f"mood:{key}"):
                    continue
                mood_refs[key] = (m_wav, m_txt)
            omni = S.OmniVoiceTTS(
                S.MODELS,
                S.log,
                wav,
                txt,
                self.cfg.get("ttsSpeed"),
                S.tts_steps(self.cfg.get("ttsSteps")),
                mood_refs=mood_refs,
                instruct=self.cfg.get("ttsDesign"),
                notice=lambda msg: self.broadcast({"type": "notice", "message": msg}),
            )
            downloading = False
            try:
                # A missing torch/omnivoice must fail before "Descargando voz…": there is nothing to download.
                S.import_omnivoice()
                downloading = not S.model_cached(S.MODELS / "hf" / "hub", S.OMNI_MODEL)
                if downloading:
                    self._set_download(True)
                omni.load(allow_cpu=str(self.cfg.get("tts") or "").lower() == "omnivoice", free_vram=usable)
            except Exception as err:
                omni.close()
                S.log(f"omnivoice unavailable: {err}")
                if not self._omni_gen_alive(gen):
                    with self._tts_lock:
                        if gen == self._omni_gen:
                            self._omni_loading = False
                    return
                # No torch / no usable GPU: permanent until TTS settings change (survives restarts).
                if isinstance(err, (S.OmniVoiceUnavailable, ImportError, ModuleNotFoundError)):
                    self._omni_blocked = str(err)
                    self._write_omni_block(self._omni_blocked)
                    if not self._omni_notice_shown:
                        self._omni_notice_shown = True
                        self.broadcast({
                            "type": "notice",
                            "message": S.fallback_message(err),
                        })
                with self._tts_lock:
                    if gen != self._omni_gen:
                        return
                    self._omni_loading = False
                if not self._want_tts:
                    self._announce_tts("off", "off")
                    return
                self._ensure_kokoro()
                S.log(f"tts engine=kokoro reason=omnivoice-failed:{err} vram_free={free} vram_usable={usable}")
                self._announce_tts("kokoro", "fallback")
                return
            finally:
                if downloading:
                    self._set_download(False)
            if not self._want_tts:
                omni.close()
                try:
                    S.release_memory()
                except Exception:
                    pass
                with self._tts_lock:
                    if gen == self._omni_gen:
                        self._omni_loading = False
                S.log(f"tts unloaded reason=late-load vram_free={S.free_vram_mib()}")
                S.log(f"tts engine=off reason=replyMode={self.reply_mode()} vram_free={S.free_vram_mib()} vram_usable=n/a")
                if self._omni_gen_alive(gen):
                    self._announce_tts("off", "off")
                return
            with self._tts_lock:
                if gen != self._omni_gen:
                    stale = True
                else:
                    stale = False
                    had_notice = self._omni_notice_shown
                    self._omni = omni
                    self._omni_loading = False
                    self._omni_blocked = None
                    self._session_tts = omni
            if stale:
                omni.close()
                try:
                    S.release_memory()
                except Exception:
                    pass
                S.log(f"omnivoice load discarded reason=stale-gen gen={gen}")
                return
            S.log(f"tts engine=omnivoice reason=ready vram_free={S.free_vram_mib()} vram_usable={usable}")
            if had_notice:
                self.broadcast({"type": "notice", "message": "Ya cargó tu voz."})
            self._announce_tts("omnivoice", "ready")
            self._warn_low_vram()
        finally:
            if held_lock:
                S.release_omni_lock()

    def _synth(self, text: str, gain: bool = True, mood: str | None = None) -> tuple[S.np.ndarray, int]:
        # While OmniVoice loads or is blocked, speak with Kokoro instead of returning silence.
        if self._omni is not None:
            engine = self._omni
        elif self._omni_loading or self._omni_blocked:
            engine = self._ensure_kokoro()
        else:
            engine = self._session_tts or self._tts
            if engine is None:
                self.start_tts()
                engine = self._session_tts or self._omni or self._tts
            if engine is None or isinstance(engine, S.NullTTS):
                engine = self._ensure_kokoro()
        if engine is None or isinstance(engine, S.NullTTS):
            return S.np.zeros(0, dtype=S.np.float32), 24000
        self._last_tts_engine = self._engine_label(engine)
        use_mood = str(mood or getattr(self, "_reply_mood", None) or "").strip().lower() or None
        try:
            with self._synth_lock:
                try:
                    pcm, sr = engine.speak(text, mood=use_mood)
                except TypeError:
                    pcm, sr = engine.speak(text)
        except Exception as err:
            S.log(f"tts failed: {err}")
            return S.np.zeros(0, dtype=S.np.float32), 24000
        pcm = S.normalize_pcm(pcm)
        # Greeting caches keep the raw samples: the volume is applied when they are played.
        return (self._apply_gain(pcm) if gain else pcm), int(sr or 24000)

    def _apply_gain(self, pcm: S.np.ndarray) -> S.np.ndarray:
        try:
            gain = float(self.cfg.get("volume") if self.cfg.get("volume") is not None else 0.7)
        except (TypeError, ValueError):
            gain = 0.7
        gain = max(0.0, min(1.0, gain))
        return S.np.clip(pcm * gain, -1.0, 1.0)

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
                if S.greet_path(S.MODELS, ident) is None or not text:
                    continue
                self._greet_texts[ident] = text
            missing = self._greet_missing()
            if missing and not self._greet_busy:
                self._greet_busy = True
                fresh = True
        if fresh:
            S.log(f"greet pregen queued={len(missing)}")
            S.threading.Thread(target=self._greet_pregen, name="capri-greet", daemon=True).start()

    def _greet_missing(self) -> list[tuple[str, str]]:
        return [(ident, text) for ident, text in self._greet_texts.items() if not S.greet_path(S.MODELS, ident).is_file()]

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
            S.log(f"greet pregen done cached={done}")
        finally:
            with self._greet_lock:
                self._greet_busy = False

    def _await_omni(self, timeout: float = 120.0) -> bool:
        deadline = S.time.monotonic() + timeout
        while S.time.monotonic() < deadline and not self._closed:
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
            S.time.sleep(0.5)
        return False

    def _cache_greet(self, ident: str, text: str) -> bool:
        path = S.greet_path(S.MODELS, ident)
        if path is None or path.is_file():
            return False
        pcm, sr = self._synth(text, gain=False)
        if pcm.size == 0:
            S.log(f"greet cache skip id={ident} reason=no-audio")
            return False
        try:
            S.write_wav(path, pcm, sr)
        except OSError as err:
            S.log(f"greet cache failed id={ident}: {err}")
            return False
        S.log(f"greet cached id={ident} samples={pcm.size} sr={sr}")
        return True

    def _greet_audio(self, ident: str, text: str) -> tuple[S.np.ndarray, int]:
        path = S.greet_path(S.MODELS, ident)
        if path is not None:
            cached = S.read_wav(path)
            if cached is not None:
                pcm, sr = cached
                S.log(f"greet play id={ident} cached samples={pcm.size} sr={sr}")
                return self._apply_gain(pcm), sr
        if self._omni_loading and not self._omni_blocked:
            # An uncached greeting in the fallback voice is the wrong person: skip it this boot,
            # the pregen caches it once the clone is up.
            S.log(f"greet skip id={ident} reason=omnivoice-loading")
            return S.np.zeros(0, dtype=S.np.float32), 24000
        pcm, sr = self._synth(str(text), gain=False)
        if pcm.size == 0:
            return pcm, sr
        # Only OmniVoice greetings are worth keeping: never freeze a fallback voice in the cache.
        if path is not None and self._omni is not None:
            try:
                S.write_wav(path, pcm, sr)
                S.log(f"greet cached id={ident} samples={pcm.size} sr={sr}")
            except OSError as err:
                S.log(f"greet cache failed id={ident}: {err}")
        return self._apply_gain(pcm), sr

    def enqueue_greet(self, greet_id, text: str, reply_id=None) -> None:
        ident = str(greet_id or "").strip()
        line = str(text or "").strip()
        if S.greet_path(S.MODELS, ident) is None or not line:
            return
        rid = self._as_id(reply_id) or self._live_id
        if rid <= 0:
            S.log(f"greet drop without reply id={ident}")
            return
        S.log(f"greet id={rid} cache={ident}")
        self._speak_q.put(("greet", rid, (ident, line)))

    def _play(self, pcm: S.np.ndarray, sr: int, gen: int, rid: int = 0) -> bool:
        stream = None
        block = 2048
        try:
            stream = S.sd.OutputStream(samplerate=int(sr), channels=1, dtype="float32")
            self._out = stream
            stream.start()
            # play = audio ready -> first sample out (after OutputStream opens), not queue handoff.
            self._mark_play(rid or self._live_id)
            for i in range(0, pcm.size, block):
                if self._speak_stop.is_set() or gen != self._speak_gen:
                    self._abort_out()
                    return False
                chunk = pcm[i : i + block].reshape(-1, 1)
                stream.write(chunk)
            return True
        except Exception as err:
            S.log(f"playback failed: {err}")
            self._mark_play(rid or self._live_id)
            return True
        finally:
            if self._out is stream and stream is not None:
                try:
                    stream.stop()
                    stream.close()
                except Exception:
                    pass
                self._out = None

