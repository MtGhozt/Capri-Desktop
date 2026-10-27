'use strict';

// Where Capri rests at the bottom of the screen: the spot you drop her on, going back to it,
// and FIJO keeping her where she is. The real Capri class, without its drawing (no WebGL here).

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
    nextHome: 0,
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
    c.pos = { ...to };
    c.setStance(opts.stance || 'stand', { perch: opts.perch });
  };
  c.setStance('stand');
  Object.assign(c, rest);
  return c;
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
  c.pos = { x: 1500, y: 300 };
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

test('a while after anything happens, she goes back to her spot', async () => {
  const c = await make({ homeX: 0.25 });
  c.pos = { x: 1500, y: 300 };
  c.behave(performance.now());
  assert.equal(c.teleports.length, 1);
  assert.equal(c.teleports[0].to.x, 480);
});

test('FIJO: she never goes back by herself', async () => {
  const c = await make({ homeX: 0.25, locked: true });
  c.pos = { x: 1500, y: 300 };
  c.behave(performance.now());
  await c.goHome();
  assert.equal(c.teleports.length, 0);
  assert.deepEqual(c.pos, { x: 1500, y: 300 });
});
