'use strict';

// A fullscreen game owns the screen: she never steals focus or clicks (no show()/focus()/
// moveTop(), click-through stays on), and leaving the game only puts the window back the way a
// quiet overlay needs it — the chat is never opened by any of this.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGameQuiet } = require('../src/main/game-quiet.js');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
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
      setIgnoreMouseEvents: (on, opts) => calls.push(['ignore', on, opts]),
    },
  };
}

test('leaving the game restores the window without show(), focus() or the chat', () => {
  const { calls, win } = fakeWindow();
  createGameQuiet({ isActive: () => false }).restore(win);
  assert.deepEqual(calls, [
    'showInactive',
    ['ignore', true, { forward: true }],
  ]);

  // The leave path itself: restore + a silent wake, never a chat toggle.
  const from = main.indexOf('async function gameLeave');
  const leave = main.slice(from, main.indexOf('function voiceReplyOn', from));
  assert.ok(from > 0, 'gameLeave exists');
  assert.match(leave, /gameQuiet\.restore\(overlay\)/);
  assert.match(leave, /sendCommand\('wake', \{ silent: true \}\)/);
  assert.doesNotMatch(leave, /openChat|chatVisible|sendCommand\('chat'/);
});

test('a destroyed window is left alone', () => {
  const { calls, win } = fakeWindow({ destroyed: true });
  createGameQuiet({ isActive: () => false }).restore(win);
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
