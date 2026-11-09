'use strict';

// A GPU that cannot run OmniVoice must say it once and stay on Kokoro for the session,
// instead of logging "omnivoice unavailable" on every reply.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { py, skip } = require('./voice-py');

const CHECK = `
import threading
import server
import tts

logs = []
notices = []
server.log = logs.append
server.free_vram_mib = lambda: 1234

class FakeEngine:
    def close(self):
        pass

class FakeOmni:
    calls = 0
    def __init__(self, *args, **kwargs):
        FakeOmni.calls += 1
    def load(self, **kwargs):
        raise tts.OmniVoiceUnavailable("omnivoice skipped GPU: vram 1730 MiB < 2000")
    def close(self):
        pass

server.OmniVoiceTTS = FakeOmni
server.load_kokoro = lambda models, log, speed: FakeEngine()

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
    eng._want_tts = True
    eng._vram_budget = lambda: (3000, 3000, False)
    eng.broadcast = notices.append
    return eng

eng = bare()
eng._load_omni_bg()
assert eng._omni_blocked, logs
assert [n["message"] for n in notices if n.get("type") == "notice"] == [
    "La GPU no tiene memoria libre suficiente para clonar voz; uso la voz normal."
], notices
assert eng._omni is None and eng._tts is not None, "did not fall back to Kokoro"
assert any("state=fallback" in line for line in logs), logs

eng.start_tts()
eng.start_tts()
assert FakeOmni.calls == 1, "OmniVoice was retried after a GPU failure"
assert len([n for n in notices if n.get("type") == "notice"]) == 1, "notice repeated"

# An explicit voice setting change is the one thing allowed to retry OmniVoice.
eng.stream = None
eng.stream_needed = lambda: False
eng.restart_stream = lambda: None
eng.stop_speak = lambda: None
eng._sleep_since = 0.0
eng._mic_off_since = 0.0
eng._cfg_ready = False
eng.apply_cfg({"ttsRef": "ref/other.wav"})
assert eng._omni_blocked is None, "settings change kept the GPU block"
assert eng._omni_notice_shown is False, "settings change kept the notice flag"

print("TTS_FALLBACK_OK")
`;

test('a GPU failure falls back to Kokoro once per session', { timeout: 120000, skip: skip() }, () => {
  const out = py(CHECK);
  assert.equal(out.split('\n').pop(), 'TTS_FALLBACK_OK', out);
});
