// Lightning, speed lines, zap/hitbox/flare (pure move from fx.js).

import { COLORS, FRAME_MS, lerp, rand, pick } from './primitives.js';

// A jagged polyline from a to b, rolled fresh each call. `zig` makes it swing from side to
// side (mostly) with uneven steps, like drawn lightning, instead of wandering.
export function jag(fx, a, b, jitter, zig = false) {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const n = Math.max(5, Math.round(len / (zig ? 34 : 26)));
    let side = Math.random() < 0.5 ? 1 : -1;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      let t = i / n, off = 0;
      if (i > 0 && i < n) {
        if (zig) {
          t += rand(-0.3, 0.3) / n;
          if (Math.random() < 0.8) side = -side;
          off = side * rand(0.2, 1) * jitter;
        } else {
          off = rand(-1, 1) * jitter;
        }
      }
      pts.push([lerp(a.x, b.x, t) + nx * off, lerp(a.y, b.y, t) + ny * off]);
    }
    return pts;
}

// A polyline thickened into a flat shape, w0 wide at its start tapering to w1 at its end.
export function ribbon(fx, pts, w0, w1, dx = 0, dy = 0) {
    const { ctx } = fx;
    const left = [], right = [];
    pts.forEach(([x, y], i) => {
      const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(bx - ax, by - ay) || 1;
      const w = lerp(w0, w1, i / (pts.length - 1)) / 2;
      const nx = (-(by - ay) / l) * w, ny = ((bx - ax) / l) * w;
      left.push([x + nx + dx, y + ny + dy]);
      right.push([x - nx + dx, y - ny + dy]);
    });
    ctx.beginPath();
    [...left, ...right.reverse()].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
}

// The point a fraction u of the way along a polyline (by index, close enough for a bolt).
export function along(fx, pts, u) {
    const f = Math.min(pts.length - 1.001, Math.max(0, u * (pts.length - 1)));
    const i = Math.floor(f), k = f - i;
    return { x: lerp(pts[i][0], pts[i + 1][0], k), y: lerp(pts[i][1], pts[i + 1][1], k) };
}

export function stroke(fx, pts, color, width, dx = 0, dy = 0) {
    const { ctx } = fx;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
}

export function crackle(fx, it, t, dt, now) {
  const { ctx } = fx;
  const frame = Math.floor((now - it.born) / FRAME_MS);
  if (frame % 4 === 3) return;
  const c = typeof it.at === 'function' ? it.at() : it.at;
  const r = it.radius * (0.45 + t * 0.8);
  ctx.save();
  ctx.lineJoin = 'miter';
  for (let i = 0; i < it.count; i++) {
    const ang = rand(0, Math.PI * 2);
    const from = { x: c.x + Math.cos(ang) * 4, y: c.y + Math.sin(ang) * 4 };
    const to = { x: c.x + Math.cos(ang) * r * rand(0.5, 1), y: c.y + Math.sin(ang) * r * rand(0.5, 1) };
    const pts = jag(fx, from, to, 7, true);
    stroke(fx, pts, COLORS.violet, 3.5, -2, 2);
    stroke(fx, pts, COLORS.red, 2.5);
    stroke(fx, pts, COLORS.paper, 1);
  }
  ctx.restore();
  return;
}

export function bolt(fx, it, t, dt, now) {
  const { ctx } = fx;
  const frame = Math.floor((now - it.born) / FRAME_MS);
  if (frame % 3 === 2) return; // strobes
  const b = typeof it.to === 'function' ? it.to(now) : it.to;
  const len = Math.hypot(b.x - it.from.x, b.y - it.from.y);
  const pts = jag(fx, it.from, b, Math.min(22, Math.max(7, len * 0.06)), true);
  ctx.save();
  ctx.lineJoin = 'miter';
  stroke(fx, pts, COLORS.violet, it.width + 1, -1.5, 1.5);
  stroke(fx, pts, COLORS.red, it.width + 1);
  stroke(fx, pts, COLORS.paper, Math.max(0.8, it.width * 0.35));
  for (let f = 0; f < it.forks; f++) {
    const [fx, fy] = pts[1 + Math.floor(rand(0, pts.length - 2))];
    const a = Math.atan2(b.y - it.from.y, b.x - it.from.x) + rand(-1.1, 1.1);
    const l = rand(20, 55);
    const fork = jag(fx, { x: fx, y: fy }, { x: fx + Math.cos(a) * l, y: fy + Math.sin(a) * l }, 7);
    stroke(fx, fork, COLORS.red, Math.max(1, it.width * 0.6));
    stroke(fx, fork, COLORS.paper, 0.8);
  }
  ctx.restore();
  return;
}

export function lines(fx, it, t, dt, now) {
  const { ctx } = fx;
  const frame = Math.floor((t * it.life) / FRAME_MS);
  if (!it.strokes || it.drawn !== frame >> 1) {
    it.drawn = frame >> 1;
    it.strokes = Array.from({ length: 32 }, () => ({
      a: rand(0, Math.PI * 2),
      w: rand(0.008, 0.026),
      r0: it.inner * rand(1, 1.6),
      color: COLORS[pick(['paper', 'paper', 'paper', 'violet', 'red'])],
    }));
  }
  const outer = it.inner * 3.6;
  ctx.save();
  ctx.globalAlpha = t > 0.7 ? 1 - Math.floor(((t - 0.7) / 0.3) * 3) / 3 : 1;
  for (const s of it.strokes) {
    ctx.beginPath();
    ctx.moveTo(it.x + Math.cos(s.a - s.w) * outer, it.y + Math.sin(s.a - s.w) * outer);
    ctx.lineTo(it.x + Math.cos(s.a) * s.r0, it.y + Math.sin(s.a) * s.r0);
    ctx.lineTo(it.x + Math.cos(s.a + s.w) * outer, it.y + Math.sin(s.a + s.w) * outer);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
  }
  ctx.restore();
  return;
}

export function zap(fx, it, t, dt, now) {
  const { ctx } = fx;
  const el = now - it.born;
  const reach = Math.min(1, el / it.travel);
  const k = 1 - (1 - reach) ** 2; // fast out of her hand, slowing on the way in
  const tip = { x: lerp(it.from.x, it.aim.x, k), y: lerp(it.from.y, it.aim.y, k) };
  const after = Math.max(0, (el - it.travel) / (it.life - it.travel));
  const frame = Math.floor(el / FRAME_MS);
  if (after > 0 && frame % 3 === 2) return; // strobes once it's in
  const len = Math.hypot(tip.x - it.from.x, tip.y - it.from.y);
  if (len < 4) return;
  const w = it.width * (1 - after * 0.8);
  const pts = jag(fx, it.from, tip, Math.min(24, Math.max(6, len * 0.07)), true);
  ctx.save();
  ctx.lineJoin = 'miter';
  ctx.globalAlpha = after > 0.6 ? 1 - Math.floor(((after - 0.6) / 0.4) * 3) / 3 : 1;
  stroke(fx, pts, COLORS.violet, w + 3, -2, 2);
  stroke(fx, pts, COLORS.green, w * 0.6, 2, -1);
  stroke(fx, pts, COLORS.magenta, w + 1);
  stroke(fx, pts, COLORS.paper, Math.max(0.8, w * 0.35));
  for (let f = 0; f < 2; f++) {
    const [fx, fy] = pts[1 + Math.floor(rand(0, pts.length - 2))];
    const a = Math.atan2(tip.y - it.from.y, tip.x - it.from.x) + rand(-1.2, 1.2);
    const l = rand(16, 44);
    const fork = jag(fx, { x: fx, y: fy }, { x: fx + Math.cos(a) * l, y: fy + Math.sin(a) * l }, 6);
    stroke(fx, fork, f ? COLORS.green : COLORS.magenta, Math.max(1, w * 0.55));
  }
  ctx.restore();
  return;
}

export function hitbox(fx, it, t, dt, now) {
  const { ctx } = fx;
  // the window's frame: a zap flashes it and lets it go; a spark snaps it out from the middle
  const { rect, aim } = it;
  const grow = it.kind === 'spark' ? 1 - (1 - Math.min(1, t / 0.35)) ** 3 : 1;
  const x = lerp(aim.x, rect.x, grow), y = lerp(aim.y, rect.y, grow);
  const w = rect.w * grow, h = rect.h * grow;
  const fade = t > 0.55 ? 1 - Math.floor(((t - 0.55) / 0.45) * 4) / 4 : 1;
  const frame = Math.floor((now - it.born) / FRAME_MS);
  ctx.save();
  ctx.globalAlpha = fade;
  if (it.kind === 'zap' && t < 0.4) {
    ctx.fillStyle = COLORS.magenta;
    ctx.globalAlpha = fade * (frame % 2 ? 0.16 : 0.26) * (1 - t / 0.4);
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = fade;
  }
  const jitter = it.kind === 'zap' ? 3 : 2;
  for (const [dx, color] of [[-jitter, COLORS.violet], [jitter, COLORS.green], [0, COLORS.magenta]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = color === COLORS.magenta ? 2.5 : 1.5;
    const c = Math.min(46, w * 0.25, h * 0.25); // corner brackets
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.moveTo(cx + dx + sx * c, cy - dx);
      ctx.lineTo(cx + dx, cy - dx);
      ctx.lineTo(cx + dx, cy - dx + sy * c);
    }
    ctx.stroke();
  }
  if (it.kind === 'zap' && frame % 2 === 0) { // the frame itself, glitching
    ctx.strokeStyle = COLORS.magenta;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + rand(-2, 2), y + rand(-2, 2), w, h);
  }
  ctx.restore();
  return;
}

export function flare(fx, it, t, dt, now) {
  const { ctx } = fx;
  // a four-point star: long thin rays, a hot middle, a ring going out
  const k = Math.floor(t * 8) / 8;
  const r = (it.kind === 'spark' ? 70 : 54) * it.size * (0.4 + k);
  ctx.save();
  ctx.globalAlpha = 1 - k;
  const rays = it.kind === 'spark' ? [0, Math.PI / 2, Math.PI, Math.PI * 1.5] : [Math.PI / 4, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  for (const [a0, color, width] of [[0, COLORS.violet, 7], [0, it.kind === 'spark' ? COLORS.green : COLORS.magenta, 4], [0, COLORS.paper, 1.5]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * (1 - k * 0.6);
    ctx.beginPath();
    for (const a of rays) {
      ctx.moveTo(it.x, it.y);
      ctx.lineTo(it.x + Math.cos(a + a0) * r, it.y + Math.sin(a + a0) * r);
    }
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(it.x, it.y, r * 0.55, 0, Math.PI * 2);
  ctx.strokeStyle = it.kind === 'spark' ? COLORS.green : COLORS.magenta;
  ctx.lineWidth = Math.max(1, 5 * (1 - k));
  ctx.stroke();
  ctx.restore();
  return;
}

export function ring(fx, it, t, dt, now) {
  const { ctx } = fx;
  const k = Math.floor(t * 6) / 6; // six drawings
  const r = (40 + 230 * k) * it.size;
  const lw = Math.max(1, 8 * (1 - k) * it.size);
  ctx.save();
  for (const [dx, color] of [[-3, COLORS.violet], [0, COLORS.red]]) {
    ctx.beginPath();
    ctx.arc(it.x + dx, it.y - dx, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.restore();
  return;
}
