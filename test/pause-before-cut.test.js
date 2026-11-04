'use strict';

// "Pausa antes de cortar" (Ajustes › OÍDO): how much silence ends a command. A 0.7 s pause
// used to cut a sentence at the first thinking pause, so the rest was never transcribed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pauseBeforeCutMs, PAUSE_LEVELS } = require('../src/main/hearing');
const { sidecarConfig } = require('../src/main/voice-config');
const { py, skip } = require('./voice-py');

// config.js asks Electron where userData is: point it at a temp dir instead
function freshConfig(dir) {
  const load = Module._load;
  Module._load = function stub(request, ...rest) {
    if (request === 'electron') return { app: { getPath: () => dir } };
    return load.call(this, request, ...rest);
  };
  try {
    const file = require.resolve('../src/main/config');
    delete require.cache[file];
    return require(file);
  } finally {
    Module._load = load;
  }
}

test('Corta / Normal / Larga are 0.8 / 1.4 / 2.2 s, Normal when unknown', () => {
  assert.deepEqual(PAUSE_LEVELS, { short: 800, normal: 1400, long: 2200 });
  assert.equal(pauseBeforeCutMs('short'), 800);
  assert.equal(pauseBeforeCutMs('normal'), 1400);
  assert.equal(pauseBeforeCutMs('long'), 2200);
  assert.equal(pauseBeforeCutMs('LONG'), 2200);
  assert.equal(pauseBeforeCutMs(undefined), 1400); // old configs: the safer pause
  assert.equal(pauseBeforeCutMs('nonsense'), 1400);
});

test('the sidecar receives the pause in milliseconds, not the preset name', () => {
  const cfg = { voice: { pauseBeforeCut: 'long' } };
  assert.equal(sidecarConfig(cfg).commandSilenceMs, 2200);
  assert.equal(sidecarConfig({ voice: {} }).commandSilenceMs, 1400);
});

test('Normal is the default, and an old config.json keeps it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-pause-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(freshConfig(dir).load().voice.pauseBeforeCut, 'normal');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ voice: { enabled: true } }));
  assert.equal(freshConfig(dir).load().voice.pauseBeforeCut, 'normal');
});

test('the chosen pause is saved and survives other settings', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-pause-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  freshConfig(dir).save({ voice: { pauseBeforeCut: 'long' } });
  const again = freshConfig(dir);
  assert.equal(again.load().voice.pauseBeforeCut, 'long');
  again.save({ wander: false });
  assert.equal(freshConfig(dir).load().voice.pauseBeforeCut, 'long');
});

// The adaptive rule lives in voice/server.py: a short false start gets the shorter pause.
const CHECK = `
import server

# a short utterance ends after ~1 s, whatever the preset
assert server.end_silence_ms(1400, 400) == 1000, server.end_silence_ms(1400, 400)
assert server.end_silence_ms(2200, 1499) == 1000
# a real sentence gets the whole configured pause
assert server.end_silence_ms(1400, 4352) == 1400
assert server.end_silence_ms(2200, 5000) == 2200
# Corta stays corta, even for a false start
assert server.end_silence_ms(800, 200) == 800
# a bad or missing value uses the 1.4 s default
assert server.end_silence_ms(None, 4000) == 1400
assert server.end_silence_ms("nope", 4000) == 1400
assert server.end_silence_ms(0, 4000) == 1400
print("ok")
`;

test('the sidecar cuts on the chosen pause, shorter while the phrase is short', (t) => {
  const reason = skip();
  if (reason) return t.skip(reason);
  assert.equal(py(CHECK), 'ok');
});

// The cut itself (voice/server.py _capture_chunk): the reported log was speech_ms=4352
// silence_ms=736, and that 0.7 s pause ended the utterance in the middle of the sentence.
const CUT = `
import asyncio, threading
import numpy as np
import server

class VAD:
    loud = 0.0
    def reset(self): pass
    def prob(self, frame): return self.loud

cut = []
class FakeAsyncio:
    @staticmethod
    def run_coroutine_threadsafe(coro, loop):
        cut.append(True)
        coro.close()
server.asyncio = FakeAsyncio
vad = VAD()

def at(seconds, speech_ms, silence_ms, hold=False):
    eng = server.Engine.__new__(server.Engine)
    eng.cfg = {"commandSilenceMs": 1400}
    eng._lock = threading.Lock()
    eng.capturing = True
    eng.hold = hold
    eng.follow = False
    eng.follow_s = 0.0
    eng.buffer = np.zeros(0, dtype=np.float32)
    eng.vad_buf = np.zeros(0, dtype=np.float32)
    eng.speech_ms = speech_ms
    eng.silence_ms = silence_ms
    eng._vad = vad
    eng.loop = None
    eng.started_at = 100.0
    return eng

def feeds(eng, seconds):
    cut.clear()
    eng._capture_chunk(np.zeros(1024, dtype=np.float32), 100.0 + seconds)
    return bool(cut)

# the reported case: 0.736 s pause used to cut here; now (speech > 1.5 s) it waits for 1.4 s
assert not feeds(at(11, 4352, 700), 11), "a 0.7 s pause still cuts a full sentence"
assert feeds(at(11, 4352, 1350), 11), "a 1.4 s pause did not cut"

# a false start (< 1.5 s of speech) ends after ~1 s, and Corta stays 0.8 s
assert feeds(at(3, 800, 1000), 3), "a short phrase waited for the long pause"
short = at(3, 800, 760); short.cfg["commandSilenceMs"] = 800
assert feeds(short, 3), "Corta did not cut at 0.8 s"

# nobody spoke: the 10 s timeout still closes the mic
assert feeds(at(11, 0, 9000), 11), "silent listen no longer times out"

# a long sentence is not cut at 10 s; only the 30 s cap ends it
assert not feeds(at(11, 9000, 0), 11), "a sentence in progress was cut at 10 s"
assert feeds(at(31, 9000, 0), 31), "the 30 s cap did not fire"
print("ok")
`;

test('a full sentence survives its thinking pauses; the caps still close the mic', (t) => {
  const reason = skip();
  if (reason) return t.skip(reason);
  assert.equal(py(CUT), 'ok');
});
