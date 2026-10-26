'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { sidecarConfig } = require('./voice-config');
const { logLines, voiceLogPath } = require('./log');

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
  let sleeping = false;
  const logFile = voiceLogPath();

  function emit(payload) {
    if (payload?.type === 'devices' && Array.isArray(payload.devices)) {
      devices = payload.devices;
    }
    onEvent?.(payload);
  }

  function skip(message) {
    logLines(logFile, `[capri] ${message}`);
    console.log(`[capri] ${message}`);
    emit({ type: 'notice', message });
  }

  function speakCfg() {
    return sidecarConfig(loadConfig(), { sleeping });
  }

  function send(payload) {
    const kind = payload?.type;
    if (kind === 'speak' || kind === 'speak_start' || kind === 'speak_flush' || kind === 'stop_speak') {
      const extra = `${payload.id != null ? ` id=${payload.id}` : ''}${kind === 'speak' ? ` ${String(payload.text || '').length}c` : ''}`;
      if (!ws || ws.readyState !== 1) {
        logLines(logFile, `[capri] ws skip ${kind}${extra}`);
        return;
      }
      logLines(logFile, `[capri] ws ${kind}${extra}`);
    }
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
      if (msg.type === 'ready') send({ type: 'config', ...speakCfg() });
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

  // `force` restarts the sidecar even when the mic is off in config: game mode unplugged it
  // entirely, and her voice (TTS) still has to come back when the game is over.
  function start({ force = false } = {}) {
    stopped = false;
    const cfg = loadConfig();
    if (!force && cfg.voice && cfg.voice.enabled === false) {
      logLines(logFile, '[capri] voice sidecar off (voice.enabled=false)');
      return;
    }
    const dir = resolveVoiceDir(root, cfg);
    if (!dir) {
      skip('Voice sidecar is off: set voice.dir in %APPDATA%\\capri-desktop\\config.json to your voice folder (the one with setup.ps1). Chat still works.');
      return;
    }
    const py = resolvePython(dir);
    const script = path.join(dir, 'server.py');
    if (!py || !fs.existsSync(script)) {
      skip(`Voice sidecar is off: no venv in ${dir}. Run setup.ps1 there. Chat still works.`);
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
          PYTORCH_CUDA_ALLOC_CONF: process.env.PYTORCH_CUDA_ALLOC_CONF || 'expandable_segments:True',
          HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
          // download and weight-loading bars would fill the log with a line per percent
          HF_HUB_DISABLE_PROGRESS_BARS: '1',
        },
      });
    } catch (err) {
      skip(`Voice sidecar failed to start: ${err.message}`);
      child = null;
      return;
    }
    logLines(logFile, `[capri] voice sidecar spawn dir=${dir}`);
    child.stdout.on('data', (buf) => {
      const line = String(buf);
      process.stdout.write(line);
      logLines(logFile, line);
      if (line.includes('CAPRI_VOICE_READY')) connect();
    });
    child.stderr.on('data', (buf) => {
      const line = String(buf);
      process.stderr.write(line);
      logLines(logFile, line);
    });
    child.on('exit', (code) => {
      logLines(logFile, `[capri] voice sidecar exit ${code}`);
      console.log('[capri] voice sidecar exit', code);
      child = null;
      disconnect();
    });
    child.on('error', (err) => {
      skip(`Voice sidecar error: ${err.message}`);
      child = null;
    });
    setTimeout(connect, 800);
  }

  function stop() {
    stopped = true;
    disconnect();
    killChild();
  }

  function setSleeping(on) {
    const next = Boolean(on);
    if (next === sleeping) return;
    sleeping = next;
    logLines(logFile, `[capri] voice sleeping=${sleeping}`);
    send({ type: 'config', ...speakCfg() });
  }

  function applyConfig() {
    const cfg = loadConfig();
    if (cfg.voice && cfg.voice.enabled === false) {
      send({ type: 'config', ...speakCfg() });
      return;
    }
    if (!child) start();
    else send({ type: 'config', ...speakCfg() });
  }

  return {
    start,
    stop,
    applyConfig,
    setSleeping,
    pttStart: () => send({ type: 'ptt_start' }),
    pttStop: () => send({ type: 'ptt_stop' }),
    push: send,
    speak: (text, id) => send({ type: 'speak', text, id }),
    speakFlush: (id) => send({ type: 'speak_flush', id }),
    stopSpeak: (id) => send({ type: 'stop_speak', id }),
    speakStart: (id) => send({ type: 'speak_start', id }),
    listDevices: () => send({ type: 'list_devices' }),
    devices: () => devices,
    connected: () => Boolean(ws && ws.readyState === 1),
    running: () => Boolean(child),
    resolveDir: () => resolveVoiceDir(root, loadConfig()),
  };
}

module.exports = { createVoice, resolveVoiceDir };
