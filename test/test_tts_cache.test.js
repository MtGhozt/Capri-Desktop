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

test('TTS speaks percent and Celsius, drops guillemets and parentheses', () => {
  const out = py(
    'from tts_text import clean_for_tts; '
    + 'print(clean_for_tts("lluvia 80%")); '
    + 'print(clean_for_tts("hace 24°C")); '
    + 'print(clean_for_tts("son 19 °C")); '
    + 'print(clean_for_tts("«hola» (choom)")); '
    + 'print(clean_for_tts("probabilidad 100%"))',
  );
  const lines = out.split(/\r?\n/);
  assert.match(lines[0], /ochenta por ciento/i);
  assert.match(lines[1], /veinticuatro grados/i);
  assert.match(lines[2], /diecinueve grados/i);
  assert.match(lines[3], /hola choom/i);
  assert.doesNotMatch(lines[3], /[«»()]/);
  assert.match(lines[4], /cien por ciento/i);
});

test('TTS speaks byte units, drive letters and IPv4 with punto', () => {
  const out = py(
    'from tts_text import clean_for_tts; '
    + 'print(clean_for_tts("Disco: C: libre 15.2 GB de 512 GB.")); '
    + 'print(clean_for_tts("quedan 800 MB y 1 TB")); '
    + 'print(clean_for_tts("IP local: 192.168.1.10."))',
  );
  const lines = out.split(/\r?\n/);
  assert.match(lines[0], /disco C/i);
  assert.match(lines[0], /gigas/i);
  assert.doesNotMatch(lines[0], /\bGB\b/);
  assert.match(lines[1], /megas/i);
  assert.match(lines[1], /teras/i);
  assert.match(lines[2], /punto/i);
  assert.doesNotMatch(lines[2], /\d+\.\d+\.\d+\.\d+/);
  assert.match(lines[2], /ciento noventa y dos punto ciento sesenta y ocho/i);
});

test('TTS splits a laugh into comma beats without touching real words', () => {
  const out = py(
    'from tts_text import clean_for_tts; '
    + 'print(clean_for_tts("¡Jajaja!").encode("utf-8").hex()); '
    + 'print(clean_for_tts("Jajaja")); '
    + 'print(clean_for_tts("jaja")); '
    + 'print(clean_for_tts("caja")); '
    + 'print(clean_for_tts("trabajo")); '
    + 'print(clean_for_tts("Jajaja, tontito")); '
    + 'print(clean_for_tts("jajajajajajajaja"))',
  );
  const lines = out.split(/\r?\n/);
  assert.equal(lines[0], Buffer.from('¡ja, ja, ja!', 'utf8').toString('hex'));
  assert.equal(lines[1], 'ja, ja, ja');
  assert.equal(lines[2], 'ja, ja');
  assert.equal(lines[3], 'caja');
  assert.equal(lines[4], 'trabajo');
  assert.equal(lines[5], 'ja, ja, ja, tontito');
  assert.equal(lines[6], 'ja, ja, ja, ja'); // capped, not a list
});

test('TTS splits long phrases at commas for OmniVoice chunks', () => {
  const out = py(
    'from tts_text import split_for_tts; '
    + 'parts = split_for_tts('
    + '"Hola choom, hoy apunta a lluvia leve, probabilidad alta, máx veintisiete, '
    + 'mín diecinueve, y mañana sigue igual en San José."'
    + ', 80); '
    + 'print(len(parts)); '
    + 'print("|".join(parts)); '
    + 'print(all(len(p) <= 90 for p in parts))',
  );
  const lines = out.split(/\r?\n/);
  assert.ok(Number(lines[0]) >= 2);
  assert.match(lines[1], /,/); // kept as separate spoken chunks, not one blob
  assert.equal(lines[2], 'True');
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

test('an RTX 4060 (sm_89) runs the sm_86 cubin torch ships', () => {
  const out = py(
    'import tts\n'
    + 'class Cuda:\n'
    + '    def is_available(self): return True\n'
    + '    def get_device_capability(self, n=0): return (8, 9)\n'
    + '    def get_arch_list(self): return ["sm_75", "sm_80", "sm_86", "sm_90", "sm_100", "sm_120"]\n'
    + 'class Torch:\n'
    + '    cuda = Cuda()\n'
    + 'print(tts.cuda_arch_reason(Torch()))',
  );
  assert.equal(out, 'None');
});

test('a GPU from another major version is still rejected', () => {
  const out = py(
    'import tts\n'
    + 'class Cuda:\n'
    + '    def is_available(self): return True\n'
    + '    def get_device_capability(self, n=0): return (8, 9)\n'
    + '    def get_arch_list(self): return ["sm_90"]\n'
    + 'class Torch:\n'
    + '    cuda = Cuda()\n'
    + 'print(tts.cuda_arch_reason(Torch()))',
  );
  assert.match(out, /sm_89/);
  assert.match(out, /not supported/);
});

test('the fallback notice names Torch, CUDA, VRAM and other failures apart', () => {
  const out = py(
    'import tts\n'
    + 'print(tts.fallback_message("No module named \'torch\'"))\n'
    + 'print(tts.fallback_message("omnivoice skipped GPU: sm_89 not supported by torch (sm_86)"))\n'
    + 'print(tts.fallback_message("omnivoice skipped GPU: vram 1730 MiB < 2000"))\n'
    + 'print(tts.fallback_message("CUDA out of memory"))\n'
    + 'print(tts.fallback_message("boom while loading"))',
  );
  const [missing, arch, vram, oom, other] = out.split(/\r?\n/);
  assert.match(missing, /Torch/);
  assert.match(missing, /Reinstal/);
  assert.match(arch, /Torch/);
  assert.match(vram, /memoria/);
  assert.match(oom, /memoria/);
  assert.match(other, /log/);
  assert.doesNotMatch(other, /memoria|GPU/);
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
