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

test('ttsRef null resolves to design mode, not a missing default wav', () => {
  const out = py(
    'from pathlib import Path; from tts import resolve_ref, design_instruct, DEFAULT_TTS_DESIGN; '
    + 'import tempfile; '
    + 'd=Path(tempfile.mkdtemp()); '
    + 'print(resolve_ref(d, None)); '
    + 'print(resolve_ref(d, "")); '
    + 'print(design_instruct(None)); '
    + 'print(design_instruct(DEFAULT_TTS_DESIGN))',
  );
  const lines = out.split(/\r?\n/);
  assert.equal(lines[0], '(None, None)');
  assert.equal(lines[1], '(None, None)');
  assert.match(lines[2], /female/);
  assert.match(lines[3], /female/);
  assert.match(lines[3], /young adult/);
});

test('clamps OmniVoice diffusion steps', () => {
  const out = py(
    'from tts import tts_steps; print(tts_steps(None)); print(tts_steps(12)); print(tts_steps(3)); print(tts_steps(99))',
  );
  const [fallback, twelve, low, high] = out.split(/\s+/).map(Number);
  assert.equal(fallback, 16);
  assert.equal(twelve, 12);
  assert.equal(low, 8);
  assert.equal(high, 32);
});

test('normalizes PCM peak to about -1 dBFS', () => {
  const out = py(
    'import numpy as np; from tts import normalize_pcm; '
    + 'x=normalize_pcm(np.array([0.1,-0.2,0.05], dtype=np.float32)); '
    + 'print(round(float(np.max(np.abs(x))), 4))',
  );
  assert.equal(Number(out), 0.8913);
});

test('TTS turns colon, dash, ellipsis and newlines into pauses', () => {
  const out = py(
    'from tts_text import clean_for_tts; '
    + 'print(clean_for_tts("Spoiler: no la va a poner")); '
    + 'print(clean_for_tts("Uno—dos…tres")); '
    + 'print(clean_for_tts("Hola\\nmundo"))',
  );
  const lines = out.split(/\r?\n/);
  assert.match(lines[0], /Spoiler\.\s+no la va a poner/i);
  assert.match(lines[1], /Uno,\s+dos\.\s+tres/i);
  assert.match(lines[2], /Hola\.\s+mundo/i);
});

test('missing mood prompt falls back to the playful default', () => {
  const out = py(
    'from tts import pick_mood_prompt; '
    + 'prompts={"burla":"B","seria":"S"}; '
    + 'print(pick_mood_prompt("burla", prompts, "DEFAULT")); '
    + 'print(pick_mood_prompt("emocion", prompts, "DEFAULT")); '
    + 'print(pick_mood_prompt(None, prompts, "DEFAULT")); '
    + 'print(pick_mood_prompt("seria", {}, "DEFAULT"))',
  );
  const lines = out.split(/\r?\n/);
  assert.equal(lines[0], "('B', 'burla')");
  assert.equal(lines[1], "('DEFAULT', 'playful')");
  assert.equal(lines[2], "('DEFAULT', 'playful')");
  assert.equal(lines[3], "('DEFAULT', 'playful')");
});

test('reference transcripts read utf-8 BOM and Windows cp1252', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-ref-enc-'));
  const txt = path.join(dir, 'ref.txt');
  const read = () => py(
    `from pathlib import Path; from tts import verify_ref_transcript; `
    + `print(verify_ref_transcript(Path(r'${txt}'), lambda m: None, 'test').encode('utf-8').hex())`,
  );
  const expected = Buffer.from('Hola ñandú', 'utf8').toString('hex');
  fs.writeFileSync(txt, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('Hola ñandú', 'utf8'),
  ]));
  assert.equal(read(), expected);
  fs.writeFileSync(txt, Buffer.from('Hola ñandú', 'latin1'));
  assert.equal(read(), expected);
});

test('a missing clone transcript says it fell back to voice-design', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-ref-notice-'));
  const wav = path.join(dir, 'ref.wav');
  fs.writeFileSync(wav, 'RIFF');
  const out = py(
    'from pathlib import Path; import tts\n'
    + 'class Cuda:\n'
    + '    def is_available(self): return False\n'
    + 'class Torch:\n'
    + '    cuda = Cuda()\n'
    + 'tts.import_omnivoice = lambda log: (Torch(), object, object)\n'
    + 'seen = []\n'
    + `o = tts.OmniVoiceTTS(Path('.'), lambda m: None, Path(r'${wav}'), Path(r'${wav}').with_suffix('.txt'), notice=seen.append)\n`
    + 'try:\n'
    + '    o.load(allow_cpu=False, free_vram=0)\n'
    + 'except tts.OmniVoiceUnavailable as err:\n'
    + '    print(type(err).__name__)\n'
    + 'print(seen)',
  );
  const [error, notices] = out.split(/\r?\n/);
  assert.match(error, /OmniVoiceUnavailable/);
  assert.match(notices, /transcripci/i);
});

test('an unsupported CUDA compute capability is a GPU reason, not a warning', () => {
  const out = py(
    'import tts\n'
    + 'class Cuda:\n'
    + '    def is_available(self): return True\n'
    + '    def get_device_capability(self, n=0): return (6, 1)\n'
    + '    def get_arch_list(self): return ["sm_75", "sm_80"]\n'
    + 'class Torch:\n'
    + '    cuda = Cuda()\n'
    + 'print(tts.cuda_arch_reason(Torch()))',
  );
  assert.match(out, /sm_61/);
  assert.match(out, /not supported/);
});

test('mood prompts are built once, on first use, not all at boot', () => {
  const out = py(
    'import tempfile; from pathlib import Path; from tts import OmniVoiceTTS\n'
    + 'd = Path(tempfile.mkdtemp()); (d / "b.wav").write_bytes(b"x"); (d / "b.txt").write_text("hola")\n'
    + 'o = OmniVoiceTTS(Path("."), lambda m: None, d / "a.wav", d / "a.txt", '
    + 'mood_refs={"burla": (d / "b.wav", d / "b.txt")}); '
    + 'o._model = object(); o._vcp = object; o.device = "cpu"; '
    + 'calls = []; '
    + 'o._cache_prompt = lambda vcp, wav, txt, text: calls.append(wav.name) or f"P-{wav.stem}"; '
    + 'print(len(o._mood_prompts)); '
    + 'print(o._prompt_for("burla")); '
    + 'print(o._prompt_for("burla")); '
    + 'print(calls)',
  );
  const lines = out.split(/\r?\n/);
  assert.equal(lines[0], '0');
  assert.equal(lines[1], 'P-b');
  assert.equal(lines[2], 'P-b');
  assert.equal(lines[3], "['b.wav']");
});
