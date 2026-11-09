'use strict';

// One-button voice install for Ajustes › AUDIO: copy or fetch the public voice/ sources into
// %LOCALAPPDATA%\capri-desktop\voice, then run setup.ps1. Never touches ref/ clone audio.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { REPO, fetchLatest } = require('./updates');
const { readVram } = require('./vram');
const { VC_MESSAGE, missingVcRuntime } = require('./vc-runtime');

const PYTHON_URL = 'https://www.python.org/downloads/release/python-3119/';
const VOICE_FILES = [
  'server.py',
  'tts.py',
  'setup.ps1',
  'requirements.txt',
  'requirements-torch.txt',
  'requirements-omnivoice.txt',
  'heavy.py',
  'greet.py',
  'tts_text.py',
  'vram.py',
];
// Public wake word only when it already ships with the sources (gitignored onnx stays local).
const OPTIONAL_FILES = ['models/hey_capri.onnx'];
const SYNC_MANIFEST = '.capri-voice-sources.json';

function voiceInstallDir(env = process.env) {
  const local = env.LOCALAPPDATA
    || (env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData', 'Local') : '');
  return path.join(local, 'capri-desktop', 'voice');
}

function hasVoiceSources(dir) {
  return Boolean(dir)
    && fs.existsSync(path.join(dir, 'server.py'))
    && fs.existsSync(path.join(dir, 'setup.ps1'));
}

function bundledVoiceDir(root) {
  const dir = path.join(root, 'voice');
  return hasVoiceSources(dir) ? dir : null;
}

function hasNvidiaGpu({ readVramImpl = readVram } = {}) {
  return Boolean(readVramImpl?.());
}

function findPython311({ spawnSyncImpl = spawnSync } = {}) {
  try {
    const res = spawnSyncImpl('py', ['-3.11', '-c', 'import sys; print(sys.executable)'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
    const exe = String(res.stdout || '').trim();
    if (res.status === 0 && exe) return { ok: true, exe };
  } catch { /* py launcher missing */ }
  return {
    ok: false,
    message: 'Falta Python 3.11. Instalálo desde python.org (marcá “Add python.exe to PATH”) y volvé a tocar Instalar voz.',
    url: PYTHON_URL,
  };
}

function isBlockedVoicePath(rel) {
  const norm = String(rel || '').replace(/\\/g, '/').toLowerCase();
  if (!norm || norm.includes('..')) return true;
  if (norm.startsWith('ref/') || norm.includes('/ref/')) return true;
  if (/\.(wav|pt|bin)$/i.test(norm)) return true;
  // transcripts next to clone audio; allowlisted .txt are only the requirements*.txt names
  if (/\.txt$/i.test(norm) && !/^requirements[^/]*\.txt$/i.test(path.posix.basename(norm))) return true;
  return false;
}

function writeVoiceFile(destRoot, rel, data) {
  if (isBlockedVoicePath(rel)) throw new Error(`blocked voice path: ${rel}`);
  const out = path.join(destRoot, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, data);
}

function copyBundledVoice(srcRoot, destRoot, { onProgress } = {}) {
  onProgress?.({ phase: 'download', label: 'Descargando…', line: 'Copiando archivos de voz…' });
  for (const rel of VOICE_FILES) {
    if (isBlockedVoicePath(rel)) continue;
    const src = path.join(srcRoot, rel);
    if (!fs.existsSync(src)) throw new Error(`Falta ${rel} en la carpeta de voz del proyecto.`);
    writeVoiceFile(destRoot, rel, fs.readFileSync(src));
  }
  for (const rel of OPTIONAL_FILES) {
    if (isBlockedVoicePath(rel)) continue;
    const src = path.join(srcRoot, rel);
    if (fs.existsSync(src)) writeVoiceFile(destRoot, rel, fs.readFileSync(src));
  }
  return { ok: true, from: 'bundled' };
}

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function syncManagedVoiceSources({ root, destRoot, version, onSync } = {}) {
  const bundled = bundledVoiceDir(root);
  if (!bundled) return { ok: false, synced: [] };
  const manifestPath = path.join(destRoot, SYNC_MANIFEST);
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* first sync */ }
  const currentVersion = typeof version === 'function' ? version() : version;
  const versionChanged = previous.version !== currentVersion;
  const synced = [];
  for (const rel of [...VOICE_FILES, ...OPTIONAL_FILES]) {
    const src = path.join(bundled, rel);
    if (!fs.existsSync(src)) continue;
    const hash = fileHash(src);
    const dest = path.join(destRoot, rel);
    if (!versionChanged && previous.files?.[rel] === hash && fs.existsSync(dest)) continue;
    writeVoiceFile(destRoot, rel, fs.readFileSync(src));
    synced.push(rel);
    onSync?.(rel);
  }
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: currentVersion,
    files: Object.fromEntries([...VOICE_FILES, ...OPTIONAL_FILES]
      .filter((rel) => fs.existsSync(path.join(bundled, rel)))
      .map((rel) => [rel, fileHash(path.join(bundled, rel))])),
  }, null, 2));
  return { ok: true, synced };
}

async function downloadVoiceFile(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'Capri-Desktop', Accept: 'application/octet-stream' },
  });
  if (!res.ok) {
    const err = new Error(`http ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

async function resolveVoiceTag(version, { fetchImpl = fetch } = {}) {
  const ver = String(version || '').replace(/^v/i, '');
  const preferred = `v${ver}`;
  const probe = `https://raw.githubusercontent.com/${REPO}/${preferred}/voice/setup.ps1`;
  try {
    const res = await fetchImpl(probe, { headers: { 'User-Agent': 'Capri-Desktop' } });
    if (res.ok) return preferred;
  } catch { /* try latest */ }
  const latest = await fetchLatest({ fetchImpl, timeoutMs: 8000 });
  return latest.tag.startsWith('v') ? latest.tag : `v${latest.tag}`;
}

async function downloadVoiceSources({
  destRoot,
  version,
  fetchImpl = fetch,
  onProgress,
} = {}) {
  const tag = await resolveVoiceTag(version, { fetchImpl });
  const base = `https://raw.githubusercontent.com/${REPO}/${tag}/voice`;
  onProgress?.({ phase: 'download', label: 'Descargando…', line: `Descargando voz (${tag})…` });
  for (const rel of VOICE_FILES) {
    if (isBlockedVoicePath(rel)) continue;
    onProgress?.({ phase: 'download', label: 'Descargando…', line: `Descargando… ${rel}` });
    const buf = await downloadVoiceFile(`${base}/${rel}`, fetchImpl);
    writeVoiceFile(destRoot, rel, buf);
  }
  for (const rel of OPTIONAL_FILES) {
    if (isBlockedVoicePath(rel)) continue;
    try {
      const buf = await downloadVoiceFile(`${base}/${rel}`, fetchImpl);
      writeVoiceFile(destRoot, rel, buf);
    } catch {
      // hey_capri.onnx is public locally but usually not on GitHub
    }
  }
  return { ok: true, from: 'github', tag };
}

async function ensureVoiceSources({
  root,
  destRoot,
  version,
  fetchImpl = fetch,
  onProgress,
} = {}) {
  fs.mkdirSync(path.join(destRoot, 'models'), { recursive: true });
  const bundled = bundledVoiceDir(root);
  if (bundled) return copyBundledVoice(bundled, destRoot, { onProgress });
  return downloadVoiceSources({ destRoot, version, fetchImpl, onProgress });
}

// Same .venv python the sidecar uses. Catches a silent pip fail or a stale setup.ps1 that exited 0.
function verifyOmniImports(dir, { spawnSyncImpl = spawnSync } = {}) {
  const venvPy = path.join(dir, '.venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(venvPy)) {
    return { ok: false, message: `No está el Python del sidecar (${venvPy}).` };
  }
  try {
    const res = spawnSyncImpl(venvPy, ['-c', 'import torch, omnivoice'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
    });
    if (res.status === 0) return { ok: true, exe: venvPy };
    const detail = String(res.stderr || res.stdout || '').trim() || `exit ${res.status}`;
    return {
      ok: false,
      message: `Torch/OmniVoice no importan con el Python del sidecar: ${detail.slice(0, 400)}`,
    };
  } catch (err) {
    return { ok: false, message: `No se pudo verificar Torch: ${err.message}` };
  }
}

function runSetupPs1({
  dir,
  omniVoice = false,
  spawnImpl = spawn,
  onLine,
} = {}) {
  const script = path.join(dir, 'setup.ps1');
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script,
  ];
  if (omniVoice) args.push('-OmniVoice');

  let child;
  let settled = false;
  const promise = new Promise((resolve) => {
    child = spawnImpl('powershell.exe', args, {
      cwd: dir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const feed = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) onLine?.(line);
      }
    };
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, code: -1, message: err.message, cancelled: false });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      const cancelled = signal === 'SIGTERM' || code === null;
      resolve({
        ok: code === 0,
        code,
        cancelled,
        message: code === 0 ? 'Listo' : (cancelled ? 'Cancelado.' : `setup.ps1 salió con código ${code}`),
      });
    });
  });

  return {
    promise,
    pid: () => child?.pid || null,
    kill: () => {
      const pid = child?.pid;
      if (!pid) return;
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        return;
      }
      try { child.kill(); } catch { /* gone */ }
    },
  };
}

function createVoiceInstall({
  root,
  version,
  fetchImpl = fetch,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
  readVramImpl = readVram,
  env = process.env,
  missingVcImpl = missingVcRuntime,
  verifyOmniImpl = verifyOmniImports,
  onProgress,
  onLine,
} = {}) {
  let setup = null;
  let busy = false;
  let state = idleState();

  function idleState() {
    return {
      busy: false,
      phase: 'idle',
      label: '',
      lines: [],
      error: '',
      needPython: false,
      pythonUrl: PYTHON_URL,
      needVc: missingVcImpl(),
      hasNvidia: hasNvidiaGpu({ readVramImpl }),
      dir: voiceInstallDir(env),
      ok: false,
    };
  }

  function emit(patch) {
    const nextBusy = patch.busy != null ? Boolean(patch.busy) : busy;
    state = { ...state, ...patch, busy: nextBusy, dir: voiceInstallDir(env) };
    onProgress?.(state);
    return state;
  }

  function pushLine(line) {
    const text = String(line);
    const lines = [...state.lines, text].slice(-40);
    onLine?.(text);
    emit({ lines });
  }

  async function start({ omniVoice } = {}) {
    if (busy) return { ok: false, message: 'Ya hay una instalación en curso.' };
    busy = true;
    const dest = voiceInstallDir(env);
    const nvidia = hasNvidiaGpu({ readVramImpl });
    const useOmni = omniVoice == null ? nvidia : Boolean(omniVoice);
    emit({
      busy: true,
      phase: 'download',
      label: 'Descargando…',
      lines: [],
      error: '',
      needPython: false,
      ok: false,
      hasNvidia: nvidia,
      omniVoice: useOmni,
    });
    if (missingVcImpl()) pushLine(VC_MESSAGE);

    const py = findPython311({ spawnSyncImpl });
    if (!py.ok) {
      busy = false;
      return emit({
        busy: false,
        phase: 'error',
        label: 'Error',
        needPython: true,
        error: py.message,
        lines: [py.message],
      });
    }

    try {
      await ensureVoiceSources({
        root,
        destRoot: dest,
        version: typeof version === 'function' ? version() : version,
        fetchImpl,
        onProgress: (p) => {
          emit({ phase: p.phase || 'download', label: p.label || 'Descargando…' });
          if (p.line) pushLine(p.line);
        },
      });
    } catch (err) {
      busy = false;
      const message = `No se pudo descargar la voz: ${err.message || err}`;
      return emit({
        busy: false,
        phase: 'error',
        label: 'Error',
        error: message,
        lines: [...state.lines, message].slice(-40),
      });
    }

    emit({ phase: 'install', label: 'Instalando…' });
    pushLine(useOmni ? 'Corriendo setup.ps1 -OmniVoice…' : 'Corriendo setup.ps1…');
    setup = runSetupPs1({
      dir: dest,
      omniVoice: useOmni,
      spawnImpl,
      onLine: (line) => {
        emit({ phase: 'install', label: 'Instalando…' });
        pushLine(line);
      },
    });
    const result = await setup.promise;
    setup = null;
    busy = false;
    if (result.cancelled) {
      return emit({
        busy: false,
        phase: 'error',
        label: 'Error',
        error: 'Cancelado.',
        lines: [...state.lines, 'Cancelado.'].slice(-40),
        ok: false,
      });
    }
    if (!result.ok) {
      const message = result.message || 'Falló setup.ps1';
      return emit({
        busy: false,
        phase: 'error',
        label: 'Error',
        error: message,
        lines: [...state.lines, message].slice(-40),
        ok: false,
      });
    }
    if (useOmni) {
      pushLine('Verificando torch/omnivoice con el Python del sidecar…');
      const check = verifyOmniImpl(dest, { spawnSyncImpl });
      if (!check.ok) {
        pushLine(check.message);
        return emit({
          busy: false,
          phase: 'error',
          label: 'Error',
          error: check.message,
          lines: [...state.lines].slice(-40),
          ok: false,
          dir: dest,
          omniVoice: useOmni,
        });
      }
      pushLine(`OK: torch/omnivoice importan (${check.exe})`);
    }
    pushLine('Listo.');
    const needVc = missingVcImpl();
    if (needVc) pushLine(VC_MESSAGE);
    return emit({
      busy: false,
      phase: 'done',
      label: 'Listo',
      error: '',
      ok: true,
      needVc,
      dir: dest,
      omniVoice: useOmni,
    });
  }

  function cancel() {
    if (!setup) return { ok: false, message: 'No hay instalación para cancelar.' };
    setup.kill();
    return { ok: true, message: 'Cancelando…' };
  }

  return {
    start,
    cancel,
    status: () => ({ ...state, busy, needVc: missingVcImpl(), hasNvidia: hasNvidiaGpu({ readVramImpl }) }),
    dir: () => voiceInstallDir(env),
    syncManaged: ({ destRoot, onSync } = {}) => syncManagedVoiceSources({
      root,
      destRoot: destRoot || voiceInstallDir(env),
      version,
      onSync,
    }),
  };
}

module.exports = {
  PYTHON_URL,
  VOICE_FILES,
  OPTIONAL_FILES,
  voiceInstallDir,
  hasVoiceSources,
  bundledVoiceDir,
  hasNvidiaGpu,
  findPython311,
  isBlockedVoicePath,
  ensureVoiceSources,
  syncManagedVoiceSources,
  verifyOmniImports,
  runSetupPs1,
  createVoiceInstall,
};
