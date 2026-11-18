'use strict';

// Whisper often invents YouTube outros / Amara lines from noise — drop before a turn.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isSttHallucination, normalizeCommandText } = require('../src/main/command-text.js');

test('known Whisper hallucinations match the whole normalized utterance', () => {
  assert.equal(isSttHallucination('¡Suscríbete!'), true);
  assert.equal(isSttHallucination('Suscríbete al canal'), true);
  assert.equal(isSttHallucination('gracias por ver'), true);
  assert.equal(isSttHallucination('Gracias por ver el video'), true);
  assert.equal(isSttHallucination('Subtítulos realizados por la comunidad de Amara.org'), true);
  assert.equal(isSttHallucination('amara.org'), true);
  assert.equal(normalizeCommandText('amara.org'), 'amara org');
  assert.equal(normalizeCommandText('¡Suscríbete!'), 'suscribete');
});

test('real speech is not treated as a hallucination', () => {
  assert.equal(isSttHallucination('hola Capri'), false);
  assert.equal(isSttHallucination('gracias'), false); // real thank-you must pass through
  assert.equal(isSttHallucination('Capri, gracias'), false);
  assert.equal(isSttHallucination('gracias por ver'), true); // YouTube outro stays dropped
  assert.equal(isSttHallucination('gracias por avisar'), false);
  assert.equal(isSttHallucination('suscribete al canal de Capri por favor'), false);
  assert.equal(isSttHallucination('mirá mi pantalla'), false);
});

test('hearTranscript drops hallucinations before a turn', () => {
  const main = require('./main-source');
  assert.match(main, /isSttHallucination/);
  assert.match(main, /stt hallucination dropped:/);
  const from = main.indexOf('function hearTranscript');
  const body = main.slice(from, main.indexOf('\nfunction saveFix', from));
  assert.match(body, /isSttHallucination\(said\)/);
  assert.match(body, /missed: true/);
});
