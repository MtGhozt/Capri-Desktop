'use strict';

// "Qué hay de nuevo" after an update, and on demand ("¿qué hay de nuevo?").

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NOTES, notesFor, bootNotes, isWhatsNewCommand } = require('../src/main/whats-new');

test('0.2.7 has 2–3 short lines, Gemini, identity and the reminder/voice corrections', () => {
  const lines = notesFor('0.2.7');
  assert.equal(Array.isArray(lines), true);
  assert.ok(lines.length >= 2 && lines.length <= 3);
  for (const line of lines) assert.ok(line.length < 120);
  const all = lines.join(' ');
  assert.match(all, /Gemini/);
  assert.match(all, /voz alta/i);
  assert.match(all, /modelo/i);
  assert.match(all, /desde la 0\.2\.6/);
  assert.match(all, /GPU compatible/);
});

test('0.2.6 has 2–3 short lines', () => {
  const lines = notesFor('0.2.6');
  assert.equal(Array.isArray(lines), true);
  assert.ok(lines.length >= 2 && lines.length <= 3);
  for (const line of lines) assert.ok(line.length < 120);
});

test('0.2.8 has 2–4 short lines about the screen look and voice install', () => {
  const lines = notesFor('0.2.8');
  assert.equal(Array.isArray(lines), true);
  assert.ok(lines.length >= 2 && lines.length <= 4);
  for (const line of lines) assert.ok(line.length < 120);
  const all = lines.join(' ');
  assert.match(all, /monitor/i);
  assert.match(all, /ventana/i);
  assert.match(all, /negro/i);
  assert.match(all, /disco/i);
  assert.match(all, /error real/i);
});

test('a version with no entry says nothing', () => {
  assert.equal(notesFor('0.2.3'), null);
  assert.equal(notesFor('v9.9.9'), null);
});

test('fresh install: no bubble, nothing seen yet', () => {
  assert.equal(bootNotes({ version: '0.2.4', lastSeenVersion: '' }), null);
  assert.equal(bootNotes({ version: '0.2.4' }), null);
  assert.equal(bootNotes({ version: '0.2.4', lastSeenVersion: '', configExisted: false }), null);
});

test('upgrade from before lastSeenVersion existed: config.json present, notes show once', () => {
  assert.deepEqual(
    bootNotes({ version: '0.2.4', lastSeenVersion: '', configExisted: true }),
    NOTES['0.2.4'],
  );
  // once lastSeenVersion is saved, the next boot stays quiet
  assert.equal(bootNotes({ version: '0.2.4', lastSeenVersion: '0.2.4', configExisted: true }), null);
});

test('upgrade: the new version lines, once', () => {
  assert.deepEqual(bootNotes({ version: '0.2.6', lastSeenVersion: '0.2.5' }), NOTES['0.2.6']);
  assert.equal(bootNotes({ version: '0.2.6', lastSeenVersion: '0.2.6' }), null);
});

test('an upgrade to a version without notes says nothing', () => {
  assert.equal(bootNotes({ version: '0.2.9', lastSeenVersion: '0.2.8' }), null);
});

test('"¿qué hay de nuevo?" is recognized, also with the wake word', () => {
  for (const text of [
    '¿qué hay de nuevo?',
    'que hay de nuevo',
    'Capri, ¿qué hay de nuevo en esta versión?',
    'novedades',
    'qué cambió',
    'qué trae la actualización',
  ]) {
    assert.equal(isWhatsNewCommand(text), true, text);
  }
  for (const text of ['nada nuevo', 'qué hora es', 'pon música', 'qué hay de comer']) {
    assert.equal(isWhatsNewCommand(text), false, text);
  }
});
