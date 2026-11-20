// Her first appearance: grab the screen (pure move from fx.js).

import { clamp } from '../util.js';
import { COLORS, FRAME_MS, lerp, hash } from './primitives.js';
import { stroke } from './electric.js';

// her intro (see intro()): her close-up holding your screen by its edges
// (assets/capri/intro-grab.webp, cut out by tools/build-intro.py), where things are on it in its
// pixels, and when things happen, in drawings at 24 fps
export const GRAB = {
  w: 1672, h: 941,
  face: { x: 830, y: 330, size: 430 }, // the middle of her face, and about how wide it is
  eyes: [{ x: 719.5, y: 382.5 }, { x: 935, y: 297.5 }],
  tilt: -0.38, // her head's tilt (radians), for her lids
  socket: 48, iris: 34, pupil: 13.5, // the ink inside her green rings, her blue iris, her white pupil
  irisColor: '#026ffe', pupilColor: '#fdfdfb', inkColor: '#010207', // the picture's own colours
  tag: { x: 1110, y: 175 }, // where "hi" pops, by her face
  hands: [{ x: 0, y: 610 }, { x: 1672, y: 520 }], // where her hands hold the edges of the screen
};
export const INTRO_T = { hands: 6, right: 8, reach: 10, grab: 16, hold: 21, blink: 29, hi: 34, wave: 46, regrab: 63, happy: 65, glance: 75, slip: 80, antic: 86, shrink: 88, land: 98, end: 101 };
// her close-up's drawings (assets/capri/intro-<name>.webp), the same picture with only her mouth,
// her eyes or her right arm changed: at rest, her mouth ajar, half open and wide open, waving (her
// hand tilted left, right, straight up), her arm a smear between the edge and her face, and her
// eyes shut with joy
export const GRAB_FRAMES = ['grab', 'mouth1', 'mouth2', 'mouth3', 'wave1', 'wave2', 'wave3', 'smear', 'happy'];
// the wave, after the smear of her arm leaving the edge: three drawings each
const WAVE = ['wave1', 'wave3', 'wave2', 'wave3', 'wave1'];
// drawings whose eyes are their own (not redrawn over: they don't look around)
const OWN_EYES = new Set(['happy']);
// "hi", from her mouth starting to open (in drawings at 24 fps, two each)
const SAY_HI = ['mouth1', 'mouth1', 'mouth3', 'mouth3', 'mouth3', 'mouth3', 'mouth2', 'mouth2', 'mouth1', 'mouth1'];

// What shows of her intro's close-up (fx.js intro): never a straight edge of the picture, always a
// jagged one, new jags every drawing (`seed`). Each adds its shape to the current path, in the
// picture's pixels.
const JAG = 70; // px of the picture between two points of a cut
const JAG_AMP = 46;

// From the sides in: rL and rR, how far in from the left and right edges (1: half the picture).
function cutEdges(ctx, rL, rR, seed) {
  const { w, h } = GRAB;
  const side = (r, left) => {
    if (r <= 0) return;
    const reach = r * w * 0.5;
    const amp = JAG_AMP * Math.min(1, r * 4);
    ctx.moveTo(left ? -60 : w + 60, -60);
    for (let y = -60, i = 0; y <= h + 60 + JAG; y += JAG, i++) {
      const x = reach + (hash(i, seed + (left ? 0 : 50)) - 0.5) * 2 * amp;
      ctx.lineTo(left ? x : w - x, y);
    }
    ctx.lineTo(left ? -60 : w + 60, h + 60 + JAG);
    ctx.closePath();
  };
  side(rL, true);
  side(rR, false);
}

// From the middle out: a band `half` wide on each side of her face.
function cutBand(ctx, half, seed) {
  const { h } = GRAB;
  const cx = GRAB.face.x;
  const ys = [];
  for (let y = -60; y <= h + 60 + JAG; y += JAG) ys.push(y);
  ys.forEach((y, i) => {
    const x = cx - half - (hash(i, seed) - 0.5) * 2 * JAG_AMP;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  for (let i = ys.length - 1; i >= 0; i--) ctx.lineTo(cx + half + (hash(i, seed + 50) - 0.5) * 2 * JAG_AMP, ys[i]);
  ctx.closePath();
}

// Her head and mane: a spiky disc of radius R around her face, long points and short ones.
function cutHead(ctx, R, seed) {
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = R * (i % 2 ? 0.78 : 1) * (0.92 + hash(i, seed) * 0.16);
    const x = GRAB.face.x + Math.cos(a) * r * 1.15, y = GRAB.face.y + Math.sin(a) * r * 0.95;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// Her flat silhouettes for the impact frames, and her red, green and blue apart: made once,
// ahead, so nothing is left to work out while she's on screen.
export function prepareGrab(fx) {
    const copy = (fill, mode) => {
      const c = document.createElement('canvas');
      c.width = GRAB.w;
      c.height = GRAB.h;
      const g = c.getContext('2d');
      g.drawImage(fx.grab, 0, 0);
      g.globalCompositeOperation = mode;
      g.fillStyle = fill;
      g.fillRect(0, 0, c.width, c.height);
      if (mode === 'multiply') {
        g.globalCompositeOperation = 'destination-in'; // multiply fills her cut-out background too
        g.drawImage(fx.grab, 0, 0);
      }
      return c;
    };
    fx.grabCopies = {
      paper: copy(COLORS.paper, 'source-in'),
      ink: copy(COLORS.ink, 'source-in'),
      violet: copy(COLORS.violet, 'source-in'),
      channels: ['#ff0000', '#00ff00', '#0000ff'].map((c) => copy(c, 'multiply')),
    };
}

// Her close-up, its face at (x, y), `k` times its size on screen (squashed sx, sy), turned `rot`:
// the picture (or a flat copy of it: 'paper', 'ink', 'violet'), her colours pulled `split` px
// apart, and her eyes drawn over its own (looking `look`, image px; `open` 1, 0.5 or 0).
// `clip`: what shows of it (a cut: cutEdges, cutBand, cutHead), else all of it. `cel`: which of
// its drawings (GRAB_FRAMES), else her at rest.
export function grabbed(fx, it, x, y, k, { rot = 0, sx = 1, sy = 1, flat = null, split = 0, look = { x: 0, y: 0 }, open = 1, clip = null, cel = 'grab' } = {}) {
    const { ctx } = fx;
    const c = fx.grabCopies;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(it.s * k * sx, it.s * k * sy);
    ctx.translate(-GRAB.face.x, -GRAB.face.y);
    if (clip) {
      ctx.beginPath();
      clip(ctx);
      ctx.clip();
    }
    ctx.imageSmoothingQuality = 'high';
    if (flat) {
      ctx.drawImage(c[flat], 0, 0);
    } else if (split) {
      const d = split / (it.s * k);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(c.channels[0], -d, d * 0.3);
      ctx.drawImage(c.channels[1], 0, 0);
      ctx.drawImage(c.channels[2], d, -d * 0.3);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.drawImage(fx.grabFrames[cel] || fx.grab, 0, 0);
      if (!OWN_EYES.has(cel) || !fx.grabFrames[cel]) GRAB.eyes.forEach((e) => grabEye(fx, e, look, open));
    }
    ctx.restore();
}

// One of her eyes on the close-up, over the picture's own: the iris and pupil turned `look`,
// or her lid half down (0.5) or shut (0): ink, with a green line for its edge.
export function grabEye(fx, e, look, open) {
    const { ctx } = fx;
    const disk = (x, y, r, color) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    ctx.save();
    disk(e.x, e.y, GRAB.socket, GRAB.inkColor);
    ctx.clip();
    if (open > 0) {
      disk(e.x + look.x, e.y + look.y, GRAB.iris, GRAB.irisColor);
      disk(e.x + look.x * 1.15, e.y + look.y * 1.15, GRAB.pupil + 1.6, GRAB.inkColor);
      disk(e.x + look.x * 1.15, e.y + look.y * 1.15, GRAB.pupil, GRAB.pupilColor);
    }
    if (open < 1) {
      ctx.translate(e.x, e.y);
      ctx.rotate(GRAB.tilt);
      const edge = open > 0 ? -GRAB.socket * 0.1 : GRAB.socket * 0.15;
      ctx.fillStyle = GRAB.inkColor;
      ctx.fillRect(-GRAB.socket, -GRAB.socket, GRAB.socket * 2, GRAB.socket + edge);
      ctx.beginPath();
      ctx.moveTo(-GRAB.socket, edge - 6);
      ctx.quadraticCurveTo(0, edge + 10, GRAB.socket, edge - 6);
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    ctx.restore();
}

// The tag she says hi on: red, slanted, its left end at (x, y), its letters fs px, scaled by `k`
// from that end (`ky`: squashed flat).
export function hiTag(fx, x, y, text, fs, k = 1, ky = 1) {
    const { ctx } = fx;
    ctx.save();
    ctx.font = `600 ${fs}px "Chakra Petch", sans-serif`;
    ctx.letterSpacing = `${(-fs * 0.03).toFixed(1)}px`;
    const skew = fs * 0.32, th = fs * 1.18;
    const tw = ctx.measureText(text).width + fs * 0.9 + skew;
    ctx.translate(x, y);
    ctx.scale(k, k * ky);
    const band = (dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(skew + dx, -th / 2 + dy);
      ctx.lineTo(tw + dx, -th / 2 + dy);
      ctx.lineTo(tw - skew + dx, th / 2 + dy);
      ctx.lineTo(dx, th / 2 + dy);
      ctx.closePath();
    };
    band(7, 7);
    ctx.fillStyle = COLORS.violet;
    ctx.fill();
    band(0, 0);
    ctx.fillStyle = COLORS.red;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.paper;
    ctx.fillText(text, tw / 2, fs * 0.04);
    ctx.restore();
}

// A line typed out on an ink strip from (x, y), a red block for a cursor, blinking once it's all there.
export function typed(fx, x, y, full, text, frame) {
    const { ctx } = fx;
    ctx.save();
    ctx.font = '400 12px "JetBrains Mono", monospace';
    ctx.letterSpacing = '2px';
    const tw = ctx.measureText(full).width;
    ctx.fillStyle = COLORS.violet;
    ctx.fillRect(x + 3, y - 12, tw + 28, 22);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(x, y - 15, tw + 28, 22);
    ctx.fillStyle = COLORS.paper;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x + 9, y + 1);
    if (text.length < full.length || (frame >> 2) % 2) {
      ctx.fillStyle = COLORS.red;
      ctx.fillRect(x + 10 + ctx.measureText(text).width, y - 10, 8, 13);
    }
    ctx.restore();
}

// The edges of the screen crackling red, in broken runs on their violet copy (new ones for each `seed`).
export function screenEdges(fx, w, h, seed) {
    const { ctx } = fx;
    let i = 0;
    const r = (a, b) => a + hash(i++, seed) * (b - a);
    const runs = (horizontal, fixed, len) => {
      for (let p = r(-60, 0); p < len; p += r(70, 230)) {
        const l = r(50, 190), t = r(4, 9);
        const [x, y, rw, rh] = horizontal ? [p, fixed, l, t] : [fixed, p, t, l];
        ctx.fillStyle = COLORS.violet;
        ctx.fillRect(x + 3, y + 3, rw, rh);
        ctx.fillStyle = COLORS.red;
        ctx.fillRect(x, y, rw, rh);
      }
    };
    runs(true, 0, w);
    runs(true, h - 9, w);
    runs(false, 0, h);
    runs(false, w - 9, h);
}

// The void, as she leaves or lands (see slit): black, with her as a red line in it.
export function voidSlit(fx, x, y, w, h) {
    const { ctx } = fx;
    ctx.fillStyle = COLORS.violet;
    ctx.fillRect(x - w / 2 - 3, y - h / 2, w + 6, h);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = COLORS.red;
    ctx.fillRect(x - 1, y - h * 0.42, 2, h * 0.84);
}

export function intro(fx, it, _t, _dt, now) {
  const { ctx } = fx;
  const T = INTRO_T;
  const { s, at, to } = it;
  const { w: vw, h: vh } = fx.size;
  const t = (now - it.born) / FRAME_MS; // in frames, not rounded: the moves follow it smoothly
  const frame = Math.floor(t); // the drawings change on whole frames
  // a point of the close-up (its pixels) on screen, its face at (x, y), k times its size
  const onScreen = (p, x = at.x, y = at.y, k = 1) => ({ x: x + (p.x - GRAB.face.x) * s * k, y: y + (p.y - GRAB.face.y) * s * k });
  const hands = GRAB.hands.map((p) => {
    const q = onScreen(p);
    return { x: clamp(q.x, 14, vw - 14), y: q.y };
  });
  for (let f = it.cued + 1; f <= frame; f++) {
    if (f === 0) it.onCue('open');
    if (it.still) {
      if (f === T.grab) it.onCue('grab');
    } else {
      if (f === 3) for (const q of hands) fx.crackle(q, { life: 260, radius: 70 });
      if (f === T.hands || f === T.right) {
        // a hand slams onto the edge of the screen
        const q = hands[f === T.hands ? 0 : 1];
        it.onCue('hand');
        fx.burst(q.x, q.y, { count: 10, power: 0.7, spread: 90 });
        fx.crackle(q, { life: 220, radius: 50 });
      }
      if (f === T.reach + 3) fx.lines(at.x, at.y, { inner: Math.min(vw, vh) * 0.5, life: 260 });
      if (f === T.grab) {
        it.onCue('grab');
        fx.lines(at.x, at.y, { inner: Math.min(vw, vh) * 0.45, life: 320 });
        fx.burst(at.x, at.y, { count: 16, power: 1, spread: 160 });
      }
      if (f === T.slip) for (const q of hands) fx.crackle(q, { life: 240, radius: 60 });
    }
    if (f === T.hi + 2) it.onCue('hi'); // her mouth wide open
    if (f === T.wave) it.onCue('wave');
    if (f === T.happy) {
      it.onCue('hand'); // her hand back on the edge
      if (!it.still) fx.crackle(hands[1], { life: 220, radius: 50 });
    }
    if (f === T.slip) it.onCue('slip');
    if (f === (it.still ? T.slip + 4 : T.land)) it.land();
  }
  it.cued = frame;

  // "hi" on its tag by her face, popping in, her name typed under it
  const tagAt = onScreen(GRAB.tag);
  const fs = Math.round(clamp(vh * 0.06, 40, 76));
  const hi = (k = 1, ky = 1) => {
    hiTag(fx, tagAt.x, tagAt.y, it.label, fs, k, ky);
    if (it.caption && frame >= T.hi + 6 && ky === 1) {
      typed(fx, tagAt.x + fs * 0.5, tagAt.y + fs * 1.15, it.caption, it.caption.slice(0, (frame - T.hi - 6) * 2), frame);
    }
  };
  // her eyes: centred as she lands, darting left and right, on you for "hi", a blink, then
  // toward where she's going
  const toward = { x: Math.sign(to.x - at.x) || 1, y: Math.sign(to.y - at.y) || 1 };
  const since = frame - T.hold;
  let look = { x: 0, y: 3 };
  if (since < 3) look = { x: 0, y: 0 };
  else if (since < 7) look = { x: -10, y: -3 };
  else if (since < 11) look = { x: 10, y: -4 };
  else if (frame >= T.glance) look = { x: toward.x * 10, y: toward.y * 7 };
  const b = frame - T.blink;
  const open = b === 0 || b === 3 ? 0.5 : b === 1 || b === 2 ? 0 : 1;
  // the line boiling: a new drawing every other frame, a pixel or two off the last
  const n = frame >> 1;
  const noise = (k) => (hash(n, k) * 2 - 1);

  if (it.still) {
    const a = frame < 4 ? (frame + 1) / 4 : frame >= T.slip ? 1 - (frame - T.slip + 1) / 4 : 1;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    grabbed(fx, it, at.x, at.y, 1.02, { look: { x: 0, y: 3 } });
    if (frame >= T.hi) hi();
    ctx.restore();
    return;
  }

  if (frame < T.hands) {
    // the edges of the screen crackle red: something's about to grab them
    if (frame % 2 === 0 || frame === T.hands - 1) screenEdges(fx, vw, vh, frame);
    return;
  }

  if (frame < T.reach) {
    // her hands: the left one slams onto the edge, then the right, the screen jolting each time
    const rL = 0.16, rR = frame >= T.right ? 0.16 : 0;
    const g = frame - (frame >= T.right ? T.right : T.hands);
    const jolt = [7, -3][g] ?? 0;
    grabbed(fx, it, at.x + jolt * (frame >= T.right ? 1 : -1), at.y + 70 * s, 1.04, {
      look, open, clip: (c) => cutEdges(c, rL, rR, frame),
    });
    return;
  }

  if (frame < T.grab) {
    // her arms reaching in along them, faster and faster, as she hauls herself up to the glass
    const u = clamp((t - T.reach + 1) / (T.grab - T.reach), 0, 1);
    const r = lerp(0.16, 1.2, u * u);
    grabbed(fx, it, at.x, at.y + 70 * s * (1 - u * u), lerp(1.04, 1.02, u), {
      look, open, clip: (c) => cutEdges(c, r, r, frame),
    });
    return;
  }

  if (frame < T.hold) {
    // her face hits it: a white flash of her, an ink one on its violet copy, then the
    // picture with its colours apart, settling as the shake dies down
    const g = frame - T.grab;
    const shake = [24, -17, 11, -6, 3][g];
    const x = at.x + shake, y = at.y - shake * 0.4;
    if (g === 0) {
      grabbed(fx, it, x, y, 1.22, { flat: 'paper' });
    } else if (g === 1) {
      grabbed(fx, it, x + 10, y + 10, 1.1, { flat: 'violet' });
      grabbed(fx, it, x, y, 1.1, { flat: 'ink' });
    } else {
      grabbed(fx, it, x, y, [1.05, 1.02, 1.03][g - 2], { split: [16, 7, 2][g - 2] });
    }
    return;
  }

  if (frame < T.slip) {
    // holding on: she breathes and boils, the camera creeping in on her, shards of her mane
    // drifting off. She says "hi" (her mouth opening over three drawings, wide on the tag
    // popping, her head bobbing), then her arm leaves the right edge in a smear and she waves,
    // her hand tilting left, up, right, up, left on threes; a smear back onto the edge, and
    // she shuts her eyes with joy. Now and then her colours slip.
    const h0 = frame - T.hi - 2;
    let cel = SAY_HI[frame - T.hi] ?? 'grab';
    let shake = 0;
    if (frame >= T.wave && frame < T.wave + 2) {
      cel = 'smear'; // her arm off the edge
      if (frame === T.wave) shake = 6;
    } else if (frame >= T.wave + 2 && frame < T.regrab) {
      cel = WAVE[Math.floor((frame - T.wave - 2) / 3)] ?? 'wave1';
    } else if (frame >= T.regrab && frame < T.happy) {
      cel = 'smear'; // and back onto it
    } else if (frame >= T.happy && frame < T.glance) {
      cel = 'happy';
      if (frame < T.happy + 2) shake = [8, -4][frame - T.happy]; // her hand slamming onto it
    }
    if (frame % 5 === 0 && it.drifted !== frame) {
      it.drifted = frame; // once per frame, however often it's drawn
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const r = Math.min(vw, vh) * rand(0.36, 0.5);
      fx.drift(at.x + Math.cos(a) * r * 1.3, at.y + Math.sin(a) * r, a);
    }
    const creep = 0.03 * clamp((t - T.hold) / (T.slip - T.hold), 0, 1);
    const bob = h0 >= 0 && h0 < 8 ? [0.024, 0.024, -0.017, -0.017, 0.009, 0.009, 0, 0][h0] : 0;
    const pop = h0 === 0 || h0 === 1 ? [0.025, 0.012][h0] : 0;
    const k = 1.025 + pop + creep + 0.006 * Math.sin(t / 7);
    const glitch = frame % 24 === 19 && cel === 'grab' ? 6 : 0; // (the split is of her at rest)
    grabbed(fx, it, at.x + noise(1) * 1.5 + shake, at.y + noise(2) * 1.5, k, { rot: noise(3) * 0.003 + bob, look, open, cel, split: glitch });
    if (h0 >= 0) hi([0.35, 1.22, 0.94][h0] ?? 1);
    return;
  }

  const kHold = 1.055;
  if (frame < T.antic) {
    // she lets go: her arms come apart into shards from her hands in, the screen's edges
    // free again, and she sags a little; the tag squashed away
    const g = frame - T.slip;
    const u = clamp((t - T.slip + 1) / (T.antic - T.slip), 0, 1);
    const half = lerp(GRAB.w * 0.5 + 60, 330, 1 - (1 - u) * (1 - u));
    const y = at.y + 56 * s * u * u;
    grabbed(fx, it, at.x, y, kHold, { look, open, clip: (c) => cutBand(c, half, frame) });
    // the shards where her arms break off, once per frame
    if (it.shattered !== frame) {
      it.shattered = frame;
      for (const side of [-1, 1]) {
        for (let j = 0; j < 2; j++) {
          const q = onScreen({ x: GRAB.face.x + side * half, y: rand(250, 800) }, at.x, y, kHold);
          fx.burst(q.x, q.y, { count: 4, power: 0.55, spread: 40 });
        }
      }
    }
    if (g === 0) hi(1, 0.45);
    return;
  }

  // her head and mane, all that's left: a crouch to take off, then the dive
  const R = 370;
  const start = { x: at.x, y: at.y + 56 * s };
  if (frame < T.shrink) {
    const g = frame - T.antic;
    const [sx, sy, dy] = [[1.08, 0.88, 24], [0.94, 1.12, -30]][g];
    grabbed(fx, it, start.x, start.y + dy * s, kHold * 0.9, { sx, sy, look, clip: (c) => cutHead(c, R, frame) });
    return;
  }

  if (frame < T.land) {
    // the dive: shrinking fast, then falling faster and faster into her, smeared along the
    // way, where she was a moment ago left behind her in violet, a zigzag where she's been
    const u = clamp((t - T.shrink + 1) / (T.land - T.shrink), 0, 1);
    const lag = 0.12; // how far back her violet afterimages are
    const k0 = kHold * 0.9, k1 = (to.size * 1.5) / (GRAB.face.size * s);
    const place = (v) => {
      const e = v * v;
      const a = (1 - e) * (1 - e), c2 = 2 * e * (1 - e), c = e * e;
      return {
        x: a * start.x + c2 * it.ctrl.x + c * to.x,
        y: a * start.y + c2 * it.ctrl.y + c * to.y,
        k: lerp(k0, k1, 1 - (1 - v) * (1 - v)),
      };
    };
    const trail = [];
    for (let j = 0; j <= 10; j++) {
      const q = place(Math.max(0, u - 0.45 + (j / 10) * 0.45));
      trail.push([q.x + (j % 2 ? 1 : -1) * (3 + hash(j, frame) * 6), q.y]);
    }
    ctx.save();
    ctx.lineJoin = 'miter';
    stroke(fx, trail, COLORS.violet, 5, -3, 3);
    stroke(fx, trail, COLORS.red, 4);
    stroke(fx, trail, COLORS.paper, 1.2);
    ctx.restore();
    const head = (c) => cutHead(c, R, frame);
    for (const [back, alpha] of [[2, 0.14], [1, 0.3]]) {
      const v = u - back * lag;
      if (v <= 0) continue;
      const q = place(v);
      ctx.save();
      ctx.globalAlpha = alpha;
      grabbed(fx, it, q.x, q.y, q.k, { flat: 'violet', clip: head });
      ctx.restore();
    }
    const q = place(u), prev = place(Math.max(0, u - lag * 0.5));
    const ang = Math.atan2(q.y - prev.y, q.x - prev.x);
    const size = R * 2 * s * q.k;
    const st = clamp(1 + (Math.hypot(q.x - prev.x, q.y - prev.y) / size) * 0.3, 1, 2);
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(ang);
    ctx.scale(st, 1 / Math.sqrt(st));
    ctx.rotate(-ang);
    grabbed(fx, it, 0, 0, q.k, { look: { x: toward.x * 10, y: toward.y * 7 }, clip: head });
    ctx.restore();
    return;
  }

  // landed: it closes into a slit where her face will be
  const g = frame - T.land;
  if (g < 2) voidSlit(fx, to.x, to.y, to.size * [0.4, 0.1][g], to.size * 1.5);
  return;
}
