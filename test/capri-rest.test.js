'use strict';

// Where Capri rests at the bottom of the screen: the spot you drop her on, roaming free (no
// walking back to it), a bottom corner to sleep in, and FIJO keeping her where she is. The real Capri class, without its drawing (no WebGL here).

const { test } = require('node:test');
const assert = require('node:assert/strict');

// the renderer modules read these when they load
globalThis.matchMedia ??= () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);

const load = () => import('../src/renderer/js/capri.js');

// A Capri with no canvas behind her, standing at the bottom of a 1920x1079 window. Moves are
// recorded instead of played: `teleports` lists where she was sent.
async function make({ w = 1920, h = 1079, bar = null, ...rest } = {}) {
  const { Capri } = await load();
  const c = Object.create(Capri.prototype);
  const now = performance.now();
  Object.assign(c, {
    root: { style: {} },
    canvas: { style: {} },
    scale: 0.6,
    view: { w, h, floor: h },
    facing: 1,
    mode: 'idle',
    stance: 'stand',
    perch: null,
    peekSide: null,
    windows: { fg: 0, wins: [] },
    bar,
    busy: false,
    hidden: false,
    stowed: false,
    dormant: false,
    wander: true,
    restOn: 'taskbar',
    locked: false,
    dragging: false,
    homeX: null,
    p: { sit: 0, alpha: 1, glitch: 0, split: 0, glitchSeed: 0 },
    bob: 0, tilt: 0, sx: 1, sy: 1,
    act: null,
    lastActivity: now - 7000,
    nextTwitch: Infinity, nextShed: Infinity, nextGaze: Infinity, nextMove: Infinity,
    sleptAt: now, peekUntil: Infinity,
    voice: { play() {} },
    fx: new Proxy({}, { get: () => () => {} }),
    homes: [],
    teleports: [],
  });
  c.pos = { x: w - 200, y: c.floor };
  c.onHome = (x) => c.homes.push(x);
  c.teleport = async (to, opts = {}) => {
    c.teleports.push({ to: { ...to }, opts });
    c.pos = { x: to.x, y: to.floor ? c.floor : to.y }; // as arrive() puts her
    c.setStance(opts.stance || 'stand', { perch: opts.perch });
  };
  c.setStance('stand');
  Object.assign(c, rest);
  return c;
}

// put her somewhere, standing, as a move would
function at(c, pos) {
  c.pos = { ...pos };
  c.setStance('stand');
}

test('dropped at the bottom of the screen, she stays right there and it becomes her spot', async () => {
  const c = await make();
  c.pos = { x: 700, y: c.floor };
  c.drop();
  assert.equal(c.stance, 'stand');
  assert.equal(c.pos.x, 700);
  assert.equal(c.pos.y, c.floor);
  assert.ok(Math.abs(c.homeX - 700 / 1920) < 1e-9);
  assert.deepEqual(c.homes, [c.homeX]); // saved (app.js puts it in config.position.homeX)
});

test('going home goes to her own spot when she has one', async () => {
  const c = await make({ homeX: 0.25 });
  at(c, { x: 1500, y: 300 });
  await c.goHome();
  assert.equal(c.teleports.length, 1);
  assert.equal(c.teleports[0].to.x, 480);
});

test('her spot stays on the screen, away from its edges', async () => {
  const c = await make({ homeX: 0 });
  assert.equal(c.homeSpot(), 50);
  c.homeX = 1;
  assert.equal(c.homeSpot(), 1920 - 60);
});

test('with no spot of her own she goes to the default one', async () => {
  const c = await make();
  assert.equal(c.homeSpot(), Math.min(c.spot('post').x, Math.max(1920 * 0.6, 1920 - 440)));
});

test('idle, she stays wherever she roamed to: no walking back to her spot', async () => {
  const c = await make({ homeX: 0.25 });
  at(c, { x: 1500, y: 300 });
  const now = performance.now();
  for (const ago of [7000, 20000, 60000, 5 * 60000]) {
    c.lastActivity = now - ago;
    c.behave(now);
  }
  assert.equal(c.teleports.length, 0);
  assert.deepEqual(c.pos, { x: 1500, y: 300 });
  assert.equal(c.mode, 'idle');
});

test('FIJO: she never goes back by herself', async () => {
  const c = await make({ homeX: 0.25, locked: true });
  at(c, { x: 1500, y: 300 });
  c.behave(performance.now());
  await c.goHome();
  assert.equal(c.teleports.length, 0);
  assert.deepEqual(c.pos, { x: 1500, y: 300 });
});

test('work with no window to sit on: standing, she stays where she is', async () => {
  const c = await make({ homeX: 0.25 });
  at(c, { x: 1500, y: 300 });
  c.goToWork();
  assert.equal(c.teleports.length, 0);
  assert.equal(c.mode, 'work');
});

// ---------- going to sleep in a bottom corner ----------

const tick = () => new Promise((r) => setTimeout(r, 0));

// fall asleep from nobody doing anything, with Math.random() pinned to r (picks the corner)
async function nodOff(c, r) {
  const random = Math.random;
  Math.random = () => r;
  try {
    c.lastActivity = performance.now() - 11 * 60 * 1000; // past SLEEP_AFTER
    c.behave(performance.now());
    await tick();
  } finally {
    Math.random = random;
  }
}

test('nothing going on for minutes: she goes to the bottom left corner and sleeps there', async () => {
  const c = await make();
  at(c, { x: 900, y: 400 });
  await nodOff(c, 0.1);
  assert.equal(c.teleports.length, 1);
  assert.equal(c.teleports[0].to.x, c.spot('chip').x);
  assert.equal(c.teleports[0].opts.face, 1); // facing into the screen
  assert.deepEqual(c.pos, { x: c.spot('chip').x, y: 1079 });
  assert.equal(c.grounded, true);
  assert.equal(c.mode, 'sleep');
});

test('or the bottom right one: both corners get picked', async () => {
  const c = await make();
  at(c, { x: 900, y: 400 });
  await nodOff(c, 0.9);
  assert.equal(c.teleports.length, 1);
  assert.equal(c.teleports[0].to.x, c.spot('post').x);
  assert.equal(c.teleports[0].opts.face, -1);
  assert.equal(c.pos.x, c.spot('post').x);
  assert.equal(c.mode, 'sleep');
  assert.ok(c.spot('chip').x < 300 && c.spot('post').x > 1920 - 300);
});

test('the bar up, she sleeps in the corner on top of it, and still rides it there', async () => {
  const c = await make({ bar: UP });
  at(c, { x: 900, y: 400 });
  await nodOff(c, 0.9);
  assert.equal(c.pos.y, 1031);
  assert.equal(c.grounded, true);
  c.setWindows({ fg: 0, wins: [], bar: HIDDEN });
  assert.equal(c.pos.y, 1079);
});

test('FIJO: she falls asleep right where she is', async () => {
  const c = await make({ locked: true });
  at(c, { x: 900, y: 400 });
  await nodOff(c, 0.1);
  assert.equal(c.teleports.length, 0);
  assert.deepEqual(c.pos, { x: 900, y: 400 });
  assert.equal(c.mode, 'sleep');
});

test('waking up, she stays in her corner', async () => {
  const c = await make();
  at(c, { x: 900, y: 400 });
  await nodOff(c, 0.1);
  const x = c.pos.x;
  c.wake();
  c.lastActivity = performance.now() - 30000;
  c.behave(performance.now());
  assert.equal(c.mode, 'idle');
  assert.equal(c.teleports.length, 1);
  assert.equal(c.pos.x, x);
});

test('told to sleep (DORMANT), she goes to a corner first; FIJO, she stays', async () => {
  const c = await make();
  at(c, { x: 900, y: 400 });
  const random = Math.random;
  Math.random = () => 0.9;
  try {
    await c.goToBed();
  } finally {
    Math.random = random;
  }
  assert.equal(c.pos.x, c.spot('post').x);
  const fixed = await make({ locked: true });
  at(fixed, { x: 900, y: 400 });
  await fixed.goToBed();
  assert.equal(fixed.teleports.length, 0);
});

test('going home, she stands on the bottom edge at her spot', async () => {
  const c = await make({ homeX: 0.25 });
  at(c, { x: 1500, y: 300 });
  await c.goHome();
  assert.equal(c.stance, 'stand');
  assert.equal(c.grounded, true);
  assert.deepEqual(c.pos, { x: 480, y: 1079 });
  await c.goHome(); // already there: no second trip
  assert.equal(c.teleports.length, 1);
});

// ---------- standing on the bottom edge, riding the taskbar ----------

const HIDDEN = { x: 0, y: 1077, w: 1920, h: 48, shown: false }; // auto-hide: parked off the screen
const UP = { x: 0, y: 1031, w: 1920, h: 48, shown: true };

test('the bar hidden, her feet are on the bottom of the screen', async () => {
  const c = await make({ bar: HIDDEN });
  await c.goHome();
  assert.equal(c.stance, 'stand');
  assert.equal(c.pos.y, 1079);
});

test('the bar up, her feet are on its top edge: none of her under it', async () => {
  const c = await make({ bar: UP });
  await c.goHome();
  assert.equal(c.stance, 'stand');
  assert.equal(c.pos.y, 1031);
  // the lowest point of her drawing is her feet, with the float she does never sinking in
  c.animate(performance.now());
  assert.ok(c.bob <= 0);
});

test('the bar comes up and hides again: she rides it all the way, both ways', async () => {
  const c = await make({ bar: HIDDEN });
  at(c, { x: 900, y: 1079 });
  assert.equal(c.grounded, true);
  // halfway up first (the watcher saw it while it slid), then where it stops
  c.setWindows({ fg: 0, wins: [], bar: { ...UP, y: 1055 } });
  assert.equal(c.pos.y, 1055);
  c.setWindows({ fg: 0, wins: [], bar: UP });
  assert.equal(c.pos.y, 1031);
  assert.equal(c.pos.x, 900);
  c.setWindows({ fg: 0, wins: [], bar: HIDDEN });
  assert.equal(c.pos.y, 1079);
  assert.equal(c.stance, 'stand');
});

test('a bar change she missed while busy is caught up on the next beat', async () => {
  const c = await make({ bar: HIDDEN });
  at(c, { x: 900, y: 1079 });
  c.busy = true;
  c.setWindows({ fg: 0, wins: [], bar: UP });
  assert.equal(c.pos.y, 1079); // in the middle of something: not now
  c.busy = false;
  c.behave(performance.now());
  assert.equal(c.pos.y, 1031);
});

test('the bar coming up over her feet lifts her onto it', async () => {
  const c = await make({ bar: HIDDEN });
  at(c, { x: 900, y: 1079 });
  c.grounded = false; // whatever happened, she's down there and not marked as on the edge
  c.setWindows({ fg: 0, wins: [], bar: UP });
  assert.equal(c.pos.y, 1031);
  assert.equal(c.grounded, true);
});

test('up in the air she stays where she is when the bar moves', async () => {
  const c = await make({ bar: HIDDEN });
  at(c, { x: 900, y: 500 });
  c.setWindows({ fg: 0, wins: [], bar: UP });
  assert.equal(c.pos.y, 500);
  assert.equal(c.grounded, false);
});

test('dropped at the bottom with the bar up, she stands on the bar there', async () => {
  const c = await make({ bar: UP });
  c.dragging = true;
  at(c, { x: 640, y: 1030 });
  c.dragging = false;
  c.drop();
  assert.equal(c.stance, 'stand');
  assert.equal(c.grounded, true);
  assert.deepEqual(c.pos, { x: 640, y: 1031 });
  assert.ok(Math.abs(c.homeX - 640 / 1920) < 1e-9);
});

test('let go higher up, she falls to the bottom edge and that becomes her spot', async () => {
  const c = await make({ bar: HIDDEN });
  c.dragging = true;
  at(c, { x: 1200, y: 600 });
  c.dragging = false;
  c.drop(); // reduced motion here: she lands at once
  assert.equal(c.stance, 'stand');
  assert.equal(c.pos.y, 1079);
  assert.ok(Math.abs(c.homeX - 1200 / 1920) < 1e-9);
  assert.equal(c.homes.length, 1);
});

test('the bottom edge under her feet lets the pointer through to the taskbar', async () => {
  const c = await make({ bar: HIDDEN });
  c.alphaMap = new Uint8ClampedArray(240 * 420 * 4).fill(255); // all of her drawing is solid
  at(c, { x: 900, y: 1079 });
  assert.equal(c.hit(900, 1078), false);
  assert.equal(c.hit(900, 1060), true);
});

test('with motion on, she slides up to the bar and ends exactly on it, even when it moves mid-slide', async () => {
  const { reducedMotion } = await import('../src/renderer/js/util.js');
  const c = await make({ bar: HIDDEN });
  at(c, { x: 900, y: 1079 });
  const was = reducedMotion.matches;
  reducedMotion.matches = false;
  try {
    c.setWindows({ fg: 0, wins: [], bar: { ...UP, y: 1055 } });
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(c.pos.y < 1079 && c.pos.y > 1055, `on her way up: ${c.pos.y}`);
    c.setWindows({ fg: 0, wins: [], bar: UP }); // where it stops
    c.setWindows({ fg: 0, wins: [], bar: UP }); // the watcher saying it again once it has settled
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(c.pos.y, 1031);
    assert.equal(c.rideTo, null);
  } finally {
    reducedMotion.matches = was;
  }
});
