'use strict';

// Paso 4G: "apaga la compu", "reinicia la PC", "bloquea la pantalla"... The parser with real
// phrases (and the ones that must stay with the model), the confirmation (yes, no, silence),
// the countdown (voice, Esc, and the shutdown /a that stops it). Nothing real runs here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSystemCommand, readAnswer, createSystemFlow, runSystem, CONFIRM_MS, COUNTDOWN_MS } = require('../src/main/system-command');
const { POOLS, fillLine } = require('../src/main/lines-es');

const ORDERS = [
  ['apaga la compu', 'shutdown'],
  ['apaga la computadora', 'shutdown'],
  ['apaga el PC', 'shutdown'],
  ['apágate la compu', 'shutdown'],
  ['Capri, por favor, apaga la computadora.', 'shutdown'],
  ['apaga la conputadora', 'shutdown'],
  ['reinicia la compu', 'restart'],
  ['reinicia la computadora', 'restart'],
  ['reinicia el PC', 'restart'],
  ['renicia la compu', 'restart'],
  ['suspende la compu', 'suspend'],
  ['pon la compu a dormir', 'suspend'],
  ['suspende el PC', 'suspend'],
  ['suspende el pece', 'suspend'],
  ['bloquea la PC', 'lock'],
  ['bloquea la compu', 'lock'],
  ['bloquea la pantalla', 'lock'],
  ['blokea la pc', 'lock'],
  ['minimiza todo', 'minimize'],
  ['muéstrame el escritorio', 'minimize'],
  ['esconde todo', 'minimize'],
  ['minimisa todo, por favor', 'minimize'],
];

const OTHERS = [
  'apaga la música',
  'apaga la luz',
  'apaga el micrófono',
  'minimiza Discord',
  'reinicia la canción',
  'bloquea a alguien',
  'suspende la reunión',
  'apaga la computadora de Juan',
  'cuando apagues la compu',
  'apágala',
  'muéstrame la ventana',
  'reinicia el navegador',
  '¿me escuchas?',
  '',
];

test('real phrases, with accents and Whisper errors, are power commands', () => {
  for (const [said, action] of ORDERS) assert.equal(parseSystemCommand(said)?.action, action, said);
});

test('ordinary phrases stay with the model', () => {
  for (const said of OTHERS) assert.equal(parseSystemCommand(said), null, said);
});

test('only a clear yes runs it; no and anything else cancel it', () => {
  for (const yes of ['sí', 'Sí, dale', 'dale', 'confirmo', 'sí, por favor, dale', 'Confirmo']) assert.equal(readAnswer(yes), 'yes', yes);
  for (const no of ['no', 'No, gracias', 'mejor no', 'cancela', 'cancela eso']) assert.equal(readAnswer(no), 'no', no);
  for (const other of ['ok', 'claro', 'ajá', 'cuéntame un chiste', '']) assert.equal(readAnswer(other), 'other', other);
});

function flow({ run, cancel, confirmMs, countdownMs } = {}) {
  const did = [];
  const cancels = [];
  const logs = [];
  const events = [];
  const lines = [];
  const fxs = [];
  const esc = [];
  const f = createSystemFlow({
    run: async (action) => { did.push(action); return run ? run(action) : { ok: true }; },
    cancel: async () => { cancels.push('a'); return cancel ? cancel() : { ok: true }; },
    line: (kind, values) => `${kind}${values?.accion ? `:${values.accion}` : ''}`,
    say: (text) => lines.push(text),
    log: (text) => logs.push(text),
    event: (text) => events.push(text),
    fx: (action) => fxs.push(action),
    escape: (on) => esc.push(on),
    ...(confirmMs != null ? { confirmMs } : {}),
    ...(countdownMs != null ? { countdownMs } : {}),
  });
  return { f, did, cancels, logs, events, lines, fxs, esc };
}

test('"apaga la compu" asks first, and a clear yes runs it with the countdown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = flow();
  await h.f.command('apaga la compu');
  assert.deepEqual(h.did, []);
  assert.equal(h.logs[0], 'system shutdown asked');
  assert.equal(h.lines[0], 'sistemaConfirmar:apago la compu');

  const res = await h.f.answer('sí, dale');
  assert.equal(res.ok, true);
  assert.deepEqual(h.did, ['shutdown']);
  assert.deepEqual(h.logs, ['system shutdown asked', 'system shutdown confirmed', 'system shutdown ok']);
  assert.deepEqual(h.fxs, ['shutdown']);
  assert.deepEqual(h.events, ['apagar la compu']);
  assert.equal(h.lines.at(-1), 'sistemaCuenta:apago la compu');
  assert.equal(h.f.countdown, 'shutdown');
  assert.deepEqual(h.esc, [true]);

  // once the five seconds pass, Esc is hers again and nothing else happens
  t.mock.timers.tick(COUNTDOWN_MS);
  assert.equal(h.f.countdown, null);
  assert.deepEqual(h.esc, [true, false]);
});

test('silence cancels: she says so and never runs it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = flow();
  await h.f.command('reinicia la compu');
  assert.equal(h.f.pending, 'restart');
  t.mock.timers.tick(CONFIRM_MS);
  assert.equal(h.f.pending, null);
  assert.deepEqual(h.did, []);
  assert.ok(h.logs.includes('system restart cancelled: timeout'));
  assert.equal(h.lines.at(-1), 'sistemaCancelado:reinicio la compu');
  assert.deepEqual(h.events, ['cancelado']);
  assert.equal(await h.f.answer('sí'), null); // too late: no longer waiting
});

test('no, or anything else, cancels without running it', async () => {
  let h = flow();
  await h.f.command('suspende la compu');
  assert.deepEqual(await h.f.answer('mejor no'), { ok: true, cancelled: true });
  assert.deepEqual(h.did, []);
  assert.ok(h.logs.includes('system suspend cancelled: no'));

  h = flow();
  await h.f.command('apaga la PC');
  assert.deepEqual(await h.f.answer('¿qué hora es?'), { ok: true, cancelled: true });
  assert.deepEqual(h.did, []);
});

test('suspending asks, and after a yes it goes at once (no countdown)', async () => {
  const h = flow();
  await h.f.command('pon la compu a dormir');
  await h.f.answer('confirmo');
  assert.deepEqual(h.did, ['suspend']);
  assert.deepEqual(h.fxs, ['suspend']);
  assert.equal(h.f.countdown, null);
  assert.deepEqual(h.esc, []);
  assert.equal(h.lines.at(-1), 'sistemaHecho:compu suspendida');
});

test('the countdown stops with "cancela" (shutdown /a)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = flow();
  await h.f.command('apaga la compu');
  await h.f.answer('sí');
  assert.deepEqual(await h.f.answer('cancela'), { ok: true, cancelled: true });
  assert.deepEqual(h.cancels, ['a']);
  assert.equal(h.f.countdown, null);
  assert.deepEqual(h.esc, [true, false]);
  assert.ok(h.logs.includes('system shutdown cancelled: voz'));
  assert.equal(h.lines.at(-1), 'sistemaCancelado:apago la compu');
});

test('the countdown stops with Esc', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = flow();
  await h.f.command('reinicia la compu');
  await h.f.answer('dale');
  assert.deepEqual(await h.f.cancel('esc'), { ok: true, cancelled: true });
  assert.deepEqual(h.cancels, ['a']);
  assert.ok(h.logs.includes('system restart cancelled: esc'));
  // the countdown releases Esc itself
  assert.deepEqual(h.esc, [true, false]);
});

test('a cancel that fails is said honestly', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = flow({ cancel: () => ({ ok: false, error: 'exit 5' }) });
  await h.f.command('apaga la compu');
  await h.f.answer('sí');
  assert.deepEqual(await h.f.cancel('esc'), { ok: false });
  assert.ok(h.logs.includes('system shutdown failed: cancel failed: exit 5'));
  assert.equal(h.lines.at(-1), 'sistemaNoCancelado');
  assert.deepEqual(h.events.at(-1), 'no pude cancelar');
});

test('locking and minimizing go at once, and say it', async () => {
  const h = flow();
  assert.deepEqual(await h.f.command('bloquea la PC'), { ok: true });
  assert.deepEqual(await h.f.command('muéstrame el escritorio'), { ok: true });
  assert.deepEqual(h.did, ['lock', 'minimize']);
  assert.deepEqual(h.fxs, []); // the glitch is only for shutdown / restart / suspend
  assert.deepEqual(h.lines, ['sistemaHecho:PC bloqueada', 'sistemaHecho:todo minimizado']);
  assert.deepEqual(h.events, ['bloquear la PC', 'minimizar todo']);
  assert.equal(await h.f.command('abre Discord'), null);
});

test('a command that fails is told, not faked', async () => {
  const h = flow({ run: () => ({ ok: false, error: 'exit 1' }) });
  await h.f.command('bloquea la PC');
  assert.equal(h.lines.at(-1), 'sistemaFallo:bloquear la PC');
  assert.ok(h.logs.includes('system lock failed: exit 1'));
  assert.deepEqual(h.events, ['no pude bloquear la PC']);
});

test('the executor refuses an action it does not know, and runs nothing', async () => {
  assert.deepEqual(await runSystem('hack'), { ok: false, error: 'unknown action: hack' });
});

test('her power lines: 8 to 10 each, only the question asks', () => {
  const questions = ['sistemaConfirmar'];
  const statements = ['sistemaCuenta', 'sistemaHecho', 'sistemaCancelado', 'sistemaFallo', 'sistemaNoCancelado'];
  for (const kind of [...questions, ...statements]) {
    assert.ok(POOLS[kind]?.length >= 8 && POOLS[kind].length <= 10, kind);
    for (const line of POOLS[kind]) {
      // a "?" at the end opens the mic for the answer (4B): only the question may do it
      assert.equal(/\?\s*$/.test(line), questions.includes(kind), `${kind}: ${line}`);
      const said = fillLine(line, { accion: 'apago la compu' });
      assert.ok(!/[{}]/.test(said), `${kind}: ${said}`);
    }
  }
});
