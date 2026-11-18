'use strict';

// A fullscreen game owns the screen: she never steals focus or clicks (no show()/focus()/
// moveTop(), click-through stays on), and leaving the game only puts the window back the way a
// quiet overlay needs it — the chat is never opened by any of this.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGameQuiet, TOP_LEVEL } = require('../src/main/game-quiet.js');

// The game parts moved out of main.js: the bundle has game-window.js first, so its functions are found.
const main = require('./main-source');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');

function fakeWindow({ destroyed = false } = {}) {
  const calls = [];
  return {
    calls,
    win: {
      isDestroyed: () => destroyed,
      show: () => calls.push('show'),
      focus: () => calls.push('focus'),
      moveTop: () => calls.push('moveTop'),
      showInactive: () => calls.push('showInactive'),
      setAlwaysOnTop: (on, level) => calls.push(['alwaysOnTop', on, level]),
      setIgnoreMouseEvents: (on, opts) => calls.push(['ignore', on, opts]),
    },
  };
}

test('leaving the game restores the window without show(), focus() or the chat', () => {
  const { calls, win } = fakeWindow();
  createGameQuiet({ isActive: () => false }).restore(win);
  assert.deepEqual(calls, [
    ['alwaysOnTop', true, TOP_LEVEL],
    'showInactive',
    ['ignore', true, { forward: true }],
  ]);

  // The leave path itself: restore + a silent wake when quiet hid her, never a chat toggle.
  const from = main.indexOf('async function gameLeave');
  const leave = main.slice(from, main.indexOf('module.exports', from));
  assert.ok(from > 0, 'gameLeave exists');
  assert.match(leave, /gameQuiet\.restore\(getOverlay\(\)\)/);
  assert.match(leave, /gameHidHer && !gameWasFolded/);
  assert.match(leave, /sendCommand\('wake', \{ silent: true \}\)/);
  assert.doesNotMatch(leave, /openChat|chatVisible|sendCommand\('chat'/);
});

test('pin keeps her visible, click-through and above the game', () => {
  assert.equal(TOP_LEVEL, 'screen-saver');
  const { calls, win } = fakeWindow();
  createGameQuiet({ isActive: () => true }).pin(win);
  assert.deepEqual(calls, [
    ['alwaysOnTop', true, 'screen-saver'],
    'showInactive',
    ['ignore', true, { forward: true }],
  ]);
  assert.ok(!calls.includes('focus'));
  assert.ok(!calls.includes('show'));
});

test('a destroyed window is left alone', () => {
  const { calls, win } = fakeWindow({ destroyed: true });
  const gq = createGameQuiet({ isActive: () => false });
  gq.restore(win);
  gq.pin(win);
  assert.deepEqual(calls, []);
});

test('while a game is on the policy is active and hover cannot take click-through away', () => {
  assert.equal(createGameQuiet({ isActive: () => true }).active(), true);
  assert.equal(createGameQuiet({ isActive: () => false }).active(), false);
  assert.match(
    main,
    /ipcMain\.on\('overlay:interactive', \(_e, on\) => \{\s*if \(gameQuiet\.active\(\)\) return;/,
  );
  // Click-through is forced on for the whole game, from the moment it starts.
  assert.match(main, /gameQuiet\.active\(\)\s*\?\s*true/);
  assert.match(main, /setClickThrough\(true, 'game'\)/);
});

test('every window-raising path routes through the policy', () => {
  for (const name of ['openChat', 'menuKeyboardOn', 'raiseOverlay', 'rearmOverlay', 'setQuitSolid']) {
    const at = main.indexOf(`function ${name}`);
    assert.ok(at > 0, `${name} exists`);
    assert.match(main.slice(at, at + 600), /gameQuiet\.active\(\)/, `${name} routes through game-quiet`);
  }
});

test('the game wake brings her back with no bubble and no chime', () => {
  assert.match(app, /case 'wake':\s*await unfold\(\{ silent: cmd\.silent === true \}\)/);
  assert.match(app, /if \(!silent\) voice\.wakeArp\(\)/);
  assert.match(app, /silent \? Promise\.resolve\(\) : bubble\.birth/);
  assert.match(app, /if \(!silent\) bubble\.show\(\)/);
});

test('hover while she is asleep under a fullscreen window keeps click-through', () => {
  // Her chip sits over the fullscreen window: a hover there must not make her take clicks.
  assert.match(main, /if \(on && state\.overlayFolded && getLastWindows\(\)\?\.fgFull\) return;/);
  // An unchanged hover ask is not written to the window again.
  assert.match(main, /if \(on === getLastInteractive\(\)\) return;[\s\S]{0,120}?setLastInteractive\(on\);\s*setClickThrough\(!on/);
  assert.match(main, /let lastInteractive = null/);
  // ...and any non-hover change invalidates that dedupe, so the next ask is applied.
  assert.match(main, /if \(reason !== 'hover-on' && reason !== 'hover-off'\) lastInteractive = null/);
});

test('the hover re-send and the pointer poll never go faster than a second', () => {
  const resync = app.match(/host\.setInteractive\(interactive\);\s*\}, (\d+)\)/);
  assert.ok(resync, 'the periodic re-send exists');
  assert.ok(Number(resync[1]) >= 1000, `re-send every ${resync[1]} ms`);
  const watch = app.match(/const WATCH_MS = (\d+)/);
  assert.ok(watch, 'the pointer poll exists');
  assert.ok(Number(watch[1]) >= 1000, `pointer poll every ${watch[1]} ms`);
});

test('an auto wake over a game never toggles the chat', () => {
  // The wake listen (and the line it heard) never reach the renderer while a game is on.
  assert.match(main, /quietWake = Boolean\(gameMode\?\.active\(\)\) && payload\.wake === true/);
  assert.match(main, /const hideWake = quietWake\s*\|\| \(payload\?\.type === 'transcript'/);
  assert.match(main, /if \(!hideWake\) \{\s*if \(overlay\?\.webContents/);
  // openChat itself stays behind the game-quiet policy for every source, wake included.
  assert.match(main, /function openChat[\s\S]{0,200}gameQuiet\.active\(\)/);
});
