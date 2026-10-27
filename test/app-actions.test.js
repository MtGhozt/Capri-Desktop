'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isProtected, createAppActions } = require('../src/main/app-actions');

function fake({ running = [101], afterGraceful = 0, afterKill = [], files = [] } = {}) {
  const calls = [];
  let killed = false;
  const deps = {
    env: { LOCALAPPDATA: 'L' },
    exists: (p) => files.includes(p),
    spawn: async (file, args, opts) => calls.push(['spawn', file, args, opts.cwd]),
    openExternal: async (url) => calls.push(['url', url]),
    openPath: async (p) => { calls.push(['path', p]); return ''; },
    probe: async (names, skip) => { calls.push(['probe', names, skip]); return { ids: killed ? afterKill : running }; },
    graceful: async (names, skip) => { calls.push(['graceful', names, skip]); return { ids: running, left: afterGraceful }; },
    kill: async (ids) => { killed = true; calls.push(['kill', ids]); },
    skipPids: () => [999, 0, 'x'],
  };
  return { deps, calls };
}

test('never closes her, Windows, the voice sidecar or LM Studio', () => {
  for (const n of ['Capri', 'Capri.exe', 'explorer', 'dwm', 'csrss', 'winlogon', 'svchost', 'python', 'pythonw.exe', 'LM Studio', 'lms', 'lm-studio-helper']) {
    assert.ok(isProtected(n), n);
  }
  for (const n of ['Discord', 'notepad', 'opera', 'Spotify']) assert.ok(!isProtected(n), n);
});

test('a protected process is refused before anything runs', async () => {
  const { deps, calls } = fake();
  const res = await createAppActions(deps).close({ name: 'X', processes: ['explorer'] }, 'force');
  assert.equal(res.status, 'denied');
  assert.deepEqual(calls, []);
});

test('graceful, force, not running, not closeable', async () => {
  let f = fake();
  let res = await createAppActions(f.deps).close({ name: 'Discord', processes: ['Discord'] }, 'graceful');
  assert.equal(res.status, 'closed');
  assert.deepEqual(f.calls.map((c) => c[0]), ['probe', 'graceful']);
  assert.deepEqual(f.calls[1][2], [999]); // her own pid is skipped, junk dropped

  f = fake({ afterGraceful: 1 });
  res = await createAppActions(f.deps).close({ name: 'Discord', processes: ['Discord'] }, 'graceful');
  assert.equal(res.status, 'stillRunning');

  f = fake();
  res = await createAppActions(f.deps).close({ name: 'Discord', processes: ['Discord'] }, 'force');
  assert.equal(res.status, 'closed');
  assert.deepEqual(f.calls.map((c) => c[0]), ['probe', 'kill', 'probe']);
  assert.deepEqual(f.calls[1][1], [101]);

  f = fake({ afterKill: [101] });
  res = await createAppActions(f.deps).close({ name: 'Discord', processes: ['Discord'] }, 'force');
  assert.equal(res.status, 'stillRunning');

  f = fake({ running: [] });
  res = await createAppActions(f.deps).close({ name: 'Discord', processes: ['Discord'] }, 'force');
  assert.equal(res.status, 'notRunning');
  assert.ok(!f.calls.some((c) => c[0] === 'kill'));

  f = fake();
  res = await createAppActions(f.deps).close({ name: 'YouTube', processes: [] });
  assert.equal(res.status, 'notCloseable');

  f = fake();
  f.deps.probe = async () => { throw new Error('boom'); };
  res = await createAppActions(f.deps).close({ name: 'Discord', processes: ['Discord'] }, 'graceful');
  assert.equal(res.status, 'failed');
});

test('opening programs, shortcuts, links and Steam games', async () => {
  const f = fake({ files: ['L\\Discord\\Update.exe', 'C:\\x\\Namida.lnk'] });
  const actions = createAppActions(f.deps);
  assert.ok((await actions.open({ type: 'program', target: '%LOCALAPPDATA%\\Discord\\Update.exe', args: '--processStart Discord.exe' })).ok);
  assert.deepEqual(f.calls[0], ['spawn', 'L\\Discord\\Update.exe', ['--processStart', 'Discord.exe'], 'L\\Discord']);
  assert.ok((await actions.open({ type: 'program', target: 'C:\\x\\Namida.lnk' })).ok);
  assert.deepEqual(f.calls[1], ['path', 'C:\\x\\Namida.lnk']);
  assert.ok((await actions.open({ type: 'link', target: 'https://www.youtube.com' })).ok);
  assert.ok((await actions.open({ type: 'steam', target: '730' })).ok);
  assert.deepEqual(f.calls[3], ['url', 'steam://rungameid/730']);
  assert.equal((await actions.open({ type: 'program', target: 'C:\\nope.exe' })).ok, false);
  assert.equal((await actions.open({ type: 'link', target: 'javascript:alert(1)' })).ok, false);
  assert.equal((await actions.open({ type: 'steam', target: '1; calc' })).ok, false);
  assert.equal(f.calls.length, 4);
});

test('File Explorer: only its windows close, explorer.exe is never probed or killed', async () => {
  const f = fake();
  let windows = 2;
  f.deps.explorerWindows = async (close) => {
    f.calls.push(['explorer', close]);
    if (close) windows = 0;
    return { left: windows };
  };
  const actions = createAppActions(f.deps);
  const explorer = { name: 'Explorador de archivos', processes: [], windows: 'explorer' };
  assert.equal((await actions.close(explorer, 'force')).status, 'closed');
  assert.deepEqual(f.calls, [['explorer', false], ['explorer', true]]);
  assert.equal((await actions.close(explorer, 'graceful')).status, 'notRunning');
  assert.ok(!f.calls.some((c) => c[0] === 'kill' || c[0] === 'probe'));
  // the same app without the windows mark is refused by the denylist
  assert.equal((await actions.close({ name: 'X', processes: ['explorer'] }, 'graceful')).status, 'denied');
});

test('apps found by folder or title: refused if what runs there is protected', async () => {
  const f = fake();
  f.deps.probe = async (spec) => {
    f.calls.push(['probe', spec]);
    return { ids: [7], names: spec.dir ? ['Game'] : ['powershell'] };
  };
  const actions = createAppActions(f.deps);
  assert.equal((await actions.close({ name: 'Game', processes: [], dir: 'C:\\Games\\Game' }, 'graceful')).status, 'closed');
  assert.deepEqual(f.calls[0][1], { names: [], dir: 'C:\\Games\\Game', title: '' });
  assert.equal((await actions.close({ name: 'Shell', processes: [], title: 'Shell' }, 'force')).status, 'denied');
  assert.ok(!f.calls.some((c) => c[0] === 'kill'));
  assert.equal((await actions.close({ name: 'Nada', processes: [] })).status, 'notCloseable');
  assert.ok(isProtected('powershell') && isProtected('pwsh.exe'));
});
