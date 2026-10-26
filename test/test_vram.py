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

test('LM Studio origin strips the OpenAI /v1 suffix', () => {
  const out = py(
    "from vram import origin_from_base_url; print(origin_from_base_url('http://localhost:1235/v1'))",
  );
  assert.equal(out, 'http://localhost:1235');
});

test('only counts LM Studio models whose state is loaded', () => {
  const out = py(
    "from vram import model_is_loaded; "
    + "print(int(model_is_loaded({'data':[{'id':'gemma','state':'not-loaded'}]}))); "
    + "print(int(model_is_loaded({'data':[{'id':'gemma','state':'loaded'}]}))); "
    + "print(int(model_is_loaded({'data':[{'id':'gemma'}]})))",
  );
  const [listed, loaded, missing] = out.split(/\s+/).map(Number);
  assert.equal(listed, 0);
  assert.equal(loaded, 1);
  assert.equal(missing, 0);
});

test('reserves Gemma VRAM when the LLM is not loaded yet', () => {
  const out = py(
    'from vram import usable_vram_mib; print(usable_vram_mib(6530, False)); print(usable_vram_mib(1081, True)); print(usable_vram_mib(6530, True))',
  );
  const [before, afterLoaded, alreadyFree] = out.split(/\s+/).map(Number);
  assert.equal(before, 2030);
  assert.equal(afterLoaded, 1081);
  assert.equal(alreadyFree, 6530);
});
