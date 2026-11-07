'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseReminderCommand, formatWhen, deliverReminder, createReminders,
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
