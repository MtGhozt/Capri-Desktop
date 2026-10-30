'use strict';

// Fresh-profile Electron launch for Capri smoke tests (Playwright _electron).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');

function freePort() {
  // Prefer a high ephemeral-ish port so a running Capri (47823) is left alone.
  return 47000 + Math.floor(Math.random() * 2000);
}

function seedProfile(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const noVoice = path.join(dir, 'no-voice');
  fs.mkdirSync(noVoice, { recursive: true });
  const cfg = {
    fx: { intro: false, glitch: false, apps: false, scanlines: false },
    guide: { welcome: false, setupHint: true },
    greeting: { enabled: false, unlock: false },
    comments: { enabled: false },
    wander: false,
    possess: false,
    llm: {
      provider: 'local',
      autoStart: false,
      // Unreachable on purpose: friendly offline error, never hang waiting for LM Studio.
      baseUrl: 'http://127.0.0.1:1/v1',
    },
    voice: {
      enabled: false,
      replyMode: 'blips',
      dir: noVoice,
    },
    idle: { dormantAfterMs: 0 },
    behavior: { caresses: true },
    position: { locked: true, x: 480, y: 420, edge: false },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
  return dir;
}

async function launchCapri({ settleMs = 2500 } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-e2e-'));
  seedProfile(userData);
  const port = freePort();
  const errors = [];
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, `--user-data-dir=${userData}`],
    cwd: ROOT,
    env: {
      ...process.env,
      CAPRI_E2E: '1',
      CAPRI_PORT: String(port),
      // Don't let a developer voice venv on this machine wake up during smoke.
      CAPRI_DEVTOOLS: '',
    },
    timeout: 60_000,
  });

  electronApp.on('window', (win) => {
    win.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    win.on('pageerror', (err) => errors.push(String(err)));
  });

  const win = await electronApp.firstWindow({ timeout: 45_000 });
  win.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  win.on('pageerror', (err) => errors.push(String(err)));

  await win.waitForFunction(() => Boolean(window.__capriE2E), null, { timeout: 30_000 });
  if (settleMs) await win.waitForTimeout(settleMs);

  return {
    electronApp,
    win,
    userData,
    port,
    errors,
    async e2e(fn) {
      return win.evaluate(fn);
    },
    async close() {
      try {
        await electronApp.evaluate(() => {
          try { global.__capriForceQuit?.(); } catch { /* */ }
        });
      } catch { /* already exiting */ }
      try { await electronApp.close(); } catch { /* gone */ }
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* locked briefly */ }
    },
  };
}

function assertNoFatal(errors) {
  const fatal = errors.filter((line) => {
    const s = String(line);
    // Benign: missing voice / unreachable LLM probes / font warnings.
    if (/voice sidecar is off/i.test(s)) return false;
    if (/unknown act/i.test(s)) return false;
    if (/e2e-sync|e2e-reject/i.test(s)) return false;
    if (/Failed to load resource/i.test(s)) return false;
    return /uncaught|TypeError|ReferenceError|Cannot read propert/i.test(s);
  });
  return fatal;
}

module.exports = { launchCapri, seedProfile, assertNoFatal, ROOT };
