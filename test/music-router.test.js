'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseMusicCommand } = require('../src/main/music-command');
const { createMusic, KEY_SCRIPT, unpackedPath } = require('../src/main/music');
const { readTranscript } = require('../src/main/fix-command');

// a transcript as Whisper wrote it, through her fixes, the parser and the player
async function route(said, { cfg = { music: { player: 'namida' } }, running = true } = {}) {
  const keys = [];
  const spawned = [];
  const music = createMusic({
    config: { load: () => cfg },
    apps: () => [{ name: 'Namida', target: 'C:\\Software\\Namida\\namida\\namida.exe' }],
    sendKey: async (action, script) => { keys.push({ action, script }); },
    isRunning: async () => running,
    spawnProcess: (target) => { spawned.push(target); return { unref() {} }; },
    wait: async () => {},
  });
  const parsed = parseMusicCommand(readTranscript(said, []).text);
  const result = parsed ? await music.command(parsed) : null;
  return { parsed, result, keys: keys.map((k) => k.action), scripts: keys.map((k) => k.script), spawned };
}

test('real Whisper transcripts reach the media keys', async () => {
  const cases = [
    ['Reproduce música', 'start', ['play']],
    ['Pon música', 'start', ['play']],
    ['Ponme música, por favor.', 'start', ['play']],
    ['pon musica', 'start', ['play']],
    ['Despauza la canción', 'play', ['play']],
    ['Despausa', 'play', ['play']],
    ['Sigue.', 'play', ['play']],
    ['Reanuda la música', 'play', ['play']],
    ['Siguiente canción', 'next', ['next']],
    ['Siguiente cancion', 'next', ['next']],
    ['Anterior canción', 'previous', ['previous', 'previous']],
    ['Pasa a la siguiente', 'next', ['next']],
    ['Capri, siguiente.', 'next', ['next']],
    ['La anterior', 'previous', ['previous', 'previous']],
    ['Pausa la música', 'pause', ['pause']],
    ['Pausa.', 'pause', ['pause']],
    ['Silencia la música', 'mute', ['mute']],
    ['sube la música, sube el volumen', 'volumeUp', ['volumeUp', 'volumeUp', 'volumeUp', 'volumeUp', 'volumeUp']],
  ];
  for (const [said, action, keys] of cases) {
    const r = await route(said);
    assert.equal(r.parsed?.action, action, said);
    assert.equal(r.result.ok, true, said);
    assert.deepEqual(r.keys, keys, said);
  }
});

test('ordinary phrases stay with the model', async () => {
  for (const said of ['la siguiente pregunta', 'Hola Capri, cómo estás?', 'sigue contándome', 'pon un timer de 5 minutos']) {
    assert.equal((await route(said)).parsed, null, said);
  }
});

test('a song search with no local hit is reported, not faked', async () => {
  const r = await route('Pon zzznombrequecasidseguroenoexiste999');
  assert.equal(r.parsed.action, 'query');
  assert.equal(r.result.ok, false);
  assert.match(r.result.error, /No encontr/);
  assert.deepEqual(r.keys, []);
});

test('pon música opens Namida first when it is closed', async () => {
  const r = await route('Pon música', { running: false });
  assert.deepEqual(r.spawned, ['C:\\Software\\Namida\\namida\\namida.exe']);
  assert.deepEqual(r.keys, ['play']);
});

test('the media key script is read from outside app.asar', () => {
  assert.equal(path.basename(KEY_SCRIPT), 'media-keys.ps1');
  const packed = path.join('C:', 'Capri', 'resources', 'app.asar', 'src', 'main', 'media-keys.ps1');
  assert.equal(unpackedPath(packed), path.join('C:', 'Capri', 'resources', 'app.asar.unpacked', 'src', 'main', 'media-keys.ps1'));
});

// "abre el reproductor de música" / "pon música": whichever player MÚSICA has chosen
const NAMIDA_EXE = 'C:\\Software\\Namida\\namida\\namida.exe';
function playerHarness({ player, connected = true, resumeOk = true, namida = true } = {}) {
  const out = { spawned: [], opened: [], keys: [], resumed: [] };
  const music = createMusic({
    config: { load: () => ({ music: { player } }) },
    apps: () => (namida ? [{ name: 'Namida', target: NAMIDA_EXE }] : []),
    sendKey: async (action) => { out.keys.push(action); },
    isRunning: async () => true,
    spawnProcess: (target, args) => { out.spawned.push([target, ...args]); return { unref() {} }; },
    wait: async () => {},
    openExternal: async (uri) => { out.opened.push(uri); },
    findTrack: () => null,
    spotify: {
      playQuery: async () => ({ ok: false, fallback: true }),
      resume: async (openApp) => {
        out.resumed.push('resume');
        if (!connected) return { ok: false, fallback: true };
        if (!resumeOk) { await openApp(); return { ok: true, opened: true }; }
        return { ok: true };
      },
    },
  });
  return { music, ...out };
}

test('"abre el reproductor de música" is a music order, not an app one', () => {
  for (const said of ['abre el reproductor de música', 'Abre la música', 'abrime el reproductor', 'open the music player', 'open music']) {
    assert.deepEqual(parseMusicCommand(said), { action: 'open' }, said);
  }
  assert.equal(parseMusicCommand('abre Spotify'), null); // that one stays with the app table
});

test('opening the player follows MÚSICA', async () => {
  const namida = playerHarness({ player: 'namida' });
  assert.deepEqual(await namida.music.command({ action: 'open' }), { ok: true, player: 'namida' });
  assert.deepEqual(namida.spawned, [[NAMIDA_EXE]]);

  const spotify = playerHarness({ player: 'spotify' });
  assert.deepEqual(await spotify.music.command({ action: 'open' }), { ok: true, player: 'spotify' });
  assert.deepEqual(spotify.opened, ['spotify:']);

  const none = playerHarness({ player: 'none' });
  const r = await none.music.command({ action: 'open' });
  assert.equal(r.ok, false);
  assert.match(r.error, /MÚSICA/);
  assert.deepEqual([none.spawned, none.opened], [[], []]);

  const noNamida = playerHarness({ player: 'namida', namida: false });
  assert.match((await noNamida.music.command({ action: 'open' })).error, /Namida/);
});

test('"pon música" plays in the chosen player, never a stray media key', async () => {
  const namida = playerHarness({ player: 'namida' });
  assert.equal((await namida.music.command({ action: 'start' })).ok, true);
  assert.deepEqual(namida.spawned, [[NAMIDA_EXE]]); // brought up (single instance) before the key
  assert.deepEqual(namida.keys, ['play']);

  const premium = playerHarness({ player: 'spotify', connected: true });
  assert.equal((await premium.music.command({ action: 'start' })).ok, true);
  assert.equal(premium.resumed.length, 1);
  assert.deepEqual([premium.keys, premium.opened], [[], []]);

  const free = playerHarness({ player: 'spotify', resumeOk: false }); // 403: the app is opened instead
  assert.equal((await free.music.command({ action: 'start' })).ok, true);
  assert.deepEqual([free.keys, free.opened], [[], ['spotify:']]);

  const offline = playerHarness({ player: 'spotify', connected: false }); // not connected
  assert.equal((await offline.music.command({ action: 'start' })).ok, true);
  assert.deepEqual([offline.keys, offline.opened], [[], ['spotify:']]);

  const none = playerHarness({ player: 'none' });
  const r = await none.music.command({ action: 'start' });
  assert.equal(r.ok, false);
  assert.match(r.error, /MÚSICA/);
  assert.deepEqual([none.keys, none.opened, none.spawned], [[], [], []]);
});
