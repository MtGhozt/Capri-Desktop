'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseMusicCommand } = require('../src/main/music-command');
const { createMusic, KEY_SCRIPT, unpackedPath } = require('../src/main/music');
const { readTranscript } = require('../src/main/fix-command');

// a transcript as Whisper wrote it, through her fixes, the parser and the player
async function route(said, {
  cfg = { music: { player: 'namida' } }, running = true, spotify = null, volumeOk = true,
} = {}) {
  const keys = [];
  const volumes = [];
  const spawned = [];
  const music = createMusic({
    config: { load: () => cfg },
    apps: () => [{ name: 'Namida', target: 'C:\\Software\\Namida\\namida\\namida.exe' }],
    sendKey: async (action, script) => { keys.push({ action, script }); },
    sendVolume: async (action, processNames, script) => {
      volumes.push({ action, processNames, script });
      if (!volumeOk) throw new Error('no music session');
    },
    spotify,
    isRunning: async () => running,
    spawnProcess: (target) => { spawned.push(target); return { unref() {} }; },
    wait: async () => {},
  });
  const parsed = parseMusicCommand(readTranscript(said, []).text);
  const result = parsed ? await music.command(parsed) : null;
  return {
    parsed, result,
    keys: keys.map((k) => k.action),
    scripts: keys.map((k) => k.script),
    volumes,
    spawned,
  };
}

test('real Whisper transcripts reach the media keys', async () => {
  const cases = [
    ['Despauza la canción', 'play', ['play']],
    ['Despausa', 'play', ['play']],
    ['Despausa la música', 'play', ['play']],
    ['Sigue.', 'play', ['play']],
    ['Reanuda la música', 'play', ['play']],
    ['Continúa la música', 'play', ['play']],
    ['Siguiente canción', 'next', ['next']],
    ['Siguiente cancion', 'next', ['next']],
    ['Anterior canción', 'previous', ['previous', 'previous']],
    ['Pasa a la siguiente', 'next', ['next']],
    ['Capri, siguiente.', 'next', ['next']],
    ['La anterior', 'previous', ['previous', 'previous']],
    ['Pausa la música', 'pause', ['pause']],
    ['Pon la música en pausa', 'pause', ['pause']],
    ['Pausa.', 'pause', ['pause']],
  ];
  for (const [said, action, keys] of cases) {
    const r = await route(said);
    assert.equal(r.parsed?.action, action, said);
    assert.equal(r.result.ok, true, said);
    assert.deepEqual(r.keys, keys, said);
    assert.deepEqual(r.volumes, [], said);
  }
});

test('volume/mute hit the music session, never master media keys', async () => {
  const { VOLUME_SCRIPT } = require('../src/main/music');
  const cases = [
    ['Silencia la música', 'mute'],
    ['sube el volumen', 'volumeUp'],
    ['baja el volumen', 'volumeDown'],
    ['quita el silencio', 'unmute'],
  ];
  for (const [said, action] of cases) {
    const r = await route(said);
    assert.equal(r.parsed?.action, action, said);
    assert.equal(r.result.ok, true, said);
    assert.deepEqual(r.keys, [], said); // no VK_VOLUME_* 
    assert.equal(r.volumes.length, 1, said);
    assert.equal(r.volumes[0].action, action, said);
    assert.deepEqual(r.volumes[0].processNames, ['namida', 'Namida'], said);
    assert.equal(r.volumes[0].script, VOLUME_SCRIPT, said);
  }
});

test('volume uses Spotify API when that player is connected', async () => {
  const calls = [];
  const r = await route('sube el volumen', {
    cfg: { music: { player: 'spotify' } },
    spotify: {
      volume: async (action) => { calls.push(action); return { ok: true, player: 'spotify', volume: 60 }; },
    },
  });
  assert.equal(r.result.ok, true);
  assert.deepEqual(calls, ['volumeUp']);
  assert.deepEqual(r.volumes, []); // API handled it
  assert.deepEqual(r.keys, []);
});

test('volume with no music session says so playfully', async () => {
  const r = await route('silencio', { volumeOk: false });
  assert.equal(r.result.ok, false);
  assert.match(r.result.error, /reproductor de música/i);
  assert.deepEqual(r.keys, []);
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

test('pon música hands Namida a queue playlist (no play-toggle key)', async () => {
  const playlists = [];
  const keys = [];
  const spawned = [];
  const music = createMusic({
    config: { load: () => ({ music: { player: 'namida' } }) },
    apps: () => [{ name: 'Namida', target: 'C:\\Software\\Namida\\namida\\namida.exe' }],
    sendKey: async (action) => { keys.push(action); },
    isRunning: async () => false,
    spawnProcess: (target, args = []) => { spawned.push([target, ...args]); return { unref() {} }; },
    wait: async () => {},
    listFiles: () => ['C:\\lib\\a.mp3', 'C:\\lib\\b.mp3', 'C:\\lib\\c.mp3'],
    writePlaylist: (paths) => {
      playlists.push(paths.slice());
      return 'C:\\Temp\\capri-queue.m3u';
    },
  });
  const r = await music.command(parseMusicCommand('Pon música'));
  assert.equal(r.ok, true);
  assert.equal(r.queue, true);
  assert.deepEqual(keys, [], 'play key would toggle Namida into pause');
  assert.deepEqual(spawned, [['C:\\Software\\Namida\\namida\\namida.exe', 'C:\\Temp\\capri-queue.m3u']]);
  assert.equal(playlists[0].length, 3);
});

test('pon <song> leads a Namida queue with that track', async () => {
  const spawned = [];
  const music = createMusic({
    config: { load: () => ({ music: { player: 'namida' } }) },
    apps: () => [{ name: 'Namida', target: 'C:\\Namida\\namida.exe' }],
    sendKey: async () => {},
    isRunning: async () => true,
    spawnProcess: (t, args = []) => { spawned.push([t, ...args]); return { unref() {} }; },
    wait: async () => {},
    findTrack: () => ({ path: 'C:\\lib\\song.mp3', title: 'song', artist: '', score: 100 }),
    listFiles: () => ['C:\\lib\\song.mp3', 'C:\\lib\\other.mp3'],
    writePlaylist: (paths) => {
      assert.equal(paths[0], 'C:\\lib\\song.mp3');
      return 'C:\\Temp\\capri-song.m3u';
    },
  });
  const r = await music.command({ action: 'query', query: 'song' });
  assert.equal(r.ok, true);
  assert.equal(r.queue, true);
  assert.deepEqual(spawned, [['C:\\Namida\\namida.exe', 'C:\\Temp\\capri-song.m3u']]);
});

test('Spotify free start falls back to media keys', async () => {
  const keys = [];
  const opened = [];
  const music = createMusic({
    config: { load: () => ({ music: { player: 'spotify' } }) },
    apps: () => [],
    sendKey: async (action) => { keys.push(action); },
    wait: async () => {},
    openExternal: async (uri) => { opened.push(uri); },
    spotify: {
      resume: async (openApp) => { await openApp(); return { ok: true, opened: true }; },
    },
  });
  const r = await music.command({ action: 'start' });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'media-keys');
  assert.equal(r.freeHint, true);
  assert.deepEqual(opened, ['spotify:']);
  assert.deepEqual(keys, ['play']);
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
    spawnProcess: (target, args = []) => { out.spawned.push([target, ...args]); return { unref() {} }; },
    wait: async () => {},
    openExternal: async (uri) => { out.opened.push(uri); },
    findTrack: () => null,
    listFiles: () => [], // no real library: fall back to bare open + play key
    writePlaylist: () => null,
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
  // No library in the harness → open exe + play key as last resort
  assert.equal((await namida.music.command({ action: 'start' })).ok, true);
  assert.deepEqual(namida.spawned, [[NAMIDA_EXE]]);
  assert.deepEqual(namida.keys, ['play']);

  const premium = playerHarness({ player: 'spotify', connected: true });
  assert.equal((await premium.music.command({ action: 'start' })).ok, true);
  assert.equal(premium.resumed.length, 1);
  assert.deepEqual([premium.keys, premium.opened], [[], []]);

  const free = playerHarness({ player: 'spotify', resumeOk: false }); // 403 → media keys
  const freeR = await free.music.command({ action: 'start' });
  assert.equal(freeR.ok, true);
  assert.equal(freeR.via, 'media-keys');
  assert.deepEqual([free.keys, free.opened], [['play'], ['spotify:']]);

  const offline = playerHarness({ player: 'spotify', connected: false }); // not connected
  const offR = await offline.music.command({ action: 'start' });
  assert.equal(offR.ok, true);
  assert.equal(offR.via, 'media-keys');
  assert.deepEqual([offline.keys, offline.opened], [['play'], ['spotify:']]);

  const none = playerHarness({ player: 'none' });
  const r = await none.music.command({ action: 'start' });
  assert.equal(r.ok, false);
  assert.match(r.error, /MÚSICA/);
  assert.deepEqual([none.keys, none.opened, none.spawned], [[], [], []]);
});
