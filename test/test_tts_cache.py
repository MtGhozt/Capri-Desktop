'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function py(code) {
  const voice = path.join(__dirname, '..', 'voice');
  const venv = path.join(voice, '.venv', 'Scripts', 'python.exe');
  const bin = fs.existsSync(venv) ? venv : 'py';
  const args = bin === 'py' ? ['-3.11', '-c', code] : ['-c', code];
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    cwd: voice,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `exit ${result.status}`);
  }
  return String(result.stdout || '').trim();
}

test('ref cache key changes when the wav or transcript changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-ref-'));
  const wav = path.join(dir, 'capri_ref_short.wav');
  const txt = path.join(dir, 'capri_ref_short.txt');
  fs.writeFileSync(wav, 'wav-a');
  fs.writeFileSync(txt, 'hola');
  const a = py(
    `from pathlib import Path; from tts import ref_cache_key; print(ref_cache_key(Path(r'${wav}'), Path(r'${txt}')))`,
  );
  fs.writeFileSync(txt, 'chau');
  const b = py(
    `from pathlib import Path; from tts import ref_cache_key; print(ref_cache_key(Path(r'${wav}'), Path(r'${txt}')))`,
  );
  fs.writeFileSync(wav, 'wav-b');
  fs.writeFileSync(txt, 'hola');
  const c = py(
    `from pathlib import Path; from tts import ref_cache_key; print(ref_cache_key(Path(r'${wav}'), Path(r'${txt}')))`,
  );
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(b, c);
});
