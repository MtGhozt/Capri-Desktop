'use strict';

// The watcher speaks in physical screen pixels; her window works in DIPs from its own origin.
// The taskbar rect goes through the same door, and it may sit almost entirely off screen.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toOverlayRect } = require('../src/main/rects.js');

test('a rect keeps its size and loses the overlay origin', () => {
  const bounds = { x: 0, y: 1, width: 1920, height: 1079 };
  assert.deepEqual(
    toOverlayRect({ x: 0, y: 1032, w: 1920, h: 48 }, bounds),
    { x: 0, y: 1031, w: 1920, h: 48 },
  );
});

test('a monitor to the left lands in negative screen coordinates', () => {
  const bounds = { x: -1920, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(
    toOverlayRect({ x: -1920, y: 1032, w: 1920, h: 48 }, bounds),
    { x: 0, y: 1032, w: 1920, h: 48 },
  );
});

test('a scaled display converts to DIPs before moving the origin', () => {
  const bounds = { x: 0, y: 0, width: 1280, height: 720 };
  const half = (box) => ({ x: box.x / 2, y: box.y / 2, width: box.width / 2, height: box.height / 2 });
  assert.deepEqual(
    toOverlayRect({ x: 0, y: 688, w: 2560, h: 32 }, bounds, half),
    { x: 0, y: 344, w: 1280, h: 16 },
  );
});

test('the auto-hidden bar, parked off the bottom edge, still converts', () => {
  const bounds = { x: 0, y: 1, width: 1920, height: 1079 };
  // 2 px of a 48 px bar left on screen: the watcher marks it as not shown
  assert.deepEqual(
    toOverlayRect({ x: 0, y: 1078, w: 1920, h: 48 }, bounds),
    { x: 0, y: 1077, w: 1920, h: 48 },
  );
});

test('a missing or broken rect is nothing', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.equal(toOverlayRect(null, bounds), null);
  assert.equal(toOverlayRect(undefined, bounds), null);
  assert.equal(toOverlayRect({ x: 0, y: 0, w: 'x', h: 48 }, bounds), null);
  const broken = () => null;
  assert.equal(toOverlayRect({ x: 0, y: 0, w: 10, h: 10 }, bounds, broken), null);
});

test('the window watch passes fgFull on, so game mode can see a fullscreen game', () => {
  const { foreground } = require('../src/main/rects');
  const { gameOnScreen } = require('../src/main/game-detect');
  const fg = foreground({ fg: 1, fgExe: 'D:\\Epic Games\\Fortnite\\Fortnite.exe', fgTitle: 'Fortnite', fgFull: true });
  assert.equal(fg.fgFull, true);
  assert.equal(gameOnScreen(fg), true);
  assert.equal(foreground({ fgExe: 'x.exe' }).fgFull, false);
  const src = require('node:fs').readFileSync(require.resolve('../src/main/windows.js'), 'utf8');
  assert.match(src, /\.\.\.foreground\(snap\)/);
});
