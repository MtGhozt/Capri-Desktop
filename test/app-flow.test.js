'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAppFlow } = require('../src/main/app-flow');
const { APPS } = require('./apps-fixture');

function flow({ close = () => ({ status: 'closed', ids: [5] }), open = () => ({ ok: true }) } = {}) {
  const did = [];
  const logs = [];
  const f = createAppFlow({
    apps: () => APPS,
    actions: {
      open: async (app) => { did.push(['open', app.name]); return open(app); },
      close: async (app, mode) => { did.push(['close', app.name, mode]); return close(app, mode); },
    },
    line: (kind, values) => `${kind}${values.app || values.apps ? `:${values.app || values.apps}` : ''}`,
    log: (t) => logs.push(t),
  });
  return { f, did, logs };
}

test('a plain order does it and logs it', async () => {
  const { f, did, logs } = flow();
  assert.equal((await f.command('abre Discord y YouTube')).line, 'appAbrirVarias:Discord y YouTube');
  assert.deepEqual(did, [['open', 'Discord'], ['open', 'YouTube']]);
  assert.match(logs[0], /^app open Discord type=program ok$/);
  assert.equal(await f.command('cuéntame un chiste'), null);
});

test('"¿quisiste decir…?": yes does it, no cancels, anything else drops it', async () => {
  let { f, did } = flow();
  assert.equal((await f.command('abre Spotifiii')).line, 'appQuisiste:Spotify');
  assert.deepEqual(did, []);
  assert.equal((await f.answer('sí, dale')).line, 'appAbrir:Spotify');
  assert.deepEqual(did, [['open', 'Spotify']]);
  assert.equal(await f.answer('sí'), null); // already answered

  ({ f, did } = flow());
  await f.command('abre Spotifiii');
  assert.equal((await f.answer('no')).line, 'appCancelado');
  assert.deepEqual(did, []);

  ({ f, did } = flow());
  await f.command('abre Spotifiii');
  assert.equal(await f.answer('¿qué hora es?'), null);
  assert.equal(f.confirm.pending, null);
  assert.deepEqual(did, []);
});

test('close: "ask" apps ask first, and a graceful close that fails asks to force', async () => {
  let { f, did } = flow();
  assert.equal((await f.command('cierra opera')).line, 'appConfirmar:Opera GX');
  assert.deepEqual(did, []);
  assert.equal((await f.answer('dale')).line, 'appCerrar:Opera GX');
  assert.deepEqual(did, [['close', 'Opera GX', 'graceful']]);

  ({ f, did } = flow({ close: (app, mode) => ({ status: mode === 'force' ? 'closed' : 'stillRunning' }) }));
  assert.equal((await f.command('cierra Discord')).line, 'appForzar:Discord');
  assert.equal((await f.answer('sí')).line, 'appCerrar:Discord');
  assert.deepEqual(did, [['close', 'Discord', 'graceful'], ['close', 'Discord', 'force']]);
});

test('not running, denied, links, failures and unknown names', async () => {
  const { f } = flow({ close: (app) => ({ status: app.name === 'Namida' ? 'notRunning' : 'denied' }) });
  assert.equal((await f.command('cierra Namida')).line, 'appNoCorre:Namida');
  assert.equal((await f.command('cierra Steam')).line, 'appProhibido:Steam');
  assert.equal((await flow().f.command('Abre Fortnite')).line, 'appNoEncontrada:«Fortnite»');
  const bad = flow({ open: () => ({ ok: false, error: 'no existe el archivo' }) });
  assert.equal((await bad.f.command('abre Namida')).line, 'appFallo:Namida');
  assert.match(bad.logs[0], /failed: no existe el archivo/);
});

test('dry run does nothing', () => {
  const { f, did } = flow();
  assert.match(f.dryRun('abre Discord'), /Abriría Discord/);
  assert.match(f.dryRun(''), /abre Discord/);
  assert.deepEqual(did, []);
});

test('File Explorer windows that stay are not offered a forced close', async () => {
  const { cleanApps } = require('../src/main/apps-config');
  const did = [];
  const f = createAppFlow({
    apps: () => cleanApps([{ name: 'Explorador de archivos', aliases: ['explorador'], type: 'program', target: 'C:\\Windows\\explorer.exe', windows: 'explorer' }]),
    actions: { open: async () => ({ ok: true }), close: async (app, mode) => { did.push(mode); return { status: 'stillRunning' }; } },
    line: (kind) => kind,
  });
  assert.equal((await f.command('cierra el explorador')).line, 'appFallo');
  assert.equal(f.confirm.pending, null);
  assert.deepEqual(did, ['graceful']);
});
