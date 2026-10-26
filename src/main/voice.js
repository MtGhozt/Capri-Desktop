'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const PORT = 47824;

function pythonExe(dir) {
  return path.join(dir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', 'python.exe');
}

function unixPython(dir) {
  return path.join(dir, '.venv', 'bin', 'python');
}

function resolvePython(dir) {
  const win = pythonExe(dir);
  if (fs.existsSync(win)) return win;
  const nix = unixPython(dir);
  if (fs.existsSync(nix)) return nix;
  return null;
}

function resolveVoiceDir(root, cfg) {
  const raw = cfg?.voice?.dir;
  if (raw != null && String(raw).trim()) return path.resolve(String(raw).trim());
  if (!app.isPackaged) return path.join(root, 'voice');
  return null;
}

function createVoice({ root, loadConfig, onEvent }) {
  let child = null;
  let ws = null;
  let token = null;
  let devices = [];
  let connecting = false;
  let stopped = false;
  let retries = 0;

  function emit(payload) {
    if (payload?.type === 'devices' && Array.isArray(payload.devices)) {
      devices = payload.devices;
    }
    onEvent?.(payload);
  }

  function voiceCfg() {
    return loadConfig().voice || {};
  }

  function send(payload) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(payload)); } catch { /* sidecar gone */ }
  }

  function killChild() {
    if (!child) return;
    const proc = child;
    const pid = proc.pid;
    child = null;
    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      return;
    }
    try { proc.kill(); } catch { /* already gone */ }
  }

  function disconnect() {
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
      ws = null;
    }
  }

  function connect() {
    if (stopped || connecting || (ws && ws.readyState === 1)) return;
    connecting = true;
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws = sock;
    sock.addEventListener('open', () => {
      connecting = false;
      retries = 0;
      sock.send(JSON.stringify({ type: 'hello', token }));
    });
    sock.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data || '')); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      emit(msg);
      if (msg.type === 'ready') send({ type: 'config', ...voiceCfg() });
    });
    sock.addEventListener('close', () => {
      connecting = false;
      if (ws === sock) ws = null;
      if (!stopped && child && retries < 40) {
        retries += 1;
        setTimeout(connect, 500);
      }
    });
    sock.addEventListener('error', () => {
      connecting = false;
    });
  }

  function start() {
    stopped = false;
    const cfg = loadConfig();
    if (cfg.voice && cfg.voice.enabled === false) {
      console.log('[capri] voice sidecar off (voice.enabled=false)');
      return;
    }
    const dir = resolveVoiceDir(root, cfg);
    if (!dir) {
      console.log('[capri] voice sidecar skipped: set voice.dir in %APPDATA%\\capri-desktop\\config.json');
      return;
    }
    const py = resolvePython(dir);
    const script = path.join(dir, 'server.py');
    if (!py || !fs.existsSync(script)) {
      console.log('[capri] voice sidecar skipped: run voice/setup.ps1 (missing venv or server.py)');
      return;
    }
    token = crypto.randomBytes(24).toString('hex');
    retries = 0;
    try {
      child = spawn(py, ['-u', script], {
        cwd: dir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONUTF8: '1',
          CAPRI_VOICE_TOKEN: token,
          CAPRI_VOICE_PORT: String(PORT),
          CAPRI_DEV: process.argv.includes('--dev') ? '1' : '',
        },
      });
    } catch (err) {
      console.error('[capri] voice sidecar spawn failed:', err.message);
      child = null;
      return;
    }
    child.stdout.on('data', (buf) => {
      const line = String(buf);
      process.stdout.write(line);
      if (line.includes('CAPRI_VOICE_READY')) connect();
    });
    child.stderr.on('data', (buf) => process.stderr.write(String(buf)));
    child.on('exit', (code) => {
      console.log('[capri] voice sidecar exit', code);
      child = null;
      disconnect();
    });
    child.on('error', (err) => {
      console.error('[capri] voice sidecar error:', err.message);
      child = null;
    });
    setTimeout(connect, 800);
  }

  function stop() {
    stopped = true;
    disconnect();
    killChild();
  }

  function applyConfig() {
    const cfg = loadConfig();
    if (cfg.voice && cfg.voice.enabled === false) {
      send({ type: 'config', ...cfg.voice });
      return;
    }
    if (!child) start();
    else send({ type: 'config', ...voiceCfg() });
  }

  return {
    start,
    stop,
    applyConfig,
    pttStart: () => send({ type: 'ptt_start' }),
    pttStop: () => send({ type: 'ptt_stop' }),
    listDevices: () => send({ type: 'list_devices' }),
    devices: () => devices,
    resolveDir: () => resolveVoiceDir(root, loadConfig()),
  };
}

module.exports = { createVoice, resolveVoiceDir };
