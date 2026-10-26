'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function py(code) {
  const voice = path.join(__dirname, '..', 'voice');
  const venv = path.join(voice, '.venv', 'Scripts', 'python.exe');
  const bin = fs.existsSync(venv) ? venv : 'py';
  const args = bin === 'py' ? ['-3.11', '-c', code] : ['-c', code];
  const result = spawnSync(bin, args, { encoding: 'utf8', cwd: voice, timeout: 120000 });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `exit ${result.status}`);
  }
  return String(result.stdout || '').trim();
}

test('preload_torch then parallel imports still see torch.Tensor', { timeout: 120000 }, () => {
  const out = py(`
import threading
from heavy import import_torch, preload_torch
preload_torch()
ok = []
err = []
def worker():
    try:
        torch = import_torch()
        ok.append(hasattr(torch, 'Tensor'))
    except Exception as e:
        err.append(str(e))
threads = [threading.Thread(target=worker) for _ in range(4)]
for t in threads: t.start()
for t in threads: t.join()
print('ok' if ok and all(ok) and not err else 'fail ' + ';'.join(err))
`);
  assert.equal(out, 'ok');
});
