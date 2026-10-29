#!/usr/bin/env node
'use strict';

// Artist handoff reel: launches Capri (if needed), plays CapriArtKit, optional stills.
//   pnpm demo:art
//   pnpm demo:art -- --shots

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.CAPRI_PORT) || 47823;
const KIT = path.join(process.env.USERPROFILE || require('node:os').homedir(), 'Desktop', 'capri-art-kit');
const SHOTS = path.join(KIT, 'shots');
const shots = process.argv.includes('--shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function post(evt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(evt);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/event', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function waitHealth(ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await health()) return true;
    await sleep(500);
  }
  return false;
}

function copyHandoff() {
  fs.mkdirSync(KIT, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const src = path.join(ROOT, 'docs', 'ART-HANDOFF.md');
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(KIT, 'ART-HANDOFF.md'));
  }
}

(async () => {
  copyHandoff();
  let child = null;
  if (!(await health())) {
    console.log('[demo:art] starting Capri…');
    child = spawn(
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      ['exec', 'electron', '.', '--dev'],
      { cwd: ROOT, stdio: 'inherit', env: { ...process.env }, shell: process.platform === 'win32' },
    );
    if (!(await waitHealth())) {
      console.error('[demo:art] Capri did not come up on 127.0.0.1:' + PORT);
      process.exit(1);
    }
  } else {
    console.log('[demo:art] Capri already running');
  }

  console.log(`[demo:art] starting reel${shots ? ' + shots → ' + SHOTS : ''}…`);
  await sleep(1500);
  try {
    await post({ hook_event_name: 'CapriArtKit', demo: true, shots });
  } catch (err) {
    console.error('[demo:art] could not post CapriArtKit:', err.message);
    process.exit(1);
  }

  // Reel quits Capri itself; if we spawned it, wait a bit for the process to end.
  if (child) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 15 * 60 * 1000);
      child.on('exit', () => { clearTimeout(t); resolve(); });
    });
  } else {
    // already-running instance: wait until health drops or a long bound
    const t0 = Date.now();
    while (Date.now() - t0 < 15 * 60 * 1000) {
      await sleep(2000);
      if (!(await health())) break;
    }
  }
  copyHandoff();
  console.log(`[demo:art] done. Kit folder: ${KIT}`);
})();
