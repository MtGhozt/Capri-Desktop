'use strict';

// A voice folder without torch must not retry OmniVoice on every reply, and must not announce a
// download: the RX 6550M support case repeated "omnivoice unavailable" and "Descargando voz…".
// Cloned-voice + restart must not leave the UI on "Cargando voz…" or synth 0 samples.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { py, skip } = require('./voice-py');

const CHECK = `
import threading
import numpy as np
import server

logs = []
events = []
server.log = logs.append
server.free_vram_mib = lambda: 1234
server.OMNI_BLOCK_FILE = server.MODELS / ".omni_blocked_test_torch"
try:
    server.OMNI_BLOCK_FILE.unlink(missing_ok=True)
except Exception:
    pass

def no_torch(*args, **kwargs):
    raise ModuleNotFoundError("No module named 'torch'")

server.import_omnivoice = no_torch

class FakeOmni:
    calls = 0
    def __init__(self, *args, **kwargs):
        FakeOmni.calls += 1
    def load(self, **kwargs):
        raise AssertionError("load() must not run without torch")
    def close(self):
        pass

class FakeKokoro:
    def speak(self, text, mood=None):
        return np.ones(800, dtype=np.float32), 24000
    def close(self):
        pass

server.OmniVoiceTTS = FakeOmni
server.load_kokoro = lambda models, log, speed: FakeKokoro()
server.try_acquire_omni_lock = lambda *a, **k: True
server.release_omni_lock = lambda *a, **k: None
server.resolve_ref = lambda *a, **k: (None, None)

def bare():
    eng = server.Engine.__new__(server.Engine)
    eng.cfg = {
        "tts": "auto",
        "ttsRef": "ref/my_ref.wav",
        "ttsDesign": "voz femenina",
        "ttsMoods": {},
        "ttsSpeed": 1.0,
        "ttsSteps": 16,
        "replyMode": "voice",
        "sleeping": False,
        "localLlm": False,
        "enabled": True,
        "inputDevice": None,
        "muted": False,
        "volume": 0.7,
    }
    eng._tts_lock = threading.Lock()
    eng._synth_lock = threading.Lock()
    eng._tts = None
    eng._omni = None
    eng._omni_loading = True
    eng._omni_blocked = None
    eng._omni_notice_shown = False
    eng._omni_gen = 1
    eng._want_tts = True
    eng._tts_state = ("off", "off")
    eng._tts_announced = False
    eng._downloads = 0
    eng._session_tts = None
    eng._reply_mood = None
    eng._last_tts_engine = ""
    eng._vram_budget = lambda: (3000, 3000, False)
    eng.broadcast = events.append
    eng._set_download = lambda on: events.append({"type": "download", "on": on})
    return eng

eng = bare()
eng._load_omni_bg(1)
assert eng._omni_blocked, logs
assert eng._omni_loading is False, "loading flag stuck after torch miss"
notices = [e for e in events if e.get("type") == "notice"]
assert len(notices) == 1 and "Torch" in notices[0]["message"], events
assert not [e for e in events if e.get("type") == "download"], "announced Descargando without torch"
assert eng._tts is not None, "did not fall back to Kokoro"
assert server.OMNI_BLOCK_FILE.is_file(), "block file missing"

# A "fresh" sidecar (in-memory cleared) still honors the block file: no loading, no retry.
events.clear(); FakeOmni.calls = 0
eng2 = bare()
eng2._omni_loading = False
eng2._omni_blocked = None
eng2._omni_notice_shown = False
eng2._omni_gen = 0
eng2.start_tts()
eng2.start_tts()
assert FakeOmni.calls == 0, "OmniVoice was retried after restart with block file"
assert eng2._tts_state == ("kokoro", "fallback"), eng2._tts_state
loading = [e for e in events if e.get("type") == "tts_state" and e.get("state") == "loading"]
assert not loading, "UI stuck on Cargando voz after restart"
assert len([e for e in events if e.get("type") == "notice"]) == 1, events

# Speak while OmniVoice is "loading": Kokoro audio, never samples=0 + talking_done skipped.
events.clear(); logs.clear()
eng3 = bare()
eng3._omni_loading = True
eng3._omni = None
eng3._omni_blocked = None
eng3._tts = None
pcm, sr = eng3._synth("hola choom")
assert pcm.size > 0 and sr > 0, (pcm.size, sr)
assert eng3._last_tts_engine == "kokoro", eng3._last_tts_engine

# Empty synth still completes the talk cycle (no silent skip).
events.clear()
eng3._live_id = 7
eng3._accept_speak = True
eng3._speak_gen = 1
eng3._finish_empty_synth(7, "no-engine")
kinds = [e.get("type") for e in events]
assert kinds == ["talking", "talking_done"], events
assert events[1].get("empty") is True

# Wake from sleeping: start_tts runs, not left engine=off reason=sleeping.
events.clear(); logs.clear()
eng4 = bare()
eng4._omni_loading = False
eng4._omni_blocked = "No module named 'torch'"
eng4.stream = None
eng4.restart_stream = lambda: None
eng4.cfg["sleeping"] = True
eng4.apply_cfg({"sleeping": False, "replyMode": "voice"})
assert eng4.cfg.get("sleeping") is False
assert eng4._tts_state[0] == "kokoro", eng4._tts_state
assert not any(e.get("engine") == "off" and e.get("reason") == "sleeping" for e in events), events

print("TORCH_MISSING_OK")
`;

test('missing torch blocks OmniVoice once, with no download state or retries', { timeout: 120000, skip: skip() }, () => {
  const out = py(CHECK);
  assert.equal(out.split('\n').pop(), 'TORCH_MISSING_OK', out);
});
