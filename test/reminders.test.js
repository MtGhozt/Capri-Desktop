'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseReminderCommand, formatWhen, deliverReminder, createReminders,
  readsAsReminderRequest, promisesReminder,
} = require('../src/main/reminders');
const { stripReplyTags } = require('../src/main/mood-tag');

const MIN = 60000;

test('direct timer phrases become an absolute time', () => {
  const now = 1000;
  const ten = parseReminderCommand('timer 10 minutos', { now });
  assert.equal(ten.action, 'create');
  assert.equal(ten.at, now + 10 * MIN);
  assert.match(ten.text, /10 minutos/);

  const half = parseReminderCommand('avisame en media hora', { now });
  assert.equal(half.at, now + 30 * MIN);

  const two = parseReminderCommand('recordame en 2 horas', { now });
  assert.equal(two.at, now + 120 * MIN);

  const set = parseReminderCommand('ponme un temporizador de 5 minutos para el té', { now });
  assert.equal(set.at, now + 5 * MIN);
  assert.equal(set.text, 'el te');
});

test('dates and non-orders are left for the model', () => {
  assert.equal(parseReminderCommand('recordame mañana a las 8 que tengo un evento'), null);
  assert.equal(parseReminderCommand('me gusta el té'), null);
});

test('list and cancel are direct orders too', () => {
  assert.deepEqual(parseReminderCommand('qué recordatorios tengo'), { action: 'list' });
  assert.deepEqual(parseReminderCommand('cancelá el recordatorio'), {
    action: 'cancel', all: false, match: '',
  });
  assert.deepEqual(parseReminderCommand('cancelá el recordatorio de la basura'), {
    action: 'cancel', all: false, match: 'la basura',
  });
  assert.deepEqual(parseReminderCommand('cancelá todos los recordatorios'), {
    action: 'cancel', all: true, match: '',
  });
});

test('her remind tag carries the absolute time and a short text', () => {
  const parsed = stripReplyTags('[remind:2026-11-08T07:00:00-06:00|tengo un evento] Dale.');
  assert.equal(parsed.text, 'Dale.');
  assert.deepEqual(parsed.action, {
    kind: 'remind', value: 'tengo un evento', at: '2026-11-08T13:00:00.000Z',
  });
  assert.equal(stripReplyTags('[remind:mañana|algo] Nada.').action, null);
});

test('remind tag accepts advance-notice minutes before the event', () => {
  const {
    parseNoticeMinutes, resolveFireAt, DEFAULT_NOTICE_MIN,
  } = require('../src/main/reminders');
  assert.equal(parseNoticeMinutes('60'), 60);
  assert.equal(parseNoticeMinutes('2h'), 120);
  assert.equal(parseNoticeMinutes(''), 0);
  assert.equal(parseNoticeMinutes('', { fallback: DEFAULT_NOTICE_MIN }), 60);

  const eventAt = Date.parse('2026-11-08T14:00:00.000Z');
  assert.deepEqual(resolveFireAt(eventAt, 60), {
    eventAt, noticeMin: 60, at: eventAt - 60 * MIN,
  });

  const tagged = stripReplyTags('[remind:2026-11-08T08:00:00-06:00|tengo un evento|60] Ok.');
  assert.equal(tagged.action.noticeMin, 60);
  assert.equal(tagged.action.value, 'tengo un evento');
  assert.equal(tagged.action.at, '2026-11-08T14:00:00.000Z');

  const twoH = stripReplyTags('[remind:2026-11-08T08:00:00-06:00|reunion|2h] Dale.');
  assert.equal(twoH.action.noticeMin, 120);
});

test('advance-notice reminders fire before the event and keep eventAt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-'));
  const file = path.join(dir, 'reminders.json');
  try {
    const { resolveFireAt } = require('../src/main/reminders');
    const eventAt = 1000 + 3 * 60 * MIN;
    const resolved = resolveFireAt(eventAt, 60);
    const store = createReminders({ file, now: () => 1000, intervalMs: 0 });
    const item = store.add({
      at: resolved.at, text: 'tengo un evento', eventAt, noticeMin: 60,
    });
    assert.equal(item.at, eventAt - 60 * MIN);
    assert.equal(item.eventAt, eventAt);
    assert.equal(item.noticeMin, 60);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('move and edit resolve by clock or text, and ask when ambiguous', () => {
  const {
    parseReminderCommand, parseMoveTarget, findMatches,
  } = require('../src/main/reminders');
  const now = Date.parse('2026-11-08T12:00:00.000Z');
  const zone = 'America/Costa_Rica';
  const eight = parseMoveTarget('a las 8', { now, timeZone: zone });
  const nine = parseMoveTarget('a las 9', { now, timeZone: zone });
  assert.ok(eight < nine);

  const move = parseReminderCommand('pasá el de las 8 a las 9', { now, timeZone: zone });
  assert.equal(move.action, 'move');
  assert.match(move.match, /8/);
  assert.equal(move.at, nine);

  const water = parseReminderCommand('mové el de tomar agua a mañana', { now, timeZone: zone });
  assert.equal(water.action, 'move');
  assert.match(water.match, /tomar agua/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-'));
  const file = path.join(dir, 'reminders.json');
  try {
    const store = createReminders({ file, now: () => now, intervalMs: 0 });
    store.add({ at: eight, text: 'evento A' });
    store.add({ at: eight + 24 * 60 * MIN, text: 'evento B' });
    store.add({ at: nine, text: 'tomar agua' });
    assert.equal(findMatches(store.list(), 'las 8', { timeZone: zone }).length, 2);
    assert.equal(findMatches(store.list(), 'tomar agua', { timeZone: zone }).length, 1);

    const updated = store.update(store.list().find((item) => item.text === 'tomar agua').id, {
      at: eight,
    });
    assert.equal(updated.at, eight);
    assert.equal(store.remove(updated.id).text, 'tomar agua');
    assert.equal(store.list().length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('settings menu lists pending reminders with edit and delete actions', () => {
  const menu = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(menu, /RECORDATORIOS/);
  assert.match(menu, /reminder-update/);
  assert.match(menu, /reminder-delete/);
  assert.match(menu, /datetime-local/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /case 'reminder-update'/);
  assert.match(main, /case 'reminder-delete'/);
  assert.match(main, /reminders:\s*\(reminders/);
});

test('confirmation names the resolved local time', () => {
  const now = new Date('2026-11-07T12:00:00.000Z');
  assert.equal(
    formatWhen(Date.parse('2026-11-08T13:00:00.000Z'), { now, timeZone: 'Europe/Madrid' }),
    'mañana a las 14:00',
  );
});

test('reminders survive a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-'));
  const file = path.join(dir, 'reminders.json');
  try {
    const first = createReminders({ file, now: () => 1000, intervalMs: 0 });
    first.add({ at: 1000 + 10 * MIN, text: 'sacar la basura' });
    const second = createReminders({ file, now: () => 2000, intervalMs: 0 });
    second.start();
    assert.deepEqual(second.list().map((item) => item.text), ['sacar la basura']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a reminder missed while she was closed is said once and dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-'));
  const file = path.join(dir, 'reminders.json');
  try {
    createReminders({ file, now: () => 1000, intervalMs: 0 })
      .add({ at: 5000, text: 'pagar la luz' });
    const fired = [];
    const store = createReminders({
      file,
      now: () => 10000,
      intervalMs: 0,
      fire: (item, info) => fired.push({ item, ...info }),
    });
    assert.deepEqual(store.start(), { missed: 1, pending: 0 });
    assert.equal(fired.length, 1);
    assert.equal(fired[0].missed, true);
    assert.equal(fired[0].item.text, 'pagar la luz');
    assert.equal(store.list().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('several missed reminders are told once, grouped into one line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-'));
  const file = path.join(dir, 'reminders.json');
  try {
    const before = createReminders({ file, now: () => 1000, intervalMs: 0 });
    before.add({ at: 4000, text: 'pagar la luz' });
    before.add({ at: 5000, text: 'sacar la basura' });
    before.add({ at: 20000, text: 'llamar al dentista' });
    const fired = [];
    const store = createReminders({
      file,
      now: () => 10000,
      intervalMs: 0,
      fire: (item, info) => fired.push({ item, ...info }),
    });
    assert.deepEqual(store.start(), { missed: 2, pending: 1 });
    assert.equal(fired.length, 1, 'one bubble, not one per reminder');
    assert.equal(fired[0].missed, true);
    assert.equal(fired[0].item.count, 2);
    assert.match(fired[0].item.text, /pagar la luz/);
    assert.match(fired[0].item.text, /sacar la basura/);
    assert.deepEqual(store.list().map((item) => item.text), ['llamar al dentista']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missedCount sees reminders before start, so the greeting can step aside', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-'));
  const file = path.join(dir, 'reminders.json');
  try {
    createReminders({ file, now: () => 1000, intervalMs: 0 })
      .add({ at: 5000, text: 'pagar la luz' });
    const store = createReminders({ file, now: () => 10000, intervalMs: 0 });
    assert.equal(store.missedCount(), 1);
    store.start();
    const after = createReminders({ file, now: () => 20000, intervalMs: 0 });
    assert.equal(after.missedCount(), 0);
    // the guard lives in main.js: the boot greeting must check it before saying hello
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    assert.match(source, /reminders\?\.missedCount\?\.\(\)\s*\|\|\s*0\)\s*>\s*0/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cancel one removes the next pending or the one that matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-'));
  const file = path.join(dir, 'reminders.json');
  try {
    const store = createReminders({ file, now: () => 1000, intervalMs: 0 });
    store.add({ at: 2000, text: 'pagar la luz' });
    store.add({ at: 3000, text: 'sacar la basura' });
    assert.equal(store.cancelOne('').text, 'pagar la luz');
    assert.equal(store.cancelOne('basura').text, 'sacar la basura');
    assert.equal(store.list().length, 0);
    assert.equal(store.cancelOne(''), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list is ordered and cancel clears every reminder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-'));
  const file = path.join(dir, 'reminders.json');
  try {
    const store = createReminders({ file, now: () => 1000, intervalMs: 0 });
    store.add({ at: 3000, text: 'segundo' });
    store.add({ at: 2000, text: 'primero' });
    assert.deepEqual(store.list().map((item) => item.text), ['primero', 'segundo']);
    assert.equal(store.cancelAll(), 2);
    assert.equal(store.list().length, 0);
    assert.equal(createReminders({ file, now: () => 1000, intervalMs: 0 }).start().pending, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('No molestar shows the bubble but keeps her quiet', () => {
  let spoken = 0;
  let shown = '';
  deliverReminder({
    line: 'Tu recordatorio.',
    noMolestar: true,
    speak: () => { spoken += 1; return true; },
    show: (text) => { shown = text; },
  });
  assert.equal(spoken, 0);
  assert.equal(shown, 'Tu recordatorio.');

  deliverReminder({
    line: 'Tu recordatorio.',
    noMolestar: false,
    speak: () => { spoken += 1; return true; },
    show: (text) => { shown = text; },
  });
  assert.equal(spoken, 1);
  assert.equal(shown, 'Tu recordatorio.');
});

test('a due reminder is spoken and shown once, never twice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-'));
  const file = path.join(dir, 'reminders.json');
  try {
    let now = 1000;
    const spoken = [];
    const shown = [];
    const store = createReminders({
      file,
      now: () => now,
      intervalMs: 0,
      fire: (item) => deliverReminder({
        line: `Recordatorio: ${item.text}`,
        speak: (text) => { spoken.push(text); return 1; },
        show: (text) => { shown.push(text); },
      }),
    });
    store.add({ at: 2000, text: 'sacar la basura' });
    now = 5000;
    store.tick();
    store.tick(); // the reminder is gone: no second bubble or voice
    assert.deepEqual(spoken, ['Recordatorio: sacar la basura']);
    assert.deepEqual(shown, ['Recordatorio: sacar la basura']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('voice disabled: the reminder is shown but not spoken', () => {
  let shown = '';
  const result = deliverReminder({
    line: 'Hora del té.',
    speak: () => 0, // ttsOn() is false: speakLine returns 0
    show: (text) => { shown = text; },
  });
  assert.equal(result.spoken, false);
  assert.equal(shown, 'Hora del té.');
});

test('a TTS failure never loses the bubble or breaks the scheduler', () => {
  let shown = '';
  const result = deliverReminder({
    line: 'Tomá agua.',
    speak: () => { throw new Error('voice sidecar died'); },
    show: (text) => { shown = text; },
  });
  assert.equal(result.spoken, false);
  assert.equal(shown, 'Tomá agua.');
});

test('overdue reminders at boot are one bubble and one voice line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-'));
  const file = path.join(dir, 'reminders.json');
  try {
    const before = createReminders({ file, now: () => 1000, intervalMs: 0 });
    before.add({ at: 4000, text: 'pagar la luz' });
    before.add({ at: 5000, text: 'sacar la basura' });
    const spoken = [];
    const shown = [];
    const store = createReminders({
      file,
      now: () => 10000,
      intervalMs: 0,
      fire: (item) => deliverReminder({
        line: `Se me pasaron ${item.count} cosas: ${item.text}`,
        speak: (text) => { spoken.push(text); return 1; },
        show: (text) => { shown.push(text); },
      }),
    });
    store.start();
    assert.equal(spoken.length, 1);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /pagar la luz/);
    assert.match(shown[0], /sacar la basura/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a skipped greeting leaves the missed reminder bubble alone', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /return \{ skipped: 'missed-reminders' \}/);

  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');
  const start = app.indexOf('const hello =');
  const hello = app.slice(start, app.indexOf('if (config.guide?.welcome)', start));
  assert.match(hello, /greet\?\.skipped/);
  assert.ok(hello.indexOf('greet?.skipped') < hello.indexOf('panel.say'),
    'the skipped check must come before the ONLINE fallback');
  // the normal greeting still shows her line, or the ONLINE fallback when there is none
  assert.match(hello, /greet\?\.text \|\| pick\(brain\.t\.online\)/);
});

test('a reminder phrasing the direct parser misses is noticed, not silently promised', () => {
  assert.equal(parseReminderCommand('en 3 minutos recordame sacar la basura'), null);
  assert.equal(readsAsReminderRequest('en 3 minutos recordame sacar la basura'), true);
  assert.equal(readsAsReminderRequest('dentro de una hora avisame de la reunión'), true);
  assert.equal(readsAsReminderRequest('¿cómo funcionan los recordatorios?'), false);
  assert.equal(readsAsReminderRequest('abre Discord'), false);
  assert.equal(promisesReminder('Listo, te aviso en 3 minutos.'), true);
  assert.equal(promisesReminder('Los recordatorios se guardan en un archivo.'), false);

  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /reminderAsked && promisesReminder/);
  assert.match(main, /No quedó agendado ningún recordatorio/);
});
