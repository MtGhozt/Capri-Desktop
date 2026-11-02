'use strict';

// Default voice (ttsRef null → design, not off) and custom .wav + transcript picker.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DEFAULTS } = require('../src/main/config');
const {
  DEFAULT_TTS_DESIGN,
  activeVoiceLabel,
  usesCloneRef,
  saveCustomRef,
} = require('../src/main/voice-ref');

function py(code) {
  const voice = path.join(__dirname, '..', 'voice');
  const venv = path.join(voice, '.venv', 'Scripts', 'python.exe');
  const bin = fs.existsSync(venv) ? venv : 'py';
  const args = bin === 'py' ? ['-3.11', '-c', code] : ['-c', code];
  const result = spawnSync(bin, args, { encoding: 'utf8', cwd: voice, timeout: 60_000 });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `exit ${result.status}`);
  }
  return String(result.stdout || '').trim();
}

test('ttsRef null → default voice path, not tts off', () => {
  assert.equal(DEFAULTS.voice.ttsRef, null);
  assert.equal(DEFAULTS.voice.ttsDesign, DEFAULT_TTS_DESIGN);
  assert.ok(String(DEFAULTS.voice.ttsDesign).length > 0);
  assert.equal(usesCloneRef({ ttsRef: null }), false);
  assert.equal(usesCloneRef({}), false);
  assert.equal(activeVoiceLabel({ ttsRef: null }), 'Voz por defecto');
  assert.equal(activeVoiceLabel({}), 'Voz por defecto');
  // Design voice is independent of the public “tts: off until you install” default.
  assert.notEqual(String(DEFAULTS.voice.ttsDesign || ''), 'off');

  const out = py(
    'from pathlib import Path; import tempfile; from tts import resolve_ref, design_instruct, DEFAULT_TTS_DESIGN; '
    + 'd=Path(tempfile.mkdtemp()); '
    + 'print(resolve_ref(d, None)); '
    + 'print(design_instruct(DEFAULT_TTS_DESIGN))',
  );
  const lines = out.split(/\r?\n/);
  assert.equal(lines[0], '(None, None)');
  assert.match(lines[1], /female/);
  assert.match(lines[1], /young adult/);
});

test('custom ttsRef is labeled as archivo', () => {
  assert.equal(usesCloneRef({ ttsRef: 'ref/my_ref.wav' }), true);
  assert.equal(activeVoiceLabel({ ttsRef: 'ref/my_ref.wav' }), 'Tu voz (archivo)');
});

test('custom ref picker rejects an empty transcript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-ref-'));
  const wav = path.join(dir, 'sample.wav');
  fs.writeFileSync(wav, 'RIFF');
  const bad = saveCustomRef({ voiceDir: dir, wavPath: wav, transcript: '   ' });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /transcripci[oó]n/i);
  assert.equal(fs.existsSync(path.join(dir, 'ref', 'my_ref.wav')), false);
});

test('custom ref picker copies wav+txt and returns ttsRef', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-ref-'));
  const wav = path.join(dir, 'sample.wav');
  fs.writeFileSync(wav, 'RIFF');
  const ok = saveCustomRef({
    voiceDir: dir,
    wavPath: wav,
    transcript: 'Hola choom, soy Capri.',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.ttsRef, 'ref/my_ref.wav');
  assert.ok(fs.existsSync(path.join(dir, 'ref', 'my_ref.wav')));
  assert.equal(
    fs.readFileSync(path.join(dir, 'ref', 'my_ref.txt'), 'utf8').trim(),
    'Hola choom, soy Capri.',
  );
});
