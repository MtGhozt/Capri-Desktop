// Full-screen effect layer: shards, light beams, the zigzag streak between two teleport
// points, the void she collapses into and the swirl she comes back from, data glyphs,
// mane shards drifting off, the stars rising out of her mane, the satellite and the red light
// she sends up to it, the windows she takes over, red lightning, speed lines, shockwaves, and
// the cut-ins (real frames of her from the show).
// Drawn on whole frames (24 fps) and only while something is alive.

import { rand, pick, clamp } from './util.js';
import { COLORS, FRAME_MS, lerp, drawMask, drawEye } from './fx/primitives.js';
import { prepareGrab, intro as drawIntro, GRAB, INTRO_T, GRAB_FRAMES } from './fx/intro.js';
import * as particles from './fx/particles.js';
import * as electric from './fx/electric.js';
import * as possession from './fx/possession.js';

export { COLORS, drawMask, drawEye, GRAB_FRAMES };

// her app effects (Paso 4E): magenta, violet and green, white-hot in the middle
const APP_PALETTE = ['magenta', 'magenta', 'magenta', 'violet', 'violet', 'green', 'green', 'paper'];

const SHARD_PALETTE = ['red', 'red', 'red', 'red', 'ink', 'ink', 'green', 'green', 'violet', 'paper'];
const GLYPHS = ['01', '10', '▚', '▞', '◢', '◣', '>_', '{}', '#', '⌁', '//', '0x'];

const DRAWERS = {
  shard: particles.shard,
  beam: particles.beam,
  streak: particles.streak,
  slice: particles.slice,
  slit: particles.slit,
  vortex: particles.vortex,
  drift: particles.drift,
  cutin: particles.cutin,
  pointer: particles.pointer,
  glyph: particles.glyph,
  motes: possession.motes,
  satellite: possession.satellite,
  surge: possession.surge,
  possess: possession.possess,
  crackle: electric.crackle,
  bolt: electric.bolt,
  lines: electric.lines,
  zap: electric.zap,
  hitbox: electric.hitbox,
  flare: electric.flare,
  ring: electric.ring,
  intro: drawIntro,
};

export class FxLayer {
  constructor(canvas, { cutins = {}, intro = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cutins = cutins;
    this.grab = intro?.grab || null; // her close-up for her intro (GRAB_FRAMES), at rest
    this.grabFrames = intro || {};
    if (this.grab) prepareGrab(this);
    this.items = [];
    this.running = false;
    this.last = 0;
  }

  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = { w: width, h: height };
  }

  // Showing you something: a lock-on reticle that slams onto `rect`, a dashed wire from her
  // fingertip (`from`, a function) to `aim` with data running down it, two of her eyes opening
  // on the reticle's corners, and a word on a tag. When `rect` is off her screen (the tray, down
  // in the taskbar), an arrow on the edge points the rest of the way.
  // Handle: tap() (she jabs at it: the reticle pulses), retract() (the wire reels back into her
  // finger, the reticle lets go), fade().
  pointer(from, rect, aim, { label = '' } = {}) {
    const item = this.add({ type: 'pointer', life: 10 * 60 * 1000, from, rect, aim, label, fadeAt: 0, tapAt: 0, retractAt: 0 });
    return {
      tap: () => { item.tapAt = performance.now(); },
      retract: () => { item.retractAt ||= performance.now(); },
      fade: () => { item.fadeAt ||= performance.now(); },
    };
  }

  add(item) {
    item.born = performance.now();
    this.items.push(item);
    if (!this.running) {
      this.running = true;
      requestAnimationFrame((t) => this.frame(t));
    }
    return item;
  }

  // ---------- shards and light ----------

  // Shards thrown out (or sucked in) around a point.
  burst(x, y, { count = 22, power = 1, inward = false, spread = 70, palette = SHARD_PALETTE } = {}) {
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(220, 680) * power;
      const ox = x + rand(-spread, spread) * 0.5;
      const oy = y + rand(-spread, spread);
      const life = rand(260, 620);
      this.add({
        type: 'shard',
        life,
        x: inward ? ox + Math.cos(angle) * speed * life / 1600 : ox,
        y: inward ? oy + Math.sin(angle) * speed * life / 1600 : oy,
        vx: Math.cos(angle) * speed * (inward ? -1 : 1),
        vy: Math.sin(angle) * speed * (inward ? -1 : 1),
        rot: rand(0, Math.PI * 2),
        vr: rand(-9, 9),
        len: rand(10, 36),
        wid: rand(3, 10),
        color: COLORS[pick(palette)],
      });
    }
  }

  // Vertical pillar of light, from the top of the screen down to `bottom` (shrinking or landing).
  beam(x, bottom, { down = false, life = 200, width = 30 } = {}) {
    this.add({ type: 'beam', life, x, bottom, down, width });
  }

  // Jagged line between two points, a frame or two long. It tells the eye where she went.
  streak(x1, y1, x2, y2, { life = 120 } = {}) {
    const pts = [];
    const n = 9;
    const nx = -(y2 - y1), ny = x2 - x1;
    const len = Math.hypot(nx, ny) || 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = i === 0 || i === n ? 0 : rand(-1, 1) * Math.min(60, len * 0.08);
      pts.push([x1 + (x2 - x1) * t + (nx / len) * off, y1 + (y2 - y1) * t + (ny / len) * off]);
    }
    this.add({ type: 'streak', life, pts });
  }

  // Horizontal slivers of the body knocked sideways.
  slices(x, y, w, h, { count = 7, life = 160 } = {}) {
    for (let i = 0; i < count; i++) {
      this.add({
        type: 'slice',
        life: life * rand(0.6, 1),
        x: x + rand(-w * 0.3, w * 0.3),
        y: y + rand(0, h),
        w: rand(w * 0.3, w * 1.1),
        h: rand(2, 7),
        dx: rand(-60, 60),
        color: COLORS[pick(['red', 'green', 'violet', 'paper'])],
      });
    }
  }

  // The void she collapses into, like in the show: a black slit with her as a red line inside.
  slit(x, top, bottom, { width = 60, life = 210 } = {}) {
    this.add({ type: 'slit', life, x, top, bottom, width });
  }

  // How she comes back in the show: her pieces spiralling in, mane shards and green eye-stars.
  vortex(x, y, { radius = 170, life = 360, count = 18 } = {}) {
    const ps = Array.from({ length: count }, (_, i) => ({
      a: (i / count) * Math.PI * 2 + rand(-0.25, 0.25),
      r: rand(0.65, 1.1),
      eye: i % 4 === 0,
      color: COLORS[pick(['red', 'red', 'red', 'ink', 'violet'])],
      len: rand(14, 34),
      wid: rand(4, 9),
    }));
    this.add({ type: 'vortex', life, x, y, radius, ps });
  }

  // Manga concentration lines closing in on a point, redrawn every other frame.
  lines(x, y, { inner = 140, life = 480 } = {}) {
    this.add({ type: 'lines', life, x, y, inner });
  }

  // A hard-edged shockwave.
  ring(x, y, { size = 1 } = {}) {
    this.add({ type: 'ring', life: 280, x, y, size });
  }

  // Red lightning, her hacking power: a jagged bolt with forks, re-struck every frame.
  // `to` can be a function of time, for a moving target.
  bolt(from, to, { life = 380, forks = 2, width = 3 } = {}) {
    this.add({ type: 'bolt', life, from, to, forks, width });
  }

  // ---------- her apps (Paso 4E) ----------

  // Her zap at a window she's about to close: a bolt that runs from her (`from`) to the window
  // (`rect`, or a `point` when there's no window to aim at) in `travel` ms, then the window's
  // frame flashes and throws sparks. Resolves when it hits; the whole thing is ~0.8 s.
  zapApp(from, { rect = null, point = null } = {}, { travel = 260 } = {}) {
    const aim = rect ? this.inside(rect) : point;
    this.add({ type: 'zap', life: travel + 340, from: { ...from }, aim, travel, width: 3.2 });
    return new Promise((resolve) => {
      setTimeout(() => {
        if (rect) this.add({ type: 'hitbox', life: 520, rect: { ...rect }, aim, kind: 'zap' });
        this.add({ type: 'flare', life: 360, x: aim.x, y: aim.y, size: rect ? 1 : 0.7, kind: 'zap' });
        this.burst(aim.x, aim.y, { count: rect ? 20 : 12, power: 0.7, spread: 30, palette: APP_PALETTE });
        resolve();
      }, travel);
    });
  }

  // Her spark where an app she opened came up: a star flare, and the window's corners snapping
  // out from its middle to its edges (just the flare and a few sparks on a `point`). ~0.7 s.
  sparkApp({ rect = null, point = null } = {}) {
    const at = rect ? this.inside(rect) : point;
    if (rect) this.add({ type: 'hitbox', life: 680, rect: { ...rect }, aim: at, kind: 'spark' });
    this.add({ type: 'flare', life: 560, x: at.x, y: at.y, size: rect ? 1.3 : 0.8, kind: 'spark' });
    this.burst(at.x, at.y, { count: rect ? 16 : 10, power: 0.55, spread: 24, palette: APP_PALETTE });
  }

  // The middle of `rect`, kept on her screen (a window half off it still gets hit where it shows).
  inside(rect) {
    const w = this.size?.w || innerWidth, h = this.size?.h || innerHeight;
    const x0 = clamp(rect.x, 0, w), x1 = clamp(rect.x + rect.w, 0, w);
    const y0 = clamp(rect.y, 0, h), y1 = clamp(rect.y + rect.h, 0, h);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }

  glyph(x, y) {
    this.add({ type: 'glyph', life: rand(900, 1400), x: x + rand(-40, 40), y, text: pick(GLYPHS), drift: rand(-12, 12) });
  }

  // One shard coming loose from the mane and floating away, slowly, outward and up.
  drift(x, y, angle) {
    const speed = rand(16, 34);
    this.add({
      type: 'drift',
      life: rand(1900, 2900),
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 10,
      rot: angle + rand(-0.4, 0.4),
      vr: rand(-0.8, 0.8),
      len: rand(9, 20),
      wid: rand(3, 6),
      color: COLORS[pick(['red', 'red', 'red', 'ink', 'paper'])],
    });
  }

  // ---------- the satellite ----------

  // The white specks of her mane lifting off as a sky of her own, linked up like a
  // constellation (all the minds in her). Handle:
  //   align(ends)  they line up into a road between the two points ends() returns
  //   light(ms)    they flare one after the other, from her end up, over ms
  //   dim()        back to plain specks
  //   home(dx, dy) they fly back into her mane (shifted by how far she moved since)
  motes(sources, { lift = 220, spread = 300 } = {}) {
    const ps = sources.map((s) => ({
      x0: s.x, y0: s.y,
      x1: s.x + rand(-spread, spread) * 0.5,
      y1: s.y - rand(lift * 0.45, lift * 1.3),
      size: rand(2, 4),
      phase: rand(0, 6),
      delay: rand(0, 500),
      u: 0,
      off: rand(-7, 7),
    }));
    // each star linked to its nearest neighbour in the sky
    const links = [];
    ps.forEach((p, i) => {
      let best = -1, d = Infinity;
      ps.forEach((q, j) => {
        const dd = Math.hypot(q.x1 - p.x1, q.y1 - p.y1);
        if (j !== i && dd < d) [best, d] = [j, dd];
      });
      if (best >= 0 && !links.some(([a, b]) => a === best && b === i)) links.push([i, best]);
    });
    const item = this.add({
      type: 'motes', life: 60000, ps, links,
      ends: null, alignAt: 0, litAt: 0, litMs: 0, dimAt: 0, homeAt: 0, shift: [0, 0],
    });
    return {
      align: (ends) => {
        const [a, b] = ends();
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        // whoever is closest to her end goes first, so the stars don't cross each other's paths
        const along = (p) => ((p.x1 - a.x) * (b.x - a.x) + (p.y1 - a.y) * (b.y - a.y)) / len;
        [...ps].sort((p, q) => along(p) - along(q)).forEach((p, i) => { p.u = 0.1 + (0.82 * i) / Math.max(1, ps.length - 1); });
        item.ends = ends;
        item.alignAt = performance.now();
      },
      light: (ms = 125) => { item.litAt = performance.now(); item.litMs = ms; },
      dim: () => { item.dimAt ||= performance.now(); },
      home: (dx = 0, dy = 0) => {
        if (item.homeAt) return;
        item.homeAt = performance.now();
        item.shift = [dx, dy];
      },
    };
  }

  // A satellite crossing the sky, slowly: it blinks into view, then glints on threes, with a
  // short trail. Handle: pos(now), twinkle(size) (a big four-point flare, it answers her), fade().
  satellite(from, to, { duration = 9000 } = {}) {
    const item = this.add({ type: 'satellite', life: 60000, from, to, duration, flare: null, fadeAt: 0 });
    const pos = (now = performance.now()) => {
      const k = Math.min(1, Math.max(0, (now - item.born) / duration));
      return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k) };
    };
    item.pos = pos;
    return {
      pos,
      twinkle: (size = 1) => { item.flare = { at: performance.now(), size }; },
      fade: () => { item.fadeAt ||= performance.now(); },
    };
  }

  // The red light going up: a heavy bolt from her hand to the satellite (ends() returns both).
  // Its head races up in three drawings, the first one in negative (an impact frame), then it
  // holds, struck fresh on every drawing with light running up it, until break(): it snaps and
  // the pieces fall. onHit runs when it reaches the top.
  surge(ends, { onHit = null } = {}) {
    const item = this.add({ type: 'surge', life: 60000, ends, onHit, pts: null, breakAt: 0, pieces: null });
    return { break: () => { item.breakAt ||= performance.now(); } };
  }

  // She takes over a window: lightning races round its frame from where she dove in, slices
  // of it glitch, and it looks at you with her eyes and her grin, more eyes opening all over it,
  // every pupil on your pointer. rect() gives the window now (null once it's gone), covers() the
  // windows in front of it (nothing is drawn over those), look() the pointer.
  // Handle: leave() closes the eyes and ends it.
  possess(rect, { covers = () => [], entry = 0, look = () => null } = {}) {
    const extra = Array.from({ length: 7 }, (_, i) => {
      // around the face, not on it
      const a = (i / 7) * Math.PI * 2 + rand(-0.3, 0.3);
      return { u: 0.5 + Math.cos(a) * rand(0.28, 0.42), v: 0.46 + Math.sin(a) * rand(0.26, 0.4), size: rand(0.35, 0.65), at: 650 + i * 95 };
    });
    const item = this.add({ type: 'possess', life: 60000, rect, covers, entry, look, extra, leaveAt: 0, off: null });
    return { leave: () => { item.leaveAt ||= performance.now(); } };
  }

  // Little red sparks crawling out of a point (her hand charging up), wider as it goes.
  // `at` can be a function, for a moving point.
  crackle(at, { life = 700, radius = 46, count = 3 } = {}) {
    this.add({ type: 'crackle', life, at, radius, count });
  }

  // ---------- cut-ins ----------

  // Anime cut-in: a slanted band with a close-up of her (a real frame from the show),
  // pushed in, speed lines behind. Kinds: grin, laugh, eyes, many, look. Resolves when gone.
  cutin(x, y, dir = 1, { kind = 'grin', life = 760 } = {}) {
    const image = this.cutins[kind] || this.cutins.grin;
    if (!image) return Promise.resolve();
    return new Promise((done) => this.add({ type: 'cutin', life, x, y, dir, image, done }));
  }

  // ---------- her intro ----------

  // Her first appearance: she grabs your screen. Its edges crackle red; her left hand slams onto
  // its edge, then her right; her arms reach in along them, faster and faster, as she hauls herself
  // up, and her face hits the glass: a white flash of her, an ink one, her colours pulled apart,
  // the screen shaking. She looks around, blinks, says "hi" with her mouth (a tag pops by her face,
  // her name typed under it), lets go of the right edge to wave, grabs it again, glances at where
  // she's going, and lets go: her arms come apart into shards from her hands in, her head crouches
  // and dives down to `to` (her face where she'll stand: { x, y, size }), and closes into a slit
  // there. Never a straight edge of the picture on screen. Her moves follow the clock at the
  // screen's rate (smooth), her drawings change on whole frames, like cels.
  // Cues to onCue: 'open', 'hand' (three times), 'grab', 'hi', 'wave', 'slip'. Resolves as it
  // lands, for her body to unfold.
  // `still` (reduced motion): it comes and goes where it is, in four steps each way.
  intro({ to, label = 'hi', caption = '', still = false, onCue = () => {} }) {
    if (!this.grab || !this.size) return Promise.resolve();
    const { w, h } = this.size;
    const s = Math.max(w / GRAB.w, h / GRAB.h); // filling the screen, her hands on its edges
    const at = { x: (w - GRAB.w * s) / 2 + GRAB.face.x * s, y: (h - GRAB.h * s) / 2 + GRAB.face.y * s };
    // the dive swings out a little toward the middle of the screen on its way down to her
    const ctrl = { x: lerp(at.x, to.x, 0.25) - (to.x - at.x) * 0.2, y: lerp(at.y, to.y, 0.15) };
    return new Promise((land) => {
      this.add({ type: 'intro', smooth: true, life: FRAME_MS * (INTRO_T.end + 1), s, at, to, ctrl, label, caption, still, onCue, land, cued: -1 });
    });
  }

// ---------- loop ----------

  // Whole frames at 24 fps, or every screen refresh while something that moves smoothly is on
  // (her intro: its camera moves follow the clock, its drawings still change on whole frames).
  frame(now) {
    if (now - this.last < FRAME_MS - 2 && !this.items.some((it) => it.smooth)) {
      requestAnimationFrame((t) => this.frame(t));
      return;
    }
    const dt = Math.min(0.08, (now - (this.last || now)) / 1000);
    this.last = now;

    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.items = this.items.filter((it) => {
      const alive = now - it.born < it.life;
      if (!alive) it.done?.();
      return alive;
    });
    for (const it of this.items) this.draw(it, (now - it.born) / it.life, dt, now);

    if (this.items.length) {
      requestAnimationFrame((t) => this.frame(t));
    } else {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.running = false;
      this.last = 0;
    }
  }

  draw(it, t, dt, now) {
    const fn = DRAWERS[it.type];
    if (fn) fn(this, it, t, dt, now);
  }
}
