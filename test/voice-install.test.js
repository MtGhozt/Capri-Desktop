'use strict';

// Ajustes › AUDIO › Instalar voz: LOCALAPPDATA target, allowlisted sources only, no ref/wav.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { VC_MESSAGE } = require('../src/main/vc-runtime');
const {
  PYTHON_URL,
  VOICE_FILES,
  voiceInstallDir,
  hasVoiceSources,
  bundledVoiceDir,
  findPython311,
  isBlockedVoicePath,
  ensureVoiceSources,
  syncManagedVoiceSources,
  verifyOmniImports,
  clearOmniBlock,
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
  const second = syncManagedVoiceSources({ root, destRoot: dest, version: '0.2.0' });
  assert.deepEqual(second.synced, []);
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

// A setup that fails must never say "Listo": the RX 6550M case had pip fail silently.
function fakeSpawn({ code = 0, lines = [] } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 1;
    setImmediate(() => {
      for (const line of lines) child.stdout.emit('data', `${line}\n`);
      child.emit('close', code);
    });
    return child;
  };
}

async function runInstall(t, { code, lines, verifyOmniImpl, beforeStart }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-setup-src-'));
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-setup-local-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(local, { recursive: true, force: true });
  });
  const voice = path.join(root, 'voice');
  fs.mkdirSync(path.join(voice, 'models'), { recursive: true });
  for (const rel of VOICE_FILES) fs.writeFileSync(path.join(voice, rel), `# ${rel}\n`);
  const destDir = path.join(local, 'capri-desktop', 'voice');
  beforeStart?.(destDir);
  const out = [];
  const installer = createVoiceInstall({
    root,
    version: '0.2.8',
    env: { LOCALAPPDATA: local },
    readVramImpl: () => null,
    missingVcImpl: () => false,
    spawnSyncImpl: () => ({ status: 0, stdout: 'C:\\Python311\\python.exe\n' }),
    spawnImpl: fakeSpawn({ code, lines }),
    verifyOmniImpl: verifyOmniImpl || (() => ({ ok: true, exe: 'C:\\fake\\.venv\\Scripts\\python.exe' })),
    onLine: (line) => out.push(line),
  });
  return { res: await installer.start({ omniVoice: true }), lines: out, destDir };
}

test('setup output reaches onLine (and voice.log) line by line', async (t) => {
  const { res, lines } = await runInstall(t, {
    code: 0,
    lines: ['Using C:\\Python311\\python.exe', 'omnivoice imported'],
  });
  assert.equal(res.ok, true);
  assert.ok(lines.includes('Using C:\\Python311\\python.exe'));
  assert.ok(lines.includes('omnivoice imported'));

  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /onLine: \(line\) => logEvent\(voiceLogPath\(\), `\[capri\] voice install: \$\{line\}`\)/);
});

test('a setup step that exits non-zero is an error, never "Listo"', async (t) => {
  const { res } = await runInstall(t, {
    code: 1,
    lines: ["ERROR: Could not find a version that satisfies the requirement torch"],
  });
  assert.equal(res.ok, false);
  assert.equal(res.phase, 'error');
  assert.equal(res.label, 'Error');
  assert.match(res.error || '', /código 1/);
  assert.ok(!res.lines.includes('Listo.'));
});

test('setup.ps1 checks every pip exit and imports torch/omnivoice with the sidecar python', () => {
  const ps = fs.readFileSync(path.join(__dirname, '..', 'voice', 'setup.ps1'), 'utf8');
  assert.match(ps, /function Invoke-Pip/);
  assert.match(ps, /if \(\$LASTEXITCODE -ne 0\) \{ throw/);
  assert.match(ps, /& \$venvPy -c "import torch, omnivoice"/);
});

test('post-install torch import failure is an error, never "Listo"', async (t) => {
  const { res, lines } = await runInstall(t, {
    code: 0,
    lines: ['setup finished without throwing'],
    verifyOmniImpl: () => ({
      ok: false,
      message: "Torch/OmniVoice no importan con el Python del sidecar: No module named 'torch'",
    }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.phase, 'error');
  assert.equal(res.label, 'Error');
  assert.match(res.error || '', /torch/i);
  assert.ok(!lines.includes('Listo.'));
  assert.ok(lines.some((l) => /Verificando torch/i.test(l)));
});

test('verifyOmniImports uses the voice .venv python', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-omni-check-'));
  const venvPy = path.join(dir, '.venv', 'Scripts', 'python.exe');
  fs.mkdirSync(path.dirname(venvPy), { recursive: true });
  fs.writeFileSync(venvPy, '');
  let saw;
  const res = verifyOmniImports(dir, {
    spawnSyncImpl: (exe, args) => {
      saw = { exe, args };
      return { status: 1, stderr: "No module named 'torch'\n", stdout: '' };
    },
  });
  assert.equal(saw.exe, venvPy);
  assert.deepEqual(saw.args, ['-c', 'import torch, omnivoice']);
  assert.equal(res.ok, false);
  assert.match(res.message, /torch/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('installer warns about the missing VC++ runtime before and after installing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-vc-install-src-'));
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-vc-install-local-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(local, { recursive: true, force: true });
  });
  const voice = path.join(root, 'voice');
  fs.mkdirSync(path.join(voice, 'models'), { recursive: true });
  for (const rel of VOICE_FILES) fs.writeFileSync(path.join(voice, rel), `# ${rel}\n`);

  const installer = createVoiceInstall({
    root,
    version: '0.2.2',
    env: { LOCALAPPDATA: local },
    readVramImpl: () => null,
    missingVcImpl: () => true,
    spawnSyncImpl: () => ({ status: 0, stdout: 'C:\\Python311\\python.exe\n' }),
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 1;
      setImmediate(() => child.emit('close', 0));
      return child;
    },
  });

  const res = await installer.start({ omniVoice: false });
  assert.equal(res.ok, true);
  assert.equal(res.needVc, true);
  assert.ok(res.lines.includes(VC_MESSAGE), 'the hint is in the install log');
});

test('block file present, setup succeeds with torch import ok → file is gone; failed setup leaves it', async (t) => {
  const blockRel = path.join('models', '.omni_blocked');

  // Success case: setup succeeds + torch imports ok → block file is removed
  const ok = await runInstall(t, {
    code: 0,
    lines: ['setup ok'],
    verifyOmniImpl: () => ({ ok: true, exe: 'C:\\fake\\.venv\\Scripts\\python.exe' }),
    beforeStart: (dest) => {
      fs.mkdirSync(path.join(dest, 'models'), { recursive: true });
      fs.writeFileSync(path.join(dest, blockRel), 'blocked: missing torch');
    },
  });
  assert.equal(ok.res.ok, true);
  assert.equal(fs.existsSync(path.join(ok.destDir, blockRel)), false);

  // Failed setup case: setup.ps1 exits non-zero → block file is untouched
  const failSetup = await runInstall(t, {
    code: 1,
    lines: ['pip failed'],
    beforeStart: (dest) => {
      fs.mkdirSync(path.join(dest, 'models'), { recursive: true });
      fs.writeFileSync(path.join(dest, blockRel), 'blocked: missing torch');
    },
  });
  assert.equal(failSetup.res.ok, false);
  assert.equal(fs.existsSync(path.join(failSetup.destDir, blockRel)), true);

  // Failed setup case: torch verification fails → block file is untouched
  const failImport = await runInstall(t, {
    code: 0,
    lines: ['setup ok'],
    verifyOmniImpl: () => ({ ok: false, message: 'Torch/OmniVoice no importan' }),
    beforeStart: (dest) => {
      fs.mkdirSync(path.join(dest, 'models'), { recursive: true });
      fs.writeFileSync(path.join(dest, blockRel), 'blocked: missing torch');
    },
  });
  assert.equal(failImport.res.ok, false);
  assert.equal(fs.existsSync(path.join(failImport.destDir, blockRel)), true);
});
