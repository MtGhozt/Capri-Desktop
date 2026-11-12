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
from queue import Queue
import numpy as np
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
    eng._synth_lock = threading.Lock()
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

# (a) Lock held by another process for longer than wait:
# - does not announce kokoro ready and stays on Cargando voz…
# - when released, OmniVoice loads and speaks with the clone
events.clear()
call_count = [0]
def acquire_seq(*a, **k):
    call_count[0] += 1
    return call_count[0] > 1  # False first (busy), then True (released)

server.try_acquire_omni_lock = acquire_seq
server.release_omni_lock = lambda *a, **k: None

class SpeakOmni:
    def __init__(self, *args, **kwargs):
        pass
    def load(self, **kwargs):
        pass
    def speak(self, text, mood=None):
        return np.ones(1000, dtype=np.float32), 24000
    def close(self):
        pass

server.OmniVoiceTTS = SpeakOmni

eng = bare()
eng._omni_loading = True
eng._omni_gen = 1
eng._want_tts = True
eng._load_omni_bg(1)
assert not any(e.get("type") == "tts_state" and e.get("engine") == "kokoro" and e.get("state") == "ready" for e in events), events
assert eng._omni is not None
assert eng._tts is None, "Kokoro was loaded as a stand-in for the clone"
assert any(e.get("type") == "tts_state" and e.get("engine") == "omnivoice" and e.get("state") == "ready" for e in events), events
pcm, sr = eng._synth("hola choom")
assert pcm.size == 1000, pcm.size
assert eng._last_tts_engine.startswith("omnivoice"), eng._last_tts_engine

# (c) A reply that finishes before TTS is ready is spoken with the clone once ready, not skipped
events.clear()
eng2 = bare()
eng2._tts_lock = threading.Lock()
eng2._synth_lock = threading.Lock()
eng2._speak_q = Queue()
eng2._prep_q = Queue()
eng2._speak_stop = threading.Event()
eng2._accept_speak = True
eng2._synth_busy = False
eng2._speak_gen = 0
eng2._live_id = 0
eng2._held_phrase = ""
eng2._turns = {}
eng2._last_tts_engine = ""
eng2._apply_gain = lambda pcm: pcm
eng2._out = None
eng2._speaking = False
eng2._session_tts = None
eng2._omni_loading = True
eng2._omni_gen = 1
eng2._want_tts = True
eng2._synth_thread = threading.Thread(target=eng2._synth_loop, daemon=True)
eng2._synth_thread.start()

eng2.arm_speak(1)
eng2.enqueue_speak("espera que cargo mi voz", reply_id=1)
eng2.flush_speak(1)
# OmniVoice becomes ready
eng2._omni = SpeakOmni()
eng2._omni_loading = False
eng2._announce_tts("omnivoice", "ready")
# Wait for _synth_loop
t_dead = time.time() + 2
while not eng2._prep_q.qsize() and time.time() < t_dead:
    time.sleep(0.02)
assert eng2._prep_q.qsize() > 0, "reply finished before TTS ready was not spoken"
assert eng2._last_tts_engine.startswith("omnivoice"), eng2._last_tts_engine

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
  // turns 2 and 4: a reply that lands while the clone loads is sent, not skipped as silence
  assert.match(main, /if \(!voiceReplyOn\(\) \|\| !speakQueue\) return 0;/);
  assert.doesNotMatch(main, /function ttsOn/);
  const voice = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'voice.js'), 'utf8');
  assert.match(voice, /\.omnivoice\.lock/);
  assert.match(voice, /another Capri\/sidecar may be loading/);
});
