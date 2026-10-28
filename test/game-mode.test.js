'use strict';

// Game mode follows the window feed: it fires once per game, waits 30 s after the game is
// gone (a loading screen or an alt-tab doesn't count) and obeys OFF straight away.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGameMode, EXIT_DELAY_MS } = require('../src/main/game-mode.js');

const GAME = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\Hades.exe';
const game = { fgExe: GAME, fgFull: true };
const desktop = { fgExe: 'C:\\Windows\\explorer.exe', fgFull: false };

// Timers we drive by hand: the 30 s wait is real time otherwise.
function fakeTimers() {
  let next = 0;
  let now = 0;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      next += 1;
      pending.set(next, { fn, at: now + ms });
      return next;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    tick(ms) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.fn();
        }
      }
    },
    pending: () => pending.size,
  };
}

function harness({ enabled = true, apps = [] } = {}) {
  const events = [];
  const timers = fakeTimers();
  const mode = createGameMode({
    enabled: () => enabled,
    apps: () => apps,
    onEnter: (windows) => events.push(['enter', windows.fgExe]),
    onExit: () => events.push(['exit']),
    timers,
  });
  return { mode, events, timers };
}

test('the wait after the game is thirty seconds', () => {
  assert.equal(EXIT_DELAY_MS, 30_000);
});

test('a fullscreen game takes her off the GPU once, even over many updates', () => {
  const { mode, events } = harness();
  mode.update(game);
  mode.update(game);
  mode.update(game);
  assert.deepEqual(events, [['enter', GAME]]);
  assert.equal(mode.active(), true);
});

test('game mode exposes one enter and one delayed exit for the drone integration', () => {
  const { mode, events, timers } = harness();
  mode.update(game);
  mode.update(desktop);
  timers.tick(EXIT_DELAY_MS);
  assert.deepEqual(events, [['enter', GAME], ['exit']]);
});

test('a maximized browser never fires it', () => {
  const { mode, events } = harness();
  mode.update({ fgExe: 'C:\\Users\\Matias\\AppData\\Local\\Programs\\Opera GX\\opera.exe', fgFull: true });
  assert.deepEqual(events, []);
  assert.equal(mode.active(), false);
});

test('she comes back thirty seconds after the game is gone', () => {
  const { mode, events, timers } = harness();
  mode.update(game);
  mode.update(desktop);
  assert.equal(events.length, 1); // still away, the clock is running
  timers.tick(29_999);
  assert.equal(events.length, 1);
  timers.tick(1);
  assert.deepEqual(events, [['enter', GAME], ['exit']]);
  assert.equal(mode.active(), false);
});

test('a game that comes back cancels the wait', () => {
  const { mode, events, timers } = harness();
  mode.update(game);
  mode.update(desktop);
  timers.tick(10_000);
  mode.update(game); // alt-tabbed back in
  timers.tick(30_000);
  assert.deepEqual(events, [['enter', GAME]]);
  assert.equal(timers.pending(), 0);
});

test('another game while she is away does not fire twice', () => {
  const { mode, events } = harness();
  mode.update(game);
  mode.update(desktop);
  mode.update({ fgExe: 'D:\\Epic Games\\Fortnite\\Fortnite.exe', fgFull: true });
  assert.deepEqual(events, [['enter', GAME]]);
  assert.equal(mode.active(), true);
});

test('gaming.apps makes an emulator count', () => {
  const { mode, events } = harness({ apps: ['dolphin.exe'] });
  mode.update({ fgExe: 'C:\\emu\\Dolphin.exe', fgFull: true });
  assert.deepEqual(events, [['enter', 'C:\\emu\\Dolphin.exe']]);
});

test('OFF leaves at once, even in the middle of a game', () => {
  let enabled = true;
  const events = [];
  const mode = createGameMode({
    enabled: () => enabled,
    onEnter: () => events.push('enter'),
    onExit: () => events.push('exit'),
    timers: fakeTimers(),
  });
  mode.update(game);
  enabled = false;
  mode.update(game);
  assert.deepEqual(events, ['enter', 'exit']);
  assert.equal(mode.active(), false);

  enabled = true;
  mode.update(game);
  assert.deepEqual(events, ['enter', 'exit', 'enter']);
});

test('OFF from the start does nothing at all', () => {
  const { mode, events } = harness({ enabled: false });
  mode.update(game);
  assert.deepEqual(events, []);
  assert.equal(mode.active(), false);
});

test('stop() drops a pending return without calling onExit', () => {
  const { mode, events, timers } = harness();
  mode.update(game);
  mode.update(desktop);
  mode.stop();
  timers.tick(60_000);
  assert.deepEqual(events, [['enter', GAME]]);
  assert.equal(mode.active(), false);
});
