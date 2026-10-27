'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAppCommand, planAppCommand, matchApp, similarity, soundKey, describePlan, joinNames } = require('../src/main/app-command');
const { cleanApps } = require('../src/main/apps-config');
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
  const maybe = plan('abre Spotifeo');
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

test('the File Explorer by any of its names', () => {
  const { cleanApps } = require('../src/main/apps-config');
  const apps = cleanApps([...APPS, {
    name: 'Explorador de archivos', aliases: ['explorador', 'archivos', 'el explorador'],
    type: 'program', target: '%WINDIR%\\explorer.exe', windows: 'explorer',
  }]);
  for (const text of ['abre el explorador', 'abre el explorador de archivos', 'abre archivos', 'cierra el explorador']) {
    const p = planAppCommand(parseAppCommand(text, apps));
    assert.deepEqual(p?.apps?.map((a) => a.name), ['Explorador de archivos'], text);
  }
});

test('what Whisper does to the verb and the start of the line', () => {
  for (const text of [
    'Ok, abre Discord', 'Ahora, abre Discord', 'Y abre Discord', 'Ey Jarvis abre Discord', 'Ahora, ¿puedes abrir Discord?',
    'Abrel Discord', 'Ábrele el Discord.', 'Abra Discord', 'Ahora quiero que abras Discord', 'Abre, eh, Discord',
  ]) {
    const p = plan(text);
    assert.equal(p?.kind, 'do', text);
    assert.equal(p.action, 'open', text);
    assert.deepEqual(names(p), ['Discord'], text);
  }
  for (const text of ['Sierra Discord', 'Sierra, Discord', 'Cierre Discord']) {
    const p = plan(text);
    assert.equal(p?.action, 'close', text);
    assert.deepEqual(names(p), ['Discord'], text);
  }
  assert.equal(plan('sierra la puerta'), null);
  assert.equal(plan('cierra la puerta'), null);
  assert.equal(plan('abre la puerta'), null);
  assert.equal(plan('Sierra, la, puerta'), null);
  assert.deepEqual(names(plan('abre Discord, Spotify')), ['Discord', 'Spotify']); // a list stays a list
});

test('English game names the way a Spanish ear writes them', () => {
  const apps = cleanApps([
    { name: 'Hollow Knight', type: 'steam', target: '367520' },
    { name: 'Hollow Knight: Silksong', type: 'steam', target: '1030300' },
    { name: 'Terraria', type: 'steam', target: '105600' },
    { name: 'Slay the Spire', type: 'steam', target: '646570' },
    { name: 'Among Us', type: 'steam', target: '945360' },
    { name: 'Undertale', type: 'steam', target: '391540' },
    { name: 'Word', target: 'C:\\o\\word.lnk' },
    { name: 'Warp', target: 'C:\\w\\warp.exe' },
  ]);
  const said = (text) => planAppCommand(parseAppCommand(text, apps));
  assert.equal(soundKey('hollowknight'), soundKey('holunite'));
  assert.equal(soundKey('hollowknight'), soundKey('jolonait'));
  for (const text of ['abre Hollow Knight', 'abre Holunite', 'abre jolo nait', 'abre Holo Night', 'Sierra, Holunite']) {
    const p = said(text);
    assert.equal(p?.kind, 'do', text);
    assert.deepEqual(p.apps.map((a) => a.name), ['Hollow Knight'], text);
  }
  const unsure = said('Sierra, hola, Unite');
  assert.equal(unsure.kind, 'ask');
  assert.deepEqual(unsure.suggest.map((a) => a.name), ['Hollow Knight']);
  assert.deepEqual(said('abre Hollow Knight Silksong').apps.map((a) => a.name), ['Hollow Knight: Silksong']);
  assert.deepEqual(said('abre sley de spair').apps.map((a) => a.name), ['Slay the Spire']);
  assert.deepEqual(said('abre amongas').apps.map((a) => a.name), ['Among Us']);
  assert.deepEqual(said('abre Andertale').apps.map((a) => a.name), ['Undertale']);
  // short names never fuzz by sound: "Word" is not "Warp"
  assert.deepEqual(said('abre Word').apps.map((a) => a.name), ['Word']);
  assert.notDeepEqual(said('abre Wort')?.apps?.map((a) => a.name), ['Warp']);
});
