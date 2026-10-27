'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAppCommand, planAppCommand, matchApp, similarity, describePlan, joinNames } = require('../src/main/app-command');
const { APPS } = require('./apps-fixture');

const plan = (text) => planAppCommand(parseAppCommand(text, APPS));
const names = (p) => p.apps.map((a) => a.name);

test('open verbs, with and without accents and pleasantries', () => {
  for (const text of [
    'abre Discord', 'Abrí Discord', 'ábreme discord', 'abrime el discord porfa', 'pon Discord', 'inicia Discord',
    'lanza discord', 'oye Capri, abre Discord', '¿puedes abrir Discord?', 'abre la app de Discord', 'ABRE DISCORD!!',
  ]) {
    const p = plan(text);
    assert.equal(p?.kind, 'do', text);
    assert.equal(p.action, 'open', text);
    assert.deepEqual(names(p), ['Discord'], text);
  }
});

test('close verbs', () => {
  for (const text of ['cierra Discord', 'cerrá Discord', 'ciérrame el Discord', 'cierra spoti', 'cerrar Namida']) {
    const p = plan(text);
    assert.equal(p?.kind, 'do', text);
    assert.equal(p.action, 'close', text);
  }
});

test('several targets at once', () => {
  assert.deepEqual(names(plan('abre Discord y Spotify')), ['Discord', 'Spotify']);
  assert.deepEqual(names(plan('Abre Discord, Spotify y YouTube')), ['Discord', 'Spotify', 'YouTube']);
  assert.deepEqual(names(plan('cierra namida y también steam')), ['Namida', 'Steam']);
});

test('aliases and names of more than one word', () => {
  assert.deepEqual(names(plan('abre el navegador')), ['Opera GX']);
  assert.deepEqual(names(plan('abre Opera GX')), ['Opera GX']);
  assert.deepEqual(names(plan('pon yutub')), ['YouTube']);
  assert.deepEqual(names(plan('abre gugel')), ['Google']);
});

test('page mode: "la página de X" / "X en el navegador"', () => {
  for (const text of ['abre la página de YouTube', 'abre YouTube en el navegador']) {
    const parsed = parseAppCommand(text, APPS);
    assert.ok(parsed?.page, text);
    assert.deepEqual(names(plan(text)), ['YouTube'], text);
  }
});

test('things that are not orders about her apps fall through to the model', () => {
  for (const text of [
    '¿qué app usas?', 'abrí Discord ayer', 'cierra los ojos', 'yo abrí discord', 'pon música de bad bunny',
    'abre discord y los ojos', 'abre tu corazón', 'cuéntame de Discord', 'discord', '', 'cierra la boca',
    'ayer cerré Spotify', 'pon atención',
  ]) {
    assert.equal(plan(text), null, text);
  }
});

test('an app she does not have, clearly named: she says so', () => {
  const p = plan('Abre Fortnite');
  assert.equal(p.kind, 'notFound');
  assert.deepEqual(p.missing, ['Fortnite']);
  assert.equal(plan('abre la app de Telegram').kind, 'notFound');
});

test('fuzzy: close enough acts, unsure asks, far is nothing', () => {
  assert.equal(matchApp(APPS, 'discor').status, 'sure'); // an alias
  assert.equal(matchApp(APPS, 'spotifi').app.name, 'Spotify');
  const maybe = plan('abre Spotifiii');
  assert.equal(maybe.kind, 'ask');
  assert.deepEqual(maybe.suggest.map((a) => a.name), ['Spotify']);
  assert.equal(matchApp(APPS, 'calculadora').status, 'none');
});

test('similarity ignores accents and case, and short words never fuzz', () => {
  assert.equal(similarity('Namidá', 'namida'), 1);
  assert.equal(similarity('ab', 'ac'), 0);
  assert.ok(similarity('steam', 'stean') > 0.7);
});

test('dry run in Spanish', () => {
  assert.match(describePlan(plan('abre Discord')), /Abriría Discord \(programa\)/);
  assert.match(describePlan(plan('cierra opera')), /Opera GX/);
  assert.match(describePlan(plan('cierra los ojos')), /modelo|nada|no es/i);
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B y C');
});
