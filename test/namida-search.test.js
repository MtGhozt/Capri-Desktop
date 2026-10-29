'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { findNamidaTrack, scorePath, tokens } = require('../src/main/namida-search');
const { parseMusicCommand } = require('../src/main/music-command');
const { createMusic } = require('../src/main/music');

test('play / pon song phrases become query commands', () => {
  assert.deepEqual(parseMusicCommand('pon bohemian rhapsody'), { action: 'query', query: 'bohemian rhapsody' });
  assert.deepEqual(parseMusicCommand('ponme neon de genesis'), { action: 'query', query: 'neon de genesis' });
  assert.deepEqual(parseMusicCommand('play never gonna give you up'), { action: 'query', query: 'never gonna give you up' });
  assert.deepEqual(parseMusicCommand('reproduce nights en spotify'), {
    action: 'query', query: 'nights', player: 'spotify',
  });
});

test('filename scoring prefers full token matches', () => {
  const q = tokens('toby fox door');
  assert.ok(scorePath('C:\\x\\05 - The Door - Toby Fox.flac', q) >
    scorePath('C:\\x\\random-song.mp3', q));
});

test('namida search picks the best local file', () => {
  const files = [
    path.join('C:', 'lib', 'random.mp3'),
    path.join('C:', 'lib', '05 - The Door - Toby Fox.flac'),
    path.join('C:', 'lib', 'other.mp3'),
  ];
  const hit = findNamidaTrack('the door toby', {
    dirs: ['C:\\lib'],
    listFiles: (_dir, out) => { out.push(...files); },
  });
  assert.ok(hit);
  assert.match(hit.path, /The Door/);
  assert.equal(hit.title, 'The Door');
});

test('query uses preferred player then falls back', async () => {
  const opened = [];
  const spawned = [];
  const music = createMusic({
    config: { load: () => ({ music: { player: 'spotify' } }) },
    apps: () => [{ name: 'Namida', target: 'C:\\Namida\\namida.exe' }],
    spotify: { playQuery: async () => ({ ok: false, fallback: true }) },
    openExternal: async (url) => { opened.push(url); },
    findTrack: () => null,
    sendKey: async () => {},
    isRunning: async () => true,
    spawnProcess: (t, args) => { spawned.push([t, args]); return { unref() {} }; },
    wait: async () => {},
  });
  const r = await music.command({ action: 'query', query: 'nights' });
  assert.equal(r.ok, true);
  assert.equal(r.searchOnly, true);
  assert.deepEqual(opened, ['spotify:search:nights']);
});

test('namida query launches the matched file', async () => {
  const spawned = [];
  const music = createMusic({
    config: { load: () => ({ music: { player: 'namida' } }) },
    apps: () => [{ name: 'Namida', target: 'C:\\Namida\\namida.exe' }],
    spotify: { playQuery: async () => ({ ok: false, fallback: true }) },
    openExternal: async () => {},
    findTrack: () => ({ path: 'C:\\lib\\song.mp3', title: 'song', artist: '' }),
    sendKey: async () => {},
    isRunning: async () => true,
    spawnProcess: (t, args) => { spawned.push([t, ...args]); return { unref() {} }; },
    wait: async () => {},
  });
  const r = await music.command({ action: 'query', query: 'song' });
  assert.equal(r.ok, true);
  assert.equal(r.player, 'namida');
  assert.equal(r.track, 'song');
  assert.ok(spawned.some((row) => row[0] === 'C:\\Namida\\namida.exe' && row[1] === 'C:\\lib\\song.mp3'));
});

test('opening a song never sends the play key (Namida already started it)', async () => {
  const keys = [];
  const lines = [];
  const music = createMusic({
    config: { load: () => ({ music: { player: 'namida' } }) },
    apps: () => [{ name: 'Namida', target: 'C:\\Namida\\namida.exe' }],
    spotify: { playQuery: async () => ({ ok: false, fallback: true }) },
    openExternal: async () => {},
    findTrack: () => ({ path: 'C:\\lib\\My Alcoholic Friends.mp3', title: 'My Alcoholic Friends', artist: '', score: 1230 }),
    sendKey: async (action) => { keys.push(action); },
    isRunning: async () => true,
    spawnProcess: () => ({ unref() {} }),
    wait: async () => {},
    log: (text) => lines.push(text),
  });
  const r = await music.command({ action: 'query', query: 'alcoholic friends' });
  assert.equal(r.ok, true);
  assert.deepEqual(keys, []);
  assert.deepEqual(lines, ['namida match: My Alcoholic Friends score=1230']);
});

test('"mi alcoholic friends" finds the song and nothing else', () => {
  const files = [
    path.join('C:', 'lib', 'My Alcoholic Friends.mp3'),
    path.join('C:', 'lib', 'Limit Break.mp3'),
    path.join('C:', 'lib', 'Mi Gente.mp3'),
  ];
  const search = (query) => findNamidaTrack(query, {
    dirs: ['C:\\lib'],
    listFiles: (_dir, out) => { out.push(...files); },
  });
  const hit = search('mi alcoholic friends');
  assert.ok(hit, 'should find the song');
  assert.equal(hit.title, 'My Alcoholic Friends');
  assert.equal(search('bohemian rhapsody'), null); // "mi" used to match Limit Break
});
