'use strict';

// Resource release: leaving voice mode or idling in DORMANT frees OmniVoice/Kokoro, and a
// muted mic eventually frees Whisper. Engine is built with __new__ so no daemon threads run.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function py(code) {
  const voice = path.join(__dirname, '..', 'voice');
  const venv = path.join(voice, '.venv', 'Scripts', 'python.exe');
  const bin = fs.existsSync(venv) ? venv : 'py';
  const args = bin === 'py' ? ['-3.11', '-c', code] : ['-c', code];
  const result = spawnSync(bin, args, { encoding: 'utf8', cwd: voice, timeout: 120000 });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `exit ${result.status}`);
  }
  return String(result.stdout || '').trim();
}

const CHECK = `
import threading, time
import numpy as np
import server

logs = []
released = []
server.log = logs.append
server.free_vram_mib = lambda: 1234
server.release_memory = lambda: released.append(1)

class FakeEngine:
    def __init__(self, name):
        self.name = name
        self.closed = False
    def close(self):
        self.closed = True

def bare():
    eng = server.Engine.__new__(server.Engine)
    eng.cfg = {
        "ttsIdleUnloadMin": 10,
        "sttIdleUnloadMin": 10,
        "sleeping": False,
        "enabled": True,
        "replyMode": "voice",
        "tts": "auto",
        "ttsSteps": 16,
    }
    eng._tts_lock = threading.Lock()
    eng._stt_lock = threading.Lock()
    eng._omni = None
    eng._tts = None
    eng._omni_loading = False
    eng._want_tts = True
    eng._session_tts = None
    eng._whisper = None
    eng._sleep_since = 0.0
    eng._mic_off_since = 0.0
    eng._cfg_ready = False
    return eng

def unload_lines():
    return [line for line in logs if line.startswith("tts unloaded")]

# minutes -> seconds; 0 disables, bad values fall back to the default
assert server.idle_unload_seconds(0) == 0
assert server.idle_unload_seconds(10) == 600
assert server.idle_unload_seconds("2.5") == 150
assert server.idle_unload_seconds(None) == 600
assert server.idle_unload_seconds("nope") == 600

# leaving voice mode closes OmniVoice and Kokoro, releases CUDA and logs once
eng = bare()
omni, kokoro = FakeEngine("omni"), FakeEngine("kokoro")
eng._omni, eng._tts = omni, kokoro
eng._drop_tts("replyMode=blips")
assert omni.closed and kokoro.closed, "engines were not closed"
assert eng._omni is None and eng._tts is None, "engine slots were not cleared"
assert released, "release_memory was not called"
assert unload_lines() == ["tts unloaded reason=replyMode=blips vram_free=1234"], logs
eng._drop_tts("replyMode=blips")
assert len(unload_lines()) == 1, "unload was logged twice: %r" % logs

# the menu can switch modes while the mic is muted: apply_cfg unloads anyway
logs.clear(); released.clear()
eng = bare()
eng.restart_stream = lambda: None
eng._omni = FakeEngine("omni")
eng._tts = FakeEngine("kokoro")
eng.apply_cfg({"enabled": False, "replyMode": "silent"})
assert eng._omni is None and eng._tts is None, "muted mode change kept an engine"
assert eng._want_tts is False, "late load was not cancelled"
assert eng._mic_off_since > 0, "muted timer did not start"
assert unload_lines() == ["tts unloaded reason=replyMode=silent vram_free=1234"], logs

# waking and unmuting clears both timers
eng.apply_cfg({"enabled": True, "sleeping": False, "replyMode": "voice"})
assert eng._mic_off_since == 0.0, "muted timer did not reset"
assert eng._sleep_since == 0.0, "sleep timer did not reset"

# folded long enough: OmniVoice goes after ttsIdleUnloadMin, not before
logs.clear(); released.clear()
eng = bare()
eng._omni = FakeEngine("omni")
eng._sleep_since = time.monotonic() - 60
eng._maybe_unload_idle()
assert eng._omni is not None, "unloaded before the limit"
eng._sleep_since = time.monotonic() - 11 * 60
eng._maybe_unload_idle()
assert eng._omni is None, "DORMANT idle kept OmniVoice"
assert eng._want_tts is False, "late load was not cancelled"
assert unload_lines() == ["tts unloaded reason=dormant-idle vram_free=1234"], logs

# 0 minutes disables the idle unload entirely
eng = bare()
eng.cfg["ttsIdleUnloadMin"] = 0
eng._omni = FakeEngine("omni")
eng._sleep_since = time.monotonic() - 60 * 60
eng._maybe_unload_idle()
assert eng._omni is not None, "0 minutes should keep OmniVoice"

# mic muted long enough: Whisper goes after sttIdleUnloadMin, not before
logs.clear(); released.clear()
eng = bare()
eng._whisper = object()
eng._mic_off_since = time.monotonic() - 60
eng._maybe_unload_idle()
assert eng._whisper is not None, "Whisper unloaded too early"
eng._mic_off_since = time.monotonic() - 11 * 60
eng._maybe_unload_idle()
assert eng._whisper is None, "muted idle kept Whisper"
assert any(line.startswith("stt unloaded reason=mic-idle vram_free=") for line in logs), logs

# folded: no fresh OmniVoice load until wake
logs.clear()
announced = []
eng = bare()
eng.cfg["sleeping"] = True
eng._announce_tts = lambda *args: announced.append(args)
eng.start_tts()
assert announced == [("off", "off")], announced
assert eng._omni_loading is False, "a load was started while folded"
assert any(line.startswith("tts engine=off reason=sleeping") for line in logs), logs

# transcribe holds a local reference so an idle unload cannot null it mid-call
class Seg:
    def __init__(self, text):
        self.text = text

class Whisper:
    def transcribe(self, audio, **kwargs):
        self.seen = kwargs
        return [Seg(" hola "), Seg("choom ")], {}

eng = bare()
whisper = Whisper()
eng._whisper = whisper
eng._stt_beam = 5
eng.ensure_stt = lambda: None
text = eng.transcribe(np.zeros(8, dtype=np.float32))
assert text == "hola choom", text
assert whisper.seen["beam_size"] == 5

print("IDLE_UNLOAD_OK")
`;

test('voice sidecar releases engines when silent, folded or muted', { timeout: 120000 }, () => {
  const out = py(CHECK);
  assert.equal(out.split('\n').pop(), 'IDLE_UNLOAD_OK', out);
});
