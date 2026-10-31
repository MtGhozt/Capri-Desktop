'use strict';

// Cached greetings: greet ids name a wav under models/omnivoice, the pregen only renders the
// missing ones once OmniVoice is ready, and playback reads the cache (raw, gain applied now).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { py, skip } = require('./voice-py');

const CHECK = `
import tempfile, threading, time
from pathlib import Path
from queue import Queue

import numpy as np

import greet
import server

tmp = Path(tempfile.mkdtemp())

# ids are plain names, never a path
assert greet.greet_path(tmp, "greet-1") == tmp / "omnivoice" / "greet-1.wav"
assert greet.greet_path(tmp, "../greet-1") is None
assert greet.greet_path(tmp, "greet-1/../greet-2") is None
assert greet.greet_path(tmp, "") is None

# wav roundtrip, and a broken file reads as None
wav = greet.greet_path(tmp, "greet-2")
greet.write_wav(wav, np.array([0.0, 0.5, -0.5], dtype=np.float32), 24000)
pcm, sr = greet.read_wav(wav)
assert sr == 24000 and pcm.size == 3
assert abs(float(pcm[1]) - 0.5) < 0.001 and abs(float(pcm[2]) + 0.5) < 0.001
assert greet.read_wav(wav.with_name("missing.wav")) is None
wav.write_bytes(b"not a wav")
assert greet.read_wav(wav) is None

# an Engine stripped to what the greeting cache touches
server.MODELS = tmp
engine = server.Engine.__new__(server.Engine)
engine.cfg = {"volume": 0.5}
engine._omni = object()
engine._tts = None
engine._session_tts = None
engine._omni_loading = False
engine._synth_lock = threading.Lock()
calls = []

def fake_synth(text, gain=True):
    calls.append(text)
    return np.full(8, 0.8, dtype=np.float32), 22050

engine._synth = fake_synth

# a missing cache is synthesized once and stored raw
third = greet.greet_path(tmp, "greet-3")
pcm, sr = engine._greet_audio("greet-3", "Hola.")
assert sr == 22050 and calls == ["Hola."]
assert third.is_file()
assert abs(float(pcm[0]) - 0.4) < 0.01  # volume 0.5 applied at playback

# next time it is the file, not the engine, and the corrupt greet-2 is replaced
pcm, sr = engine._greet_audio("greet-3", "Hola.")
assert calls == ["Hola."]
pcm, sr = engine._greet_audio("greet-2", "Otra.")
assert calls == ["Hola.", "Otra."] and greet.read_wav(wav) is not None

# pregen renders only the missing ones, and skips ids that are not greetings
engine._greet_texts = {}
engine._greet_lock = threading.Lock()
engine._greet_busy = False
engine._closed = False
engine._want_tts = True
engine.prepare_greetings([
    {"id": "greet-4", "text": "Buenas."},
    {"id": "../greet-5", "text": "x"},
    {"id": "greet-6", "text": ""},
])
fourth = greet.greet_path(tmp, "greet-4")
deadline = time.time() + 10
while not fourth.is_file() and time.time() < deadline:
    time.sleep(0.02)
assert fourth.is_file()
while engine._greet_busy and time.time() < deadline:
    time.sleep(0.02)
assert engine._greet_busy is False
assert not greet.greet_path(tmp, "greet-6").exists()

# an already cached greeting starts no thread
engine.prepare_greetings([{"id": "greet-4", "text": "Buenas."}])
assert engine._greet_busy is False

# the message reaches the speak queue under the reply id
engine._speak_q = Queue()
engine._live_id = 7
engine.enqueue_greet("greet-1", "Hola.", 7)
kind, rid, payload = engine._speak_q.get_nowait()
assert kind == "greet" and rid == 7 and payload == ("greet-1", "Hola.")

print("ok")
`;

test('greetings are cached once and played from the wav', { skip: skip() }, () => {
  assert.ok(py(CHECK).endsWith('ok'));
});
