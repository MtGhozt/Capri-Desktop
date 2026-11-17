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

// nvidia-smi is spawnSync; menuState/status call this often — once per session is enough.
let nvidiaGpuCached;
function hasNvidiaGpu({ readVramImpl = readVram } = {}) {
  // Tests inject a mock; never pin the session cache to that result.
  if (readVramImpl !== readVram) return Boolean(readVramImpl?.());
  if (nvidiaGpuCached !== undefined) return nvidiaGpuCached;
  nvidiaGpuCached = Boolean(readVramImpl?.());
  return nvidiaGpuCached;
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

const STALL_MS = 60_000;
const STALL_MESSAGE = 'La descarga se colgó (sin datos 60 s). Tocá Instalar voz para reintentar.';

// Stream the body; abort if no bytes arrive for stallMs. onBytes(received, total) for the progress bar.
async function downloadVoiceFile(url, fetchImpl, {
  onBytes,
  stallMs = STALL_MS,
  now = () => Date.now(),
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'Capri-Desktop', Accept: 'application/octet-stream' },
  });
  if (!res.ok) {
    const err = new Error(`http ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const total = Number(res.headers?.get?.('content-length')) || 0;
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    onBytes?.(buf.length, total || buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let lastByteAt = now();
  let finished = false;

  const watch = async () => {
    while (!finished) {
      await delay(250);
      if (finished) return;
      if (now() - lastByteAt >= stallMs) {
        finished = true;
        const err = new Error(STALL_MESSAGE);
        err.code = 'STALL';
        try { await reader.cancel(); } catch { /* already closed */ }
        throw err;
      }
    }
  };

  const pump = async () => {
    try {
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          break;
        }
        if (value?.byteLength) {
          chunks.push(Buffer.from(value));
          received += value.byteLength;
          lastByteAt = now();
          onBytes?.(received, total);
        }
      }
      return Buffer.concat(chunks);
    } catch (err) {
      finished = true;
      if (err?.code === 'STALL') throw err;
      if (String(err?.message || '').includes('colgó')) throw err;
      throw err;
    }
  };

  return Promise.race([pump(), watch()]);
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
  downloadFile = downloadVoiceFile,
} = {}) {
  const tag = await resolveVoiceTag(version, { fetchImpl });
  const base = `https://raw.githubusercontent.com/${REPO}/${tag}/voice`;
  const files = VOICE_FILES.filter((rel) => !isBlockedVoicePath(rel));
  onProgress?.({
    phase: 'download', label: 'Descargando…', progress: 0,
    line: `Descargando voz (${tag})…`,
  });
  for (let i = 0; i < files.length; i += 1) {
    const rel = files[i];
    const name = path.posix.basename(rel);
    const buf = await downloadFile(`${base}/${rel}`, fetchImpl, {
      onBytes: (received, total) => {
        const filePct = total > 0
          ? Math.min(99, Math.round((received / total) * 100))
          : 0;
        const frac = total > 0 ? received / total : 0;
        const overall = Math.min(99, Math.round(((i + frac) / files.length) * 100));
        onProgress?.({
          phase: 'download',
          label: `${name} ${filePct}%`,
          progress: overall,
          line: `Descargando… ${rel} (${i + 1}/${files.length})`,
        });
      },
    });
    writeVoiceFile(destRoot, rel, buf);
    const donePct = Math.round(((i + 1) / files.length) * 100);
    onProgress?.({
      phase: 'download',
      label: `${name} 100%`,
      progress: donePct,
      line: `Listo ${rel} (${i + 1}/${files.length})`,
    });
  }
  for (const rel of OPTIONAL_FILES) {
    if (isBlockedVoicePath(rel)) continue;
    try {
      const buf = await downloadFile(`${base}/${rel}`, fetchImpl);
      writeVoiceFile(destRoot, rel, buf);
    } catch (err) {
      if (err?.code === 'STALL') throw err;
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

function clearOmniBlock(dir) {
  if (!dir) return;
  try {
    fs.rmSync(path.join(dir, 'models', '.omni_blocked'), { force: true });
  } catch { /* ignore */ }
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
      // Always reach voice.log (onLine), not only the in-memory "Ver detalles" buffer.
      pushLine(py.message);
      busy = false;
      return emit({
        busy: false,
        phase: 'error',
        label: 'Error',
        needPython: true,
        error: py.message,
        lines: [...state.lines].slice(-40),
      });
    }

    try {
      await ensureVoiceSources({
        root,
        destRoot: dest,
        version: typeof version === 'function' ? version() : version,
        fetchImpl,
        onProgress: (p) => {
          emit({
            phase: p.phase || 'download',
            label: p.label || 'Descargando…',
            ...(p.progress != null ? { progress: p.progress } : {}),
          });
          if (p.line) pushLine(p.line);
        },
      });
    } catch (err) {
      busy = false;
      const stalled = err?.code === 'STALL' || /colgó/i.test(String(err?.message || ''));
      const message = stalled
        ? String(err.message || STALL_MESSAGE)
        : `No se pudo descargar la voz: ${err.message || err}`;
      pushLine(message);
      return emit({
        busy: false,
        phase: 'error',
        label: 'Error',
        error: message,
        progress: 0,
        lines: [...state.lines].slice(-40),
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
      pushLine(message);
      return emit({
        busy: false,
        phase: 'error',
        label: 'Error',
        error: message,
        lines: [...state.lines].slice(-40),
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
      clearOmniBlock(dest);
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
  STALL_MS,
  STALL_MESSAGE,
  voiceInstallDir,
  hasVoiceSources,
  bundledVoiceDir,
  hasNvidiaGpu,
  findPython311,
  isBlockedVoicePath,
  downloadVoiceFile,
  downloadVoiceSources,
  ensureVoiceSources,
  syncManagedVoiceSources,
  verifyOmniImports,
  clearOmniBlock,
  runSetupPs1,
  createVoiceInstall,
};
