'use strict';

// A voice folder without torch must not retry OmniVoice on every reply, and must not announce a
// download: the RX 6550M support case repeated "omnivoice unavailable" and "Descargando voz…".

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { py, skip } = require('./voice-py');

const CHECK = `
import threading
import server

logs = []
events = []
server.log = logs.append
server.free_vram_mib = lambda: 1234

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

server.OmniVoiceTTS = FakeOmni
server.load_kokoro = lambda models, log, speed: object()
server.try_acquire_omni_lock = lambda *a, **k: True
server.release_omni_lock = lambda *a, **k: None

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
    }
    eng._tts_lock = threading.Lock()
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
    eng._vram_budget = lambda: (3000, 3000, False)
    eng.broadcast = events.append
    eng._set_download = lambda on: events.append({"type": "download", "on": on})
    return eng

eng = bare()
eng._load_omni_bg(1)
assert eng._omni_blocked, logs
notices = [e for e in events if e.get("type") == "notice"]
assert len(notices) == 1 and "Torch" in notices[0]["message"], events
assert not [e for e in events if e.get("type") == "download"], "announced Descargando without torch"
assert eng._tts is not None, "did not fall back to Kokoro"

eng.start_tts()
eng.start_tts()
assert FakeOmni.calls == 1, "OmniVoice was retried without torch"
assert len([e for e in events if e.get("type") == "notice"]) == 1, "notice repeated"

print("TORCH_MISSING_OK")
`;

test('missing torch blocks OmniVoice once, with no download state or retries', { timeout: 120000, skip: skip() }, () => {
  const out = py(CHECK);
  assert.equal(out.split('\n').pop(), 'TORCH_MISSING_OK', out);
});
