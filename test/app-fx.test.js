'use strict';

// Paso 4E: her zap before a close and her spark after an open. The close waits for the zap to
// hit, never more than the cap, and not at all when the effects are off; they never get in the
// way of opening or closing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAppFx, CAP_MS } = require('../src/main/app-fx');
const { createAppActions } = require('../src/main/app-actions');

test('the zap goes to the overlay and resolves when it hits', async () => {
  const sent = [];
  const fx = createAppFx({ send: (p) => sent.push(p), toOverlay: (r) => ({ ...r, x: r.x - 100 }) });
  const done = fx.zap({ x: 300, y: 50, w: 800, h: 600 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'zap');
  assert.deepEqual(sent[0].rect, { x: 200, y: 50, w: 800, h: 600 });
  fx.hit(sent[0].id);
  assert.equal(await done, true);
  assert.equal(fx.pending(), 0);
});

test('no answer from the overlay: the close goes on at the cap', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fx = createAppFx({ send: () => {} });
  let result = null;
  fx.zap(null).then((v) => { result = v; });
  assert.equal(CAP_MS, 1200);
  t.mock.timers.tick(CAP_MS);
  return Promise.resolve().then(() => {
    assert.equal(result, false);
    assert.equal(fx.pending(), 0);
  });
});

test('off (her menu, a game up): nothing sent, nothing waited for', async () => {
  const sent = [];
  const fx = createAppFx({ send: (p) => sent.push(p), enabled: () => false });
  assert.equal(await fx.zap({ x: 0, y: 0, w: 10, h: 10 }), false);
  assert.equal(fx.spark({ name: 'Discord' }), false);
  assert.deepEqual(sent, []);
});

test('a window off her screen or a bad rect: she zaps without one (the taskbar)', async () => {
  const sent = [];
  const fx = createAppFx({ send: (p) => sent.push(p), toOverlay: () => { throw new Error('no screen'); } });
  const done = fx.zap({ x: 1, y: 2, w: 3, h: 4 });
  assert.equal(sent[0].rect, null);
  fx.hit(sent[0].id);
  assert.equal(await done, true);
});

test('a send that throws never holds up the close', async () => {
  const fx = createAppFx({ send: () => { throw new Error('overlay gone'); } });
  assert.equal(await fx.zap(null), true);
});

function fakeDeps(calls, { running = [101], rect = { x: 10, y: 20, w: 300, h: 200 }, zap } = {}) {
  return {
    env: {},
    exists: () => true,
    spawn: async () => calls.push(['spawn']),
    openExternal: async () => calls.push(['url']),
    openPath: async () => '',
    probe: async () => { calls.push(['probe']); return { ids: running, names: ['Discord'], rect }; },
    graceful: async () => { calls.push(['graceful']); return { ids: running, left: 0 }; },
    kill: async () => calls.push(['kill']),
    explorerWindows: async (close) => { calls.push([close ? 'explorer-close' : 'explorer-probe']); return { left: close ? 0 : 1, rect }; },
    skipPids: () => [],
    zap: zap || (async (r) => calls.push(['zap', r])),
    spark: (app) => calls.push(['spark', app.name]),
  };
}

test('the zap comes after finding the window and before closing it', async () => {
  let calls = [];
  const actions = createAppActions(fakeDeps(calls));
  await actions.close({ name: 'Discord', processes: ['Discord'] }, 'graceful');
  assert.deepEqual(calls.map((c) => c[0]), ['probe', 'zap', 'graceful']);
  assert.deepEqual(calls[1][1], { x: 10, y: 20, w: 300, h: 200 });

  calls = [];
  await createAppActions(fakeDeps(calls)).close({ name: 'Discord', processes: ['Discord'] }, 'force');
  assert.deepEqual(calls.map((c) => c[0]), ['probe', 'zap', 'kill', 'probe']);

  calls = [];
  await createAppActions(fakeDeps(calls)).close({ name: 'Explorador', windows: 'explorer' });
  assert.deepEqual(calls.map((c) => c[0]), ['explorer-probe', 'zap', 'explorer-close']);
});

test('no zap when there is nothing to close or it is refused', async () => {
  let calls = [];
  await createAppActions(fakeDeps(calls, { running: [] })).close({ name: 'Discord', processes: ['Discord'] }, 'graceful');
  assert.ok(!calls.some((c) => c[0] === 'zap'));
  calls = [];
  await createAppActions(fakeDeps(calls)).close({ name: 'X', processes: ['explorer'] }, 'force');
  assert.deepEqual(calls, []);
});

test('a zap that fails still closes', async () => {
  const calls = [];
  const deps = fakeDeps(calls, { zap: async () => { throw new Error('boom'); } });
  const res = await createAppActions(deps).close({ name: 'Discord', processes: ['Discord'] }, 'graceful');
  assert.equal(res.status, 'closed');
});

test('the spark only for an app that really opened', async () => {
  let calls = [];
  await createAppActions(fakeDeps(calls)).open({ name: 'YouTube', type: 'link', target: 'https://www.youtube.com' });
  assert.deepEqual(calls, [['url'], ['spark', 'YouTube']]);
  calls = [];
  const res = await createAppActions(fakeDeps(calls)).open({ name: 'Mal', type: 'steam', target: 'abc' });
  assert.equal(res.ok, false);
  assert.ok(!calls.some((c) => c[0] === 'spark'));
});

test('apps start through cmd start, so closing her never takes them with her', () => {
  const { startLine } = require('../src/main/app-host');
  assert.equal(
    startLine('C:\\Software\\Grok\\Grok Bot\\Grok Bot.exe', [], 'C:\\Software\\Grok\\Grok Bot'),
    '/d /s /c "start "" /d "C:\\Software\\Grok\\Grok Bot" "C:\\Software\\Grok\\Grok Bot\\Grok Bot.exe""',
  );
  assert.equal(startLine('C:\\S\\steam.exe', ['-applaunch', '367520']), '/d /s /c "start "" "C:\\S\\steam.exe" "-applaunch" "367520""');
  // what cmd could misread: started directly instead
  assert.equal(startLine('C:\\a%PATH%\\x.exe'), null);
  assert.equal(startLine('C:\\x.exe', ['say "hi"']), null);
  assert.equal(startLine(''), null);
});
