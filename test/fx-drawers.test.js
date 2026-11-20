'use strict';

// Smoke: every FxLayer drawer runs against a stub 2D context. Missing imports
// (rand, clamp, COLORS, …) throw ReferenceError here instead of at overlay boot.

const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.window = globalThis;

function stubCtx() {
  const noop = () => {};
  return {
    canvas: { width: 1280, height: 720 },
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    rect: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,
    drawImage: noop,
    fillText: noop,
    measureText: () => ({ width: 40 }),
    setLineDash: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineJoin: 'miter',
    font: '',
    letterSpacing: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingQuality: 'low',
    lineDashOffset: 0,
  };
}

function stubCanvas(w = 64, h = 64) {
  const ctx = stubCtx();
  return {
    width: w,
    height: h,
    style: {},
    getContext: () => ctx,
  };
}

globalThis.document = {
  createElement: (tag) => {
    if (tag === 'canvas') return stubCanvas();
    return { style: {} };
  },
};

function fakeImage() {
  return { width: 360, height: 240 };
}

function itemsFor(type, now) {
  const pt = { x: 200, y: 200 };
  const rect = { x: 100, y: 100, w: 200, h: 120 };
  const common = { type, born: now, life: 2000 };
  switch (type) {
    case 'shard':
      return { ...common, x: 100, y: 100, vx: 10, vy: -10, rot: 0, vr: 1, len: 20, wid: 6, color: '#ff2152' };
    case 'beam':
      return { ...common, x: 400, bottom: 600, width: 40, down: false };
    case 'streak':
      return { ...common, pts: [[10, 10], [40, 80], [90, 40]] };
    case 'slice':
      return { ...common, x: 50, y: 50, w: 80, h: 8, dx: 20, color: '#ff2152' };
    case 'slit':
      return { ...common, x: 300, top: 100, bottom: 500, width: 40 };
    case 'vortex':
      return {
        ...common,
        x: 300, y: 300, radius: 80,
        ps: [
          { a: 0, r: 1, len: 12, wid: 4, color: '#ff2152', eye: false },
          { a: 1, r: 0.6, len: 10, wid: 3, color: '#36ff7a', eye: true },
        ],
      };
    case 'drift':
      return { ...common, x: 100, y: 100, vx: 5, vy: -8, rot: 0.2, vr: 0.1, len: 14, wid: 4, color: '#ff2152' };
    case 'cutin':
      return { ...common, x: 400, y: 200, dir: 1, image: fakeImage() };
    case 'pointer':
      return {
        ...common,
        life: 60_000,
        from: () => ({ x: 50, y: 400 }),
        aim: { x: 200, y: 160 },
        rect,
        label: 'test',
        fadeAt: 0,
        tapAt: 0,
        retractAt: 0,
      };
    case 'glyph':
      return { ...common, x: 120, y: 400, text: '01', drift: 4 };
    case 'motes':
      return {
        ...common,
        life: 60_000,
        ps: [
          { x0: 10, y0: 10, x1: 20, y1: 0, size: 3, phase: 1, delay: 0, u: 0.2, off: 1 },
          { x0: 30, y0: 10, x1: 40, y1: -5, size: 2, phase: 2, delay: 0, u: 0.8, off: -1 },
        ],
        links: [[0, 1]],
        ends: null,
        alignAt: 0,
        litAt: 0,
        litMs: 0,
        dimAt: 0,
        homeAt: 0,
        shift: [0, 0],
      };
    case 'satellite':
      return {
        ...common,
        life: 60_000,
        from: { x: 0, y: 100 },
        to: { x: 800, y: 80 },
        duration: 9000,
        flare: null,
        fadeAt: 0,
        pos: (t) => ({ x: ((t - now) / 9000) * 800, y: 100 }),
      };
    case 'surge':
      return {
        ...common,
        life: 60_000,
        ends: () => [pt, { x: 500, y: 40 }],
        onHit: null,
        pts: null,
        breakAt: 0,
        pieces: null,
      };
    case 'possess':
      return {
        ...common,
        life: 60_000,
        rect: () => rect,
        covers: () => [],
        entry: 0,
        look: () => ({ x: 150, y: 150 }),
        extra: [],
        leaveAt: 0,
        off: null,
      };
    case 'crackle':
      return { ...common, at: pt, radius: 40, count: 2 };
    case 'bolt':
      return { ...common, from: pt, to: { x: 400, y: 100 }, width: 4, forks: 1 };
    case 'lines':
      return { ...common, x: 300, y: 300, inner: 80 };
    case 'zap':
      return {
        ...common,
        from: pt,
        aim: { x: 400, y: 120 },
        travel: 200,
        width: 5,
      };
    case 'hitbox':
      return { ...common, rect, aim: { x: 200, y: 160 }, kind: 'zap' };
    case 'flare':
      return { ...common, x: 300, y: 300, size: 1, kind: 'spark' };
    case 'ring':
      return { ...common, x: 300, y: 300, size: 1 };
    case 'intro':
      return {
        ...common,
        smooth: true,
        life: 5000,
        s: 0.5,
        at: { x: 640, y: 360 },
        to: { x: 200, y: 500, size: 80 },
        ctrl: { x: 400, y: 300 },
        label: 'hi',
        caption: 'capri',
        still: true,
        onCue: () => {},
        land: () => {},
        cued: -1,
      };
    default:
      return common;
  }
}

test('every DRAWERS entry runs without ReferenceError', async () => {
  const { FxLayer, DRAWERS } = await import('../src/renderer/js/fx.js');
  assert.ok(DRAWERS);
  const types = Object.keys(DRAWERS);
  assert.ok(types.includes('intro'), 'intro drawer must be registered');
  assert.ok(types.length >= 20, `expected full drawer set, got ${types.length}`);

  const canvas = stubCanvas(1280, 720);
  const fx = new FxLayer(canvas, { cutins: { grin: fakeImage() }, intro: null });
  fx.size = { w: 1280, h: 720 };
  fx.grab = stubCanvas(1672, 941);
  fx.grabFrames = { grab: fx.grab, mouth1: fx.grab, happy: fx.grab };
  fx.grabCopies = {
    paper: stubCanvas(1672, 941),
    ink: stubCanvas(1672, 941),
    violet: stubCanvas(1672, 941),
    channels: [stubCanvas(1672, 941), stubCanvas(1672, 941), stubCanvas(1672, 941)],
  };
  // Stub methods intro may call into the layer (burst/crackle/lines).
  fx.burst = () => {};
  fx.crackle = () => {};
  fx.lines = () => {};

  const now = performance.now();
  const failures = [];
  for (const type of types) {
    const it = itemsFor(type, now);
    try {
      DRAWERS[type](fx, it, 0.3, 0.016, now + 200);
      DRAWERS[type](fx, it, 0.8, 0.016, now + 800);
    } catch (err) {
      failures.push(`${type}: ${err && err.stack ? err.stack.split('\n')[0] : err}`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});
