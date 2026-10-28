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
    ['Pasa a la siguiente', 'next', ['next']],
    ['Capri, siguiente.', 'next', ['next']],
    ['La anterior', 'previous', ['previous']],
    ['Pausa la música', 'pause', ['pause']],
    ['Pausa.', 'pause', ['pause']],
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

test('a song search she cannot do is reported, not faked', async () => {
  const r = await route('Pon my alcoholic friends');
  assert.equal(r.parsed.action, 'query');
  assert.equal(r.result.ok, false);
  assert.match(r.result.error, /Todavía no sé buscar/);
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
