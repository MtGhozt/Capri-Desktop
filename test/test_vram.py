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
  const result = spawnSync(bin, args, { encoding: 'utf8', cwd: voice });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `exit ${result.status}`);
  }
  return String(result.stdout || '').trim();
}

test('reserves Gemma VRAM when the LLM is not loaded yet', () => {
  const out = py(
    'from vram import usable_vram_mib; print(usable_vram_mib(6530, False)); print(usable_vram_mib(1081, True)); print(usable_vram_mib(6530, True))',
  );
  const [before, afterLoaded, alreadyFree] = out.split(/\s+/).map(Number);
  assert.equal(before, 2030);
  assert.equal(afterLoaded, 1081);
  assert.equal(alreadyFree, 6530);
});
