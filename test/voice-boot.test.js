'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const VOICE = path.join(ROOT, 'voice');
const PY = path.join(VOICE, '.venv', 'Scripts', 'python.exe');
const PORT = 47891;
const TOKEN = 'boot-test-token';

function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

function sendConfig(port, token) {
  const script = [
    'import asyncio, json, sys, websockets',
    'async def main():',
    '    uri, token = sys.argv[1], sys.argv[2]',
    '    async with websockets.connect(uri) as ws:',
    '        await ws.send(json.dumps({"type": "hello", "token": token}))',
    '        await ws.recv()',
    '        await ws.send(json.dumps({',
    '            "type": "config", "enabled": True, "wakeWord": True,',
    '            "tts": "kokoro", "replyMode": "voice", "muted": False, "volume": 0.7,',
    '        }))',
    '        await asyncio.sleep(0.5)',
    'asyncio.run(main())',
  ].join('\n');
  const result = spawnSync(PY, ['-c', script, `ws://127.0.0.1:${port}`, token], {
    encoding: 'utf8',
    cwd: VOICE,
    timeout: 20000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `ws config exit ${result.status}`);
  }
}

test('sidecar boot log has wake word ready (or openWakeWord off), whisper ready and tts engine', { timeout: 120000 }, async () => {
  assert.ok(fs.existsSync(PY), 'voice/.venv python is required for the boot test');
  const child = spawn(PY, ['-u', 'server.py'], {
    cwd: VOICE,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONUTF8: '1',
      CAPRI_VOICE_TOKEN: TOKEN,
      CAPRI_VOICE_PORT: String(PORT),
      HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
    },
  });
  let buf = '';
  const onData = (chunk) => { buf += String(chunk); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  try {
    const deadline = Date.now() + 25000;
    while (!buf.includes('CAPRI_VOICE_READY') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.match(buf, /CAPRI_VOICE_READY/, `sidecar did not become ready:\n${buf.slice(-2000)}`);
    sendConfig(PORT, TOKEN);
    const until = Date.now() + 90000;
    let log = '';
    while (Date.now() < until) {
      log = buf;
      if (/(wake word .+ ready|openWakeWord off)/i.test(log) && /whisper ready/i.test(log) && /tts engine=/.test(log)) {
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    log = buf;
    assert.match(log, /(wake word .+ ready|openWakeWord off)/i, log.slice(-3000));
    assert.match(log, /whisper ready/i, log.slice(-3000));
    assert.match(log, /tts engine=/, log.slice(-3000));
  } finally {
    killTree(child);
  }
});
