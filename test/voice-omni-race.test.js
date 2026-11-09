'use strict';

// Concurrent OmniVoice loads used to race (dtype float!=Half), announce Kokoro fallback, then
// leave the UI on Kokoro even when a later load reached ready with the clone.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { py, skip } = require('./voice-py');

const CHECK = `
import threading
import time
import tempfile
from pathlib import Path
import server

logs = []
events = []
server.log = logs.append
server.free_vram_mib = lambda: 4096
_real_acquire = server.try_acquire_omni_lock
_real_release = server.release_omni_lock
server.try_acquire_omni_lock = lambda *a, **k: True
server.release_omni_lock = lambda *a, **k: None

class FakeEngine:
    def close(self):
        pass

class SlowThenOkOmni:
    calls = 0
    barrier = threading.Barrier(2)
    def __init__(self, *args, **kwargs):
        SlowThenOkOmni.calls += 1
        self.n = SlowThenOkOmni.calls
    def load(self, **kwargs):
        # First concurrent call fails like a dtype race; the second succeeds.
        if self.n == 1:
            SlowThenOkOmni.barrier.wait(timeout=5)
            raise RuntimeError("expected mat1 and mat2 to have the same dtype, but got: float != Half")
        SlowThenOkOmni.barrier.wait(timeout=5)
        time.sleep(0.05)
    def close(self):
        pass

class OkOmni:
    def __init__(self, *args, **kwargs):
        pass
    def load(self, **kwargs):
        pass
    def close(self):
        pass

server.load_kokoro = lambda models, log, speed: FakeEngine()

def bare():
    eng = server.Engine.__new__(server.Engine)
    eng.cfg = {
        "tts": "auto", "ttsRef": "ref/my_ref.wav", "ttsDesign": "voz",
        "ttsMoods": {}, "ttsSpeed": 1.0, "ttsSteps": 16, "replyMode": "voice",
        "sleeping": False, "localLlm": False, "enabled": True, "inputDevice": None,
    }
    eng._tts_lock = threading.Lock()
    eng._tts = None
    eng._omni = None
    eng._omni_loading = False
    eng._omni_blocked = None
    eng._omni_notice_shown = False
    eng._omni_gen = 0
    eng._want_tts = False
    eng._tts_state = ("off", "off")
    eng._tts_announced = False
    eng._downloads = 0
    eng._session_tts = None
    eng._vram_budget = lambda: (4000, 4000, False)
    eng.broadcast = events.append
    eng._set_download = lambda on: None
    eng.reply_mode = lambda: "voice"
    return eng

# 1) Already-loaded Omni skips the blocked branch.
eng = bare()
eng._omni = OkOmni()
eng._omni_blocked = "stale block from a racing failure"
eng.start_tts()
assert any(e.get("type") == "tts_state" and e.get("engine") == "omnivoice" and e.get("state") == "ready" for e in events), events
assert eng._omni is not None

# 2) start_tts is atomic: only one load thread.
events.clear()
SlowThenOkOmni.calls = 0
server.OmniVoiceTTS = SlowThenOkOmni
eng = bare()
threads = []
eng.start_tts()
eng.start_tts()
eng.start_tts()
assert SlowThenOkOmni.calls == 0  # thread may not have started yet
# Give the single worker a moment; FakeOmni is constructed inside the thread.
deadline = time.time() + 2
while SlowThenOkOmni.calls < 1 and time.time() < deadline:
    time.sleep(0.02)
# Only one constructor call despite three start_tts.
time.sleep(0.1)
assert SlowThenOkOmni.calls == 1, SlowThenOkOmni.calls
# Unblock / finish the failing load without a second spawn.
eng._omni_gen += 1  # drop mid-flight so it cannot announce fallback
eng._omni_loading = False
time.sleep(0.2)

# 3) Success clears blocked + notifies after a prior fallback notice.
events.clear()
logs.clear()
server.OmniVoiceTTS = OkOmni
eng = bare()
eng._omni_notice_shown = True
eng._omni_blocked = "old"
eng._omni_loading = True
eng._omni_gen = 7
eng._want_tts = True
eng._load_omni_bg(7)
assert eng._omni_blocked is None, eng._omni_blocked
assert eng._omni is not None
assert any(e.get("type") == "notice" and "Ya cargó tu voz" in e.get("message", "") for e in events), events
assert any(e.get("type") == "tts_state" and e.get("state") == "ready" for e in events), events

# 4) Stale gen after drop must not overwrite a newer engine or announce fallback.
events.clear()
logs.clear()
eng = bare()
eng._omni_loading = True
eng._omni_gen = 3
eng._want_tts = True
server.OmniVoiceTTS = OkOmni
# Drop bumped the generation before this worker applies results.
eng._omni_gen = 4
eng._omni = OkOmni()
eng._load_omni_bg(3)
assert eng._omni_gen == 4
assert not any(e.get("type") == "tts_state" and e.get("state") == "fallback" for e in events), events
assert any("stale-gen" in line for line in logs), logs

# 5) Cross-process lock: exclusive create + stale steal.
server.try_acquire_omni_lock = _real_acquire
server.release_omni_lock = _real_release
tmpdir = Path(tempfile.mkdtemp(prefix="capri-omni-lock-"))
lock = tmpdir / ".omnivoice.lock"
assert _real_acquire(lock, wait_s=0.2, sleep_fn=lambda s: None) is True
assert _real_acquire(lock, wait_s=0.05, sleep_fn=lambda s: None) is False
# Stale: mtime in the past
import os
os.utime(lock, (time.time() - 200, time.time() - 200))
assert _real_acquire(lock, stale_s=120, wait_s=0.2, sleep_fn=lambda s: None) is True
_real_release(lock)

# Busy lock → Kokoro ready without clone-failure notice
events.clear()
server.try_acquire_omni_lock = lambda *a, **k: False
server.release_omni_lock = lambda *a, **k: None
eng = bare()
eng._omni_loading = True
eng._omni_gen = 1
eng._want_tts = True
eng._load_omni_bg(1)
assert eng._tts is not None
assert eng._omni is None
assert not any(e.get("type") == "notice" for e in events), events
assert any(e.get("type") == "tts_state" and e.get("engine") == "kokoro" and e.get("state") == "ready" for e in events), events

print("OMNI_RACE_OK")
`;

test('OmniVoice load races: one thread, gen guard, lock, recover notice', { timeout: 120000, skip: skip() }, () => {
  const out = py(CHECK);
  assert.equal(out.split('\n').pop(), 'OMNI_RACE_OK', out);
});

test('main warns on single-instance quit and voice.js checks OmniVoice lock', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /another Capri is already running/);
  const voice = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'voice.js'), 'utf8');
  assert.match(voice, /\.omnivoice\.lock/);
  assert.match(voice, /another Capri\/sidecar may be loading/);
});
