'use strict';

// Default voice (ttsRef null → design, not off) and custom .wav + transcript picker.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { py, skip } = require('./voice-py');
const { DEFAULTS } = require('../src/main/config');
const {
  DEFAULT_TTS_DESIGN,
  activeVoiceLabel,
  usesCloneRef,
  transcriptFor,
  saveCustomRef,
} = require('../src/main/voice-ref');

test('ttsRef null → default voice path, not tts off', { skip: skip() }, () => {
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
  assert.equal(activeVoiceLabel({ ttsRef: 'ref/my_ref.wav' }), 'Tu voz (my_ref.wav)');
  assert.equal(activeVoiceLabel({ ttsRef: 'ref/my_ref.wav', ttsSourceName: 'capri_ref.wav' }), 'Tu voz (capri_ref.wav)');
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
  assert.equal(ok.sourceName, 'sample.wav');
  assert.ok(fs.existsSync(path.join(dir, 'ref', 'my_ref.wav')));
  assert.equal(
    fs.readFileSync(path.join(dir, 'ref', 'my_ref.txt'), 'utf8').trim(),
    'Hola choom, soy Capri.',
  );
});

test('custom ref picker loads a matching transcript file beside the wav', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-ref-'));
  const wav = path.join(dir, 'sample.wav');
  fs.writeFileSync(wav, 'RIFF');
  fs.writeFileSync(path.join(dir, 'sample.txt'), 'Hola desde archivo.\n');
  const ok = saveCustomRef({ voiceDir: dir, wavPath: wav });
  assert.equal(ok.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'ref', 'my_ref.txt'), 'utf8').trim(), 'Hola desde archivo.');
});

test('a same-name .txt prefills the transcript field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-ref-'));
  try {
    const wav = path.join(dir, 'sample.wav');
    fs.writeFileSync(wav, 'RIFF');
    fs.writeFileSync(path.join(dir, 'sample.txt'), '  Hola desde archivo.\n');
    assert.equal(transcriptFor(wav), 'Hola desde archivo.');
    assert.equal(transcriptFor(wav, path.join(dir, 'sample.txt')), 'Hola desde archivo.');
    assert.equal(transcriptFor(wav, path.join(dir, 'missing.txt')), '');
    assert.equal(transcriptFor(path.join(dir, 'other.wav')), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the typed transcript wins over an old same-name .txt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-ref-'));
  try {
    const wav = path.join(dir, 'sample.wav');
    fs.writeFileSync(wav, 'RIFF');
    fs.writeFileSync(path.join(dir, 'sample.txt'), 'Texto viejo.\n');
    const ok = saveCustomRef({ voiceDir: dir, wavPath: wav, transcript: 'Lo que escribí.' });
    assert.equal(ok.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'ref', 'my_ref.txt'), 'utf8').trim(), 'Lo que escribí.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Guardar voz explains what is missing', async () => {
  globalThis.matchMedia = globalThis.matchMedia || (() => ({ matches: false }));
  const { voiceRefMissing } = await import('../src/renderer/js/util.js');
  assert.equal(voiceRefMissing({}), 'Falta elegir el audio');
  assert.equal(voiceRefMissing({ wav: 'C:\\audio.wav', transcript: '  ' }), 'Falta escribir lo que dice el audio');
  assert.equal(voiceRefMissing({ wav: 'C:\\audio.wav', transcript: 'Hola.' }), '');
});

test('the voice panel shows the two steps and the transcript field', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /1\) Elegí tu audio \.wav/);
  assert.match(source, /Qué dice el audio \(palabra por palabra\)/);
  assert.match(source, /Cargar \.txt/);
  assert.match(source, /Se guarda en:/);
  assert.match(source, /voiceRefMissing/);
  assert.match(source, /No se guardó la voz/);
});

test('voice loading only shows a percentage for real non-zero progress', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'bubble.js'), 'utf8');
  assert.match(source, /Number\.isFinite\(pct\) && pct > 0/);
  assert.match(source, /Cargando voz/);
  assert.match(source, /is-indeterminate/);
});
