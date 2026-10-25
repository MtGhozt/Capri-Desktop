'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function defaultBin() {
  const name = process.platform === 'win32' ? 'lms.exe' : 'lms';
  return path.join(os.homedir(), '.lmstudio', 'bin', name);
}

function createLms({ loadConfig, onStatus }) {
  let status = 'booting';
  let startedByCapri = false;
  let ready = null;

  function emit(next) {
    status = next;
    onStatus?.(next);
  }

  function cfg() {
    return loadConfig().llm || {};
  }

  function binPath() {
    return cfg().lmsPath || defaultBin();
  }

  function baseUrl() {
    return String(cfg().baseUrl || 'http://localhost:1235/v1').replace(/\/$/, '');
  }

  async function probe() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(`${baseUrl()}/models`, { signal: ctrl.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function run(args, { timeoutMs = 60000, detached = false } = {}) {
    const bin = binPath();
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(bin, args, {
          windowsHide: true,
          stdio: 'ignore',
          detached,
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
        return;
      }
      if (detached) {
        child.unref();
        resolve({ ok: true });
        return;
      }
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* already gone */ }
        resolve({ ok: false, error: 'timeout' });
      }, timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, code });
      });
    });
  }

  async function waitForModels(deadline) {
    while (Date.now() < deadline) {
      if (await probe()) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  function start() {
    ready = (async () => {
      const llm = cfg();
      if (llm.autoStart === false) {
        emit(await probe() ? 'ready' : 'failed');
        return status;
      }
      if (await probe()) {
        emit('ready');
        return 'ready';
      }
      if (!fs.existsSync(binPath())) {
        emit('failed');
        return 'failed';
      }

      emit('booting');
      const timeout = Number(llm.bootTimeoutMs) || 120000;
      const deadline = Date.now() + timeout;
      const server = await run(['server', 'start'], { detached: true });
      if (!server.ok) {
        emit('failed');
        return 'failed';
      }
      startedByCapri = true;

      if (!(await waitForModels(deadline))) {
        emit('failed');
        return 'failed';
      }

      const model = llm.model || 'google/gemma-4-e2b';
      const ctx = String(llm.contextLength || 8192);
      const gpu = String(llm.gpu || 'max');
      const loaded = await run(
        ['load', model, '--context-length', ctx, '--gpu', gpu, '-y'],
        { timeoutMs: Math.max(5000, deadline - Date.now()) },
      );
      if (!loaded.ok) {
        emit('failed');
        return 'failed';
      }
      if (!(await waitForModels(deadline))) {
        emit('failed');
        return 'failed';
      }
      emit('ready');
      return 'ready';
    })();
    return ready;
  }

  function whenReady() {
    return ready || Promise.resolve(status);
  }

  function unload() {
    if (!startedByCapri) return;
    const bin = binPath();
    if (!fs.existsSync(bin)) return;
    try {
      spawnSync(bin, ['unload', '--all'], { windowsHide: true, timeout: 12000, stdio: 'ignore' });
    } catch (err) {
      console.error('[capri] lms unload:', err.message);
    }
  }

  return {
    start,
    whenReady,
    unload,
    status: () => status,
    get startedByCapri() { return startedByCapri; },
  };
}

module.exports = { createLms };
