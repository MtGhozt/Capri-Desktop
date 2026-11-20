'use strict';

// Game mode follows the window feed: it fires once per game, waits 30 s after the game is
// gone (a loading screen or an alt-tab doesn't count) and obeys OFF straight away.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGameMode, EXIT_DELAY_MS, FOCUS_LOSS_DEBOUNCE_MS } = require('../src/main/game-mode.js');

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
    setWakeMuted: (on) => events.push(['wakeMuted', on]),
    timers,
  });
  return { mode, events, timers };
}

test('the wait after the game is thirty seconds', () => {
  assert.equal(EXIT_DELAY_MS, 30_000);
});

test('a short focus loss keeps game mode (a flicker never brings her up)', () => {
  const { mode, events, timers } = harness();
  mode.update(game);
  mode.update(desktop); // a popup or a quick alt-tab took the focus
  timers.tick(FOCUS_LOSS_DEBOUNCE_MS);
  assert.equal(mode.active(), true);
  assert.equal(events.length, 2); // still away: wakeMuted + enter only
  timers.tick(EXIT_DELAY_MS);
  assert.equal(mode.active(), false);
});

test('focus-lost releases the click/chat lock immediately without ending VRAM grace', () => {
  const events = [];
  const timers = fakeTimers();
  const mode = createGameMode({
    onEnter: () => events.push('enter'),
    onExit: () => events.push('exit'),
    onUnlock: () => events.push('unlock'),
    onRelock: () => events.push('relock'),
    setWakeMuted: (on) => events.push(['wakeMuted', on]),
    timers,
    exitDelayMs: FOCUS_LOSS_DEBOUNCE_MS,
  });
  mode.update(game);
  assert.equal(mode.active(), true);
  assert.equal(mode.locking(), true);
  mode.update(desktop); // alt-tab away: unlock clicks/chat, keep VRAM unloaded
  assert.equal(mode.active(), true);
  assert.equal(mode.locking(), false);
  assert.deepEqual(events, [['wakeMuted', true], 'enter', 'unlock']);
  mode.update(game); // back before grace ends: re-lock, still no exit/reload
  assert.equal(mode.active(), true);
  assert.equal(mode.locking(), true);
  assert.deepEqual(events, [['wakeMuted', true], 'enter', 'unlock', 'relock']);
  timers.tick(FOCUS_LOSS_DEBOUNCE_MS);
  assert.equal(mode.active(), true);
  assert.equal(events.includes('exit'), false);
});

test('the app waits for the focus-loss debounce, never exits at once', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = require('./main-source');
  assert.equal(FOCUS_LOSS_DEBOUNCE_MS, 10_000);
  assert.doesNotMatch(main, /exitDelayMs:\s*0\b/);
  assert.match(main, /exitDelayMs: FOCUS_LOSS_DEBOUNCE_MS/);
});

test('a fullscreen game takes her off the GPU once, even over many updates', () => {
  const { mode, events } = harness();
  mode.update(game);
  mode.update(game);
  mode.update(game);
  assert.deepEqual(events, [['wakeMuted', true], ['enter', GAME]]);
  assert.equal(mode.active(), true);
});

test('wake muted in fullscreen game and cleared on exit', () => {
  const { mode, events, timers } = harness();
  mode.update(game);
  assert.deepEqual(events.slice(0, 2), [['wakeMuted', true], ['enter', GAME]]);
  mode.update(desktop);
  timers.tick(EXIT_DELAY_MS);
  assert.deepEqual(events, [
    ['wakeMuted', true], ['enter', GAME],
    ['wakeMuted', false], ['exit'],
  ]);
  assert.equal(mode.active(), false);
});

test('game mode exposes one enter and one delayed exit for the drone integration', () => {
  const { mode, events, timers } = harness();
  mode.update(game);
  mode.update(desktop);
  timers.tick(EXIT_DELAY_MS);
  assert.deepEqual(events, [
    ['wakeMuted', true], ['enter', GAME],
    ['wakeMuted', false], ['exit'],
  ]);
});

test('a maximized browser never fires it', () => {
  const { mode, events } = harness();
  mode.update({ fgExe: 'C:\\Users\\Matias\\AppData\\Local\\Programs\\Opera GX\\opera.exe', fgFull: true });
  assert.deepEqual(events, []);
  assert.equal(mode.active(), false);
});

test('reports why a non-game foreground window is ignored', () => {
  const decisions = [];
  const mode = createGameMode({ onDecision: (decision) => decisions.push(decision) });
  mode.update({ fgExe: 'C:\\Users\\Matias\\Opera\\opera.exe', fgFull: true });
  assert.deepEqual(decisions, [{ reason: 'ignored', rule: 'not-fullscreen-game', exe: 'C:\\Users\\Matias\\Opera\\opera.exe', full: true }]);
});

test('she comes back thirty seconds after the game is gone', () => {
  const { mode, events, timers } = harness();
  mode.update(game);
  mode.update(desktop);
  assert.equal(events.length, 2); // wakeMuted + enter; still away, the clock is running
  timers.tick(29_999);
  assert.equal(events.length, 2);
  timers.tick(1);
  assert.deepEqual(events, [
    ['wakeMuted', true], ['enter', GAME],
    ['wakeMuted', false], ['exit'],
  ]);
  assert.equal(mode.active(), false);
});

test('a game that comes back cancels the wait', () => {
  const { mode, events, timers } = harness();
  mode.update(game);
  mode.update(desktop);
  timers.tick(10_000);
  mode.update(game); // alt-tabbed back in
  timers.tick(30_000);
  assert.deepEqual(events, [['wakeMuted', true], ['enter', GAME]]);
  assert.equal(timers.pending(), 0);
});

test('another game while she is away does not fire twice', () => {
  const { mode, events } = harness();
  mode.update(game);
  mode.update(desktop);
  mode.update({ fgExe: 'D:\\Epic Games\\Fortnite\\Fortnite.exe', fgFull: true });
  assert.deepEqual(events, [['wakeMuted', true], ['enter', GAME]]);
  assert.equal(mode.active(), true);
});

test('gaming.apps makes an emulator count', () => {
  const { mode, events } = harness({ apps: ['dolphin.exe'] });
  mode.update({ fgExe: 'C:\\emu\\Dolphin.exe', fgFull: true });
  assert.deepEqual(events, [['wakeMuted', true], ['enter', 'C:\\emu\\Dolphin.exe']]);
});

test('ignored exe in gaming.apps never enters game mode', () => {
  const { mode, events } = harness({ apps: [{ match: 'Hades.exe', ignore: true }] });
  mode.update(game);
  assert.deepEqual(events, []);
  assert.equal(mode.active(), false);
});

test('OFF leaves at once, even in the middle of a game', () => {
  let enabled = true;
  const events = [];
  const mode = createGameMode({
    enabled: () => enabled,
    onEnter: () => events.push('enter'),
    onExit: () => events.push('exit'),
    setWakeMuted: (on) => events.push(['wakeMuted', on]),
    timers: fakeTimers(),
  });
  mode.update(game);
  enabled = false;
  mode.update(game);
  assert.deepEqual(events, [['wakeMuted', true], 'enter', ['wakeMuted', false], 'exit']);
  assert.equal(mode.active(), false);

  enabled = true;
  mode.update(game);
  assert.deepEqual(events, [['wakeMuted', true], 'enter', ['wakeMuted', false], 'exit', ['wakeMuted', true], 'enter']);
});

test('game detected + manual off → not quiet until that process changes', () => {
  const { mode } = harness();
  mode.update(game);
  assert.equal(mode.active(), true);
  mode.dismiss(game);
  assert.equal(mode.active(), false);
  // Same game still fullscreen: stay out (manual override wins).
  mode.update(game);
  assert.equal(mode.active(), false);
  // Manual on clears the suppress and re-enters.
  mode.clearSuppress();
  mode.update(game);
  assert.equal(mode.active(), true);
  mode.dismiss(game);
  assert.equal(mode.active(), false);
  // A different game process: suppress lifts, quiet can return.
  mode.update({ fgExe: 'D:\\Epic Games\\Fortnite\\Fortnite.exe', fgFull: true });
  assert.equal(mode.active(), true);
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
  assert.deepEqual(events, [['wakeMuted', true], ['enter', GAME], ['wakeMuted', false]]);
  assert.equal(mode.active(), false);
});
