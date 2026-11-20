// Shared FX drawing primitives and palette (pure move from fx.js).

import { rand, pick, clamp } from '../util.js';

export const COLORS = {
  red: '#ff2152',
  green: '#36ff7a',
  ink: '#14101c',
  violet: '#7b3dff',
  paper: '#fff4f6',
  blue: '#3d6bff',
  magenta: '#ff2bd6',
};

export const FRAME_MS = 1000 / 24;

export const lerp = (a, b, t) => a + (b - a) * t;

// A stable random number in [0, 1) for (i, seed): the same drawing gets the same jags.
export const hash = (i, seed) => {
  const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

export const onTwos = (ms) => Math.floor(ms / (FRAME_MS * 2)) * FRAME_MS * 2;

// Her mask, what she is at heart in the show once the mane and the body are gone: a green
// slab of a face with a hooked spike rising from it, two eyes (ink almonds, green ring, blue
// iris, white pupil turned toward `look`), and a white fang under it, all over a violet copy.
// Drawn around (x, y) = the middle of the face, k = scale (1: about 95 px wide).
//   eyes   how open each eye is, [left, right]; under 0.15 it's shut (a thick sleepy curve)
//   spike  draw the hooked spike above it
//   flat   one colour for the whole thing (an impact frame)
const MASK = {
  face: [[-48, -20], [-12, -22], [48, -26], [46, 20], [-45, 23]],
  spike: [[-32, -20], [-37, -50], [-22, -63], [6, -67], [24, -75], [34, -99], [49, -90], [44, -66], [30, -48], [2, -42], [-10, -40], [-12, -21]],
  fang: [[-6, 22], [1, 27], [8, 22], [13, 26], [22, 21], [8, 52]],
  eyes: [[-23, 0], [22, -3]],
};

export function drawMask(ctx, x, y, k, { eyes = [1, 1], look = null, spike = true, flat = null } = {}) {
  const poly = (pts, dx = 0, dy = 0) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
    ctx.closePath();
  };
  const shapes = spike ? [MASK.spike, MASK.face, MASK.fang] : [MASK.face, MASK.fang];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.lineJoin = 'miter';
  for (const s of shapes) {
    poly(s, 3, 3);
    ctx.fillStyle = flat || COLORS.violet;
    ctx.fill();
  }
  if (flat) {
    for (const s of shapes) {
      poly(s);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (spike) {
    poly(MASK.spike);
    ctx.fillStyle = COLORS.green;
    ctx.fill();
  }
  poly(MASK.face);
  ctx.fillStyle = COLORS.green;
  ctx.fill();
  poly(MASK.fang);
  ctx.fillStyle = COLORS.paper;
  ctx.fill();
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  MASK.eyes.forEach(([ex, ey], i) => {
    const o = eyes[i];
    if (o < 0.15) {
      // shut
      ctx.beginPath();
      ctx.moveTo(ex - 15, ey - 4);
      ctx.lineTo(ex, ey + 5);
      ctx.lineTo(ex + 15, ey - 4);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 4.5;
      ctx.stroke();
      return;
    }
    let px = 0, py = 0;
    if (look) {
      const d = Math.hypot(look.x - (x + ex * k), look.y - (y + ey * k)) || 1;
      px = ((look.x - (x + ex * k)) / d) * 2.6;
      py = ((look.y - (y + ey * k)) / d) * 2.2;
    }
    ctx.save();
    ctx.translate(ex, ey);
    ctx.scale(1, o);
    ctx.beginPath(); // an almond of ink
    ctx.moveTo(-19, 0);
    ctx.quadraticCurveTo(0, -24, 19, 0);
    ctx.quadraticCurveTo(0, 24, -19, 0);
    ctx.fillStyle = COLORS.ink;
    ctx.fill();
    const disk = (dx, dy, r, color) => {
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    disk(px * 0.4, py * 0.4, 10.5, COLORS.green);
    disk(px * 0.4, py * 0.4, 8.8, COLORS.ink);
    disk(px * 0.7, py * 0.7, 7.6, COLORS.blue);
    ctx.beginPath();
    ctx.ellipse(px, py, 3, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.paper;
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}

// One of her eyes: green ring, blue iris, white pupil turned toward `look`, over an ink disk
// with its violet copy. `open` squashes it shut. (The eyes all over a window she possesses.)
export function drawEye(ctx, x, y, R, open, look = null) {
  let px = 0, py = 0;
  if (look) {
    const d = Math.hypot(look.x - x, look.y - y) || 1;
    px = ((look.x - x) / d) * R * 0.2;
    py = ((look.y - y) / d) * R * 0.2;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, open);
  const disk = (dx, dy, r, color) => {
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };
  disk(-3, 3, R, COLORS.violet);
  disk(0, 0, R, COLORS.ink);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.8, 0, Math.PI * 2);
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = R * 0.16;
  ctx.stroke();
  disk(px * 0.6, py * 0.6, R * 0.52, COLORS.blue);
  ctx.beginPath();
  ctx.ellipse(px, py, R * 0.16, R * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.paper;
  ctx.fill();
  ctx.restore();
}

// Fade-out in four steps, like cels swapped for lighter ones. Kills the item when done.
export function fadeStep(fx, it, now, ms) {
    if (!it.fadeAt) return 1;
    const k = (now - it.fadeAt) / ms;
    if (k >= 1) {
      it.life = 0;
      return 0;
    }
    return 1 - Math.floor(k * 4) / 4;
}

// A shard shape centred on the origin, with its violet copy.
export function shard(fx, len, wid, color) {
    const { ctx } = fx;
    const shape = (dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(-len * 0.5 + dx, dy);
      ctx.lineTo(dx, -wid * 0.5 + dy);
      ctx.lineTo(len * 0.5 + dx, wid * 0.15 + dy);
      ctx.lineTo(-len * 0.1 + dx, wid * 0.5 + dy);
      ctx.closePath();
    };
    shape(-2, 2);
    ctx.fillStyle = COLORS.violet;
    ctx.fill();
    shape(0, 0);
    ctx.fillStyle = color;
    ctx.fill();
}

// A four-point star (her eyes look like these when she comes apart), with its violet copy.
export function sparkle(fx, x, y, s, fill, core = null) {
    const { ctx } = fx;
    const path = (dx, dy, k) => {
      const r = s * k, w = r * 0.24;
      ctx.beginPath();
      ctx.moveTo(x + dx, y - r + dy);
      ctx.lineTo(x + w + dx, y - w + dy);
      ctx.lineTo(x + r + dx, y + dy);
      ctx.lineTo(x + w + dx, y + w + dy);
      ctx.lineTo(x + dx, y + r + dy);
      ctx.lineTo(x - w + dx, y + w + dy);
      ctx.lineTo(x - r + dx, y + dy);
      ctx.lineTo(x - w + dx, y - w + dy);
      ctx.closePath();
    };
    path(-2, 2, 1);
    ctx.fillStyle = COLORS.violet;
    ctx.fill();
    path(0, 0, 1);
    ctx.fillStyle = fill;
    ctx.fill();
    if (core) {
      path(0, 0, 0.36);
      ctx.fillStyle = core;
      ctx.fill();
    }
}

export function eye(fx, x, y, R, open, look) {
  drawEye(fx.ctx, x, y, R, open, look);
}

export { rand, pick, clamp };
