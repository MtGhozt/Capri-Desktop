'use strict';

// Paso 4G: "apaga la compu", "reinicia la PC", "bloquea la pantalla"... The parser with real
// phrases (and the ones that must stay with the model), the confirmation (yes, no, silence),
// the countdown (voice, Esc, and the shutdown /a that stops it). Nothing real runs here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSystemCommand, readAnswer, createSystemFlow, runSystem, CONFIRM_MS } = require('../src/main/system-command');
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

// A fake PC: every step is a promise the test settles by hand, so it can check what ran when.
function flow({ run } = {}) {
  const order = []; // everything, in order
  const did = [];
  const logs = [];
  const events = [];
  const lines = [];
  const esc = [];
  const fxs = [];
  let endSpeech = () => {};
  let endFx = () => {};
  const f = createSystemFlow({
    run: async (action) => { order.push(`run:${action}`); did.push(action); return run ? run(action) : { ok: true }; },
    line: (kind, values) => `${kind}${values?.accion ? `:${values.accion}` : ''}`,
    say: (text) => {
      lines.push(text);
      order.push(`say:${text}`);
      return new Promise((resolve) => { endSpeech = () => { order.push('said'); resolve(); }; });
    },
    log: (text) => logs.push(text),
    event: (text) => events.push(text),
    fx: (action, opts) => {
      fxs.push(opts?.preview ? `${action}:preview` : action);
      order.push(`fx:${action}`);
      return new Promise((resolve) => { endFx = () => { order.push('fx-done'); resolve(); }; });
    },
    stopFx: () => order.push('fx-stop'),
    clearFx: () => order.push('fx-clear'),
    escape: (on) => esc.push(on),
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  return {
    f, did, logs, events, lines, esc, fxs, order, tick,
    endSpeech: async () => { endSpeech(); await tick(); },
    endFx: async () => { endFx(); await tick(); },
  };
}

test('"apaga la compu": asks, then her line, the animation, and only then the command', async () => {
  const h = flow();
  await h.f.command('apaga la compu');
  assert.deepEqual(h.did, []);
  assert.equal(h.logs[0], 'system shutdown asked');
  assert.equal(h.lines[0], 'sistemaConfirmar:apago la compu');

  assert.deepEqual(await h.f.answer('sí, dale'), { ok: true, confirmed: true });
  await h.tick();
  assert.equal(h.lines.at(-1), 'sistemaAdios:apago la compu');
  assert.deepEqual(h.did, [], 'nothing runs while she talks');
  assert.deepEqual(h.fxs, [], 'the animation waits for her line');
  assert.deepEqual(h.esc, [true]);

  await h.endSpeech();
  assert.deepEqual(h.fxs, ['shutdown']);
  assert.deepEqual(h.did, [], 'nothing runs during the animation');

  await h.endFx();
  await h.tick();
  assert.deepEqual(h.did, ['shutdown']);
  const at = (step) => h.order.indexOf(step);
  assert.ok(at('said') < at('fx:shutdown') && at('fx-done') < at('run:shutdown'), h.order.join(' > '));
  assert.deepEqual(h.logs, ['system shutdown asked', 'system shutdown confirmed', 'system shutdown ok']);
  assert.deepEqual(h.events, ['apagar la compu']);
  assert.deepEqual(h.esc, [true, false]);
  assert.equal(h.f.running, null);
});

test('the real commands go at once: the waiting happened on her screen', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/main/system-command'), 'utf8');
  assert.match(src, /\['\/s', '\/t', '0'\]/);
  assert.match(src, /\['\/r', '\/t', '0'\]/);
  assert.doesNotMatch(src, /'\/t', '5'/);
  assert.match(src, /SetSuspendState\('Suspend', \$false, \$false\)/); // sleep, not hibernate
  assert.doesNotMatch(src, /powrprof/);
});

for (const [when, step] of [['while she talks', 'say'], ['during the animation', 'fx']]) {
  test(`"cancela" ${when} stops it all and nothing runs`, async () => {
    const h = flow();
    await h.f.command('reinicia la compu');
    await h.f.answer('dale');
    await h.tick();
    if (step === 'fx') await h.endSpeech();
    assert.deepEqual(await h.f.answer('cancela'), { ok: true, cancelled: true });
    await h.endSpeech();
    await h.endFx();
    await h.tick();
    assert.deepEqual(h.did, []);
    assert.ok(h.order.includes('fx-stop'));
    assert.ok(h.logs.includes('system restart cancelled: voz'));
    assert.equal(h.lines.at(-1), 'sistemaCancelado:reinicio la compu');
    assert.deepEqual(h.esc, [true, false]);
  });
}

test('Esc during the animation stops it and nothing runs', async () => {
  const h = flow();
  await h.f.command('apaga la compu');
  await h.f.answer('sí');
  await h.tick();
  await h.endSpeech();
  assert.deepEqual(h.f.cancel('esc'), { ok: true, cancelled: true });
  await h.endFx();
  await h.tick();
  assert.deepEqual(h.did, []);
  assert.ok(h.logs.includes('system shutdown cancelled: esc'));
  assert.equal(h.f.cancel('esc'), null, 'nothing left to cancel');
});

test('"no" after the command is out is just a message for the router', async () => {
  const h = flow();
  assert.equal(await h.f.answer('no'), null);
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

test('suspending plays the same sequence and gives the screen back after', async () => {
  const h = flow();
  await h.f.command('pon la compu a dormir');
  await h.f.answer('confirmo');
  await h.tick();
  await h.endSpeech();
  assert.deepEqual(h.fxs, ['suspend']);
  assert.deepEqual(h.did, []);
  await h.endFx();
  await h.tick();
  assert.deepEqual(h.did, ['suspend']);
  assert.equal(h.order.at(-1), 'fx-clear');
});

test('"Capri, prueba el apagado" plays it all and never runs anything', async () => {
  for (const [said, action] of [['Capri, prueba el apagado', 'shutdown'], ['prueba el reinicio', 'restart'], ['Prueba la suspensión.', 'suspend']]) {
    assert.deepEqual(parseSystemCommand(said), { action, preview: true }, said);
  }
  const h = flow();
  assert.deepEqual(await h.f.command('Capri, prueba el apagado'), { ok: true, preview: true });
  await h.tick();
  assert.equal(h.lines.at(-1), 'sistemaPrueba:apago la compu');
  await h.endSpeech();
  assert.deepEqual(h.fxs, ['shutdown:preview']);
  await h.endFx();
  await h.tick();
  assert.deepEqual(h.did, []);
  assert.equal(h.order.at(-1), 'fx-clear');
  assert.deepEqual(h.logs, ['system shutdown preview', 'system shutdown preview done']);
});

test('a preview can be stopped with Esc too', async () => {
  const h = flow();
  await h.f.command('prueba el apagado');
  await h.tick();
  assert.deepEqual(h.f.cancel('esc'), { ok: true, cancelled: true });
  await h.endSpeech();
  await h.endFx();
  assert.deepEqual(h.did, []);
  assert.ok(h.logs.includes('system shutdown preview cancelled: esc'));
});

test('a command that fails after the animation is told, and the screen comes back', async () => {
  const h = flow({ run: () => ({ ok: false, error: 'exit 1190' }) });
  await h.f.command('apaga la compu');
  await h.f.answer('sí');
  await h.tick();
  await h.endSpeech();
  await h.endFx();
  await h.tick();
  assert.ok(h.logs.includes('system shutdown failed: exit 1190'));
  assert.equal(h.lines.at(-1), 'sistemaFallo:apagar la compu');
  assert.ok(h.order.includes('fx-clear'));
});

test('locking and minimizing go at once, and say it', async () => {
  const h = flow();
  assert.deepEqual(await h.f.command('bloquea la PC'), { ok: true });
  assert.deepEqual(await h.f.command('muéstrame el escritorio'), { ok: true });
  assert.deepEqual(h.did, ['lock', 'minimize']);
  assert.deepEqual(h.fxs, []); // the animation is only for shutdown / restart / suspend
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
  const statements = ['sistemaAdios', 'sistemaPrueba', 'sistemaHecho', 'sistemaCancelado', 'sistemaFallo'];
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
