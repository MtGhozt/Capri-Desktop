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
  assert.deepEqual(parseReminderCommand('cancelá el recordatorio'), { action: 'cancel', all: false });
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
