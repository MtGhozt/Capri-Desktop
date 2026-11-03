'use strict';

// Ajustes › AUDIO › Instalar voz: LOCALAPPDATA target, allowlisted sources only, no ref/wav.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PYTHON_URL,
  VOICE_FILES,
  voiceInstallDir,
  hasVoiceSources,
  bundledVoiceDir,
  findPython311,
  isBlockedVoicePath,
  ensureVoiceSources,
  createVoiceInstall,
} = require('../src/main/voice-install');

test('install dir is under LOCALAPPDATA\\capri-desktop\\voice', () => {
  const dir = voiceInstallDir({ LOCALAPPDATA: 'C:\\Users\\M\\AppData\\Local' });
  assert.equal(dir, path.join('C:\\Users\\M\\AppData\\Local', 'capri-desktop', 'voice'));
});

test('blocked paths never include clone audio or random transcripts', () => {
  assert.equal(isBlockedVoicePath('ref/capri.wav'), true);
  assert.equal(isBlockedVoicePath('ref/capri.txt'), true);
  assert.equal(isBlockedVoicePath('models/foo.wav'), true);
  assert.equal(isBlockedVoicePath('../server.py'), true);
  assert.equal(isBlockedVoicePath('server.py'), false);
  assert.equal(isBlockedVoicePath('requirements.txt'), false);
  assert.equal(isBlockedVoicePath('models/hey_capri.onnx'), false);
});

test('bundled voice is detected only with server.py + setup.ps1', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(bundledVoiceDir(root), null);
  const voice = path.join(root, 'voice');
  fs.mkdirSync(voice);
  fs.writeFileSync(path.join(voice, 'server.py'), 'print(1)\n');
  assert.equal(hasVoiceSources(voice), false);
  fs.writeFileSync(path.join(voice, 'setup.ps1'), '# hi\n');
  assert.equal(bundledVoiceDir(root), voice);
});

test('ensureVoiceSources copies allowlisted files from a local voice/ folder', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-src-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-dst-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });
  const voice = path.join(root, 'voice');
  fs.mkdirSync(path.join(voice, 'models'), { recursive: true });
  fs.mkdirSync(path.join(voice, 'ref'), { recursive: true });
  for (const rel of VOICE_FILES) {
    fs.writeFileSync(path.join(voice, rel), `# ${rel}\n`);
  }
  fs.writeFileSync(path.join(voice, 'ref', 'secret.wav'), 'nope');
  fs.writeFileSync(path.join(voice, 'models', 'hey_capri.onnx'), 'onnx');

  const lines = [];
  const out = await ensureVoiceSources({
    root,
    destRoot: dest,
    version: '0.1.4',
    onProgress: (p) => lines.push(p.line || p.label),
  });
  assert.equal(out.ok, true);
  assert.equal(out.from, 'bundled');
  for (const rel of VOICE_FILES) {
    assert.ok(fs.existsSync(path.join(dest, rel)), rel);
  }
  assert.ok(fs.existsSync(path.join(dest, 'models', 'hey_capri.onnx')));
  assert.equal(fs.existsSync(path.join(dest, 'ref')), false);
});

test('syncManagedVoiceSources updates stale bundled files but preserves user voice files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-sync-src-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-sync-dst-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });
  const voice = path.join(root, 'voice');
  fs.mkdirSync(path.join(voice, 'models'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'models'), { recursive: true });
  for (const rel of VOICE_FILES) fs.writeFileSync(path.join(voice, rel), `new ${rel}\n`);
  fs.writeFileSync(path.join(voice, 'models', 'hey_capri.onnx'), 'new model');
  fs.writeFileSync(path.join(dest, 'server.py'), 'old server\n');
  fs.writeFileSync(path.join(dest, 'ref.wav'), 'user audio');
  fs.writeFileSync(path.join(dest, 'models', 'hey_capri.onnx'), 'old model');
  const lines = [];
  const out = require('../src/main/voice-install').syncManagedVoiceSources({
    root,
    destRoot: dest,
    version: '0.2.0',
    onSync: (rel) => lines.push(rel),
  });
  assert.equal(out.ok, true);
  assert.equal(fs.readFileSync(path.join(dest, 'server.py'), 'utf8'), 'new server.py\n');
  assert.equal(fs.readFileSync(path.join(dest, 'models', 'hey_capri.onnx'), 'utf8'), 'new model');
  assert.equal(fs.readFileSync(path.join(dest, 'ref.wav'), 'utf8'), 'user audio');
  assert.ok(lines.includes('server.py'));
  assert.ok(lines.includes('models/hey_capri.onnx'));
});

test('findPython311 reports the download page when py -3.11 is missing', () => {
  const miss = findPython311({
    spawnSyncImpl: () => ({ status: 1, stdout: '' }),
  });
  assert.equal(miss.ok, false);
  assert.match(miss.message, /Python 3\.11/);
  assert.equal(miss.url, PYTHON_URL);

  const hit = findPython311({
    spawnSyncImpl: () => ({ status: 0, stdout: 'C:\\Python311\\python.exe\n' }),
  });
  assert.equal(hit.ok, true);
  assert.equal(hit.exe, 'C:\\Python311\\python.exe');
});

test('createVoiceInstall cancel is a no-op until setup.ps1 is running', async (t) => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-local-'));
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));
  const installer = createVoiceInstall({
    root: path.join(os.tmpdir(), 'no-voice-here'),
    version: '0.0.0',
    env: { LOCALAPPDATA: local },
    readVramImpl: () => null,
    spawnSyncImpl: () => ({ status: 0, stdout: 'C:\\Python311\\python.exe\n' }),
    fetchImpl: async () => {
      throw new Error('network blocked in test');
    },
    spawnImpl: () => {
      throw new Error('setup should not start');
    },
  });
  assert.deepEqual(installer.cancel(), { ok: false, message: 'No hay instalación para cancelar.' });

  const res = await installer.start({ omniVoice: false });
  assert.equal(res.ok, false);
  assert.match(res.error || '', /descargar|network/i);
});
