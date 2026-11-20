// Satellite, mane motes, surge bolt, and window possession (pure move from fx.js).

import { COLORS, FRAME_MS, lerp, onTwos, rand, pick, sparkle, eye, fadeStep } from './primitives.js';
import { jag, ribbon, along, stroke } from './electric.js';

// A window she's in (see possess()): what's drawn on it, in screen coordinates.
export function possession(fx, it, r, now, leaving) {
    const { ctx } = fx;
    const age = now - it.born;
    const frame = Math.floor(age / FRAME_MS);
    const look = it.look();

    // an impact frame as she hits it
    if (frame === 0) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }

    // slices of it knocked sideways, re-rolled every other drawing
    if (!it.slices || it.drawn !== frame >> 1) {
      it.drawn = frame >> 1;
      it.slices = Array.from({ length: leaving >= 0 ? 2 : 6 }, () => ({
        y: rand(0, r.h), h: rand(2, 9), x: rand(-0.1, 0.7), w: rand(0.2, 0.6),
        color: COLORS[pick(['red', 'red', 'green', 'violet', 'paper'])],
      }));
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.globalAlpha = 0.9;
    for (const s of it.slices) {
      ctx.fillStyle = s.color;
      ctx.fillRect(r.x + s.x * r.w, r.y + s.y, s.w * r.w, s.h);
    }
    ctx.restore();

    // its frame: lightning racing round from where she dove in, both ways, struck fresh every drawing
    const P = 2 * (r.w + r.h);
    const grow = leaving >= 0 ? Math.max(0, 1 - leaving / (FRAME_MS * 5)) : Math.min(1, (frame + 1) / 8);
    const edge = (s) => {
      s = ((s % P) + P) % P;
      if (s < r.w) return { x: r.x + s, y: r.y, nx: 0, ny: -1 };
      if (s < r.w + r.h) return { x: r.x + r.w, y: r.y + s - r.w, nx: 1, ny: 0 };
      if (s < 2 * r.w + r.h) return { x: r.x + r.w - (s - r.w - r.h), y: r.y + r.h, nx: 0, ny: 1 };
      return { x: r.x, y: r.y + r.h - (s - 2 * r.w - r.h), nx: -1, ny: 0 };
    };
    const half = (grow * P) / 2;
    ctx.save();
    ctx.lineJoin = 'miter';
    for (const way of [1, -1]) {
      const n = Math.max(2, Math.ceil(half / 28));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const p = edge(it.entry + way * half * (i / n));
        const off = i === 0 || i === n ? 0 : (i % 2 ? 1 : -1) * rand(2, 7);
        pts.push([p.x + p.nx * off, p.y + p.ny * off]);
      }
      stroke(fx, pts, COLORS.violet, 5, -2, 2);
      stroke(fx, pts, COLORS.red, 3.5);
      stroke(fx, pts, COLORS.paper, 1.2);
    }
    ctx.restore();

    // her face in it: the eyes open in three drawings, blink once, shut as she leaves
    const stepOf = (ms) => Math.floor(ms / (FRAME_MS * 2));
    let open = age < 250 ? 0 : [0.25, 0.6, 1][Math.min(2, stepOf(age - 250))];
    if (age > 1150 && age < 1150 + FRAME_MS * 4) open = 0.12;
    if (leaving >= 0) open = [0.6, 0.2, 0][Math.min(2, stepOf(leaving))];
    if (!open) return;
    const R = Math.max(20, Math.min(72, Math.min(r.w, r.h) * 0.13));
    const cx = r.x + r.w / 2 + rand(-1.5, 1.5), cy = r.y + r.h * 0.46 + rand(-1.5, 1.5); // shaking on ones
    for (const e of it.extra) {
      if (age < e.at) continue;
      const k = leaving >= 0 ? open : Math.min(1, (stepOf(age - e.at) + 1) / 3);
      eye(fx, r.x + e.u * r.w, r.y + e.v * r.h, R * e.size, k, look);
    }
    eye(fx, cx - R * 1.6, cy - R * 0.3, R, open, look);
    eye(fx, cx + R * 1.6, cy - R * 0.3, R, open, look);
    if (open >= 0.6) {
      // the zigzag grin
      const pts = Array.from({ length: 7 }, (_, i) => [cx - R * 2.4 + (i * R * 4.8) / 6, cy + R * 1.4 + (i % 2 ? R * 0.6 : -R * 0.1)]);
      ctx.save();
      ctx.lineJoin = 'miter';
      stroke(fx, pts, COLORS.violet, R * 0.42, -3, 3);
      stroke(fx, pts, COLORS.ink, R * 0.42);
      stroke(fx, pts, COLORS.paper, R * 0.22);
      ctx.restore();
    }
}

export function motes(fx, it, t, dt, now) {
  const { ctx } = fx;
  const age = now - it.born;
  const frame = Math.floor(age / FRAME_MS);
  const step = (since, ms) => Math.min(1, Math.max(0, onTwos(since) / ms)); // 0..1, on twos
  const road = it.ends?.();
  let nx = 0, ny = 0;
  if (road) {
    const [a, b] = road;
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    nx = -(b.y - a.y) / l;
    ny = (b.x - a.x) / l;
  }
  const pos = it.ps.map((p) => {
    // up off her mane with a slow-in, then swaying
    const e = 1 - Math.pow(1 - step(age - p.delay, 1100), 3);
    let x = lerp(p.x0, p.x1, e) + Math.sin(onTwos(age) / 650 + p.phase) * 4 * e;
    let y = lerp(p.y0, p.y1, e);
    if (road) {
      // into line, the ones nearest her first
      const u = step(now - it.alignAt - p.u * 300, 450);
      const k = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const [a, b] = road;
      x = lerp(x, lerp(a.x, b.x, p.u) + nx * p.off, k);
      y = lerp(y, lerp(a.y, b.y, p.u) + ny * p.off, k);
    }
    if (it.homeAt) {
      const k = step(now - it.homeAt - p.u * 160, 330);
      x = lerp(x, p.x0 + it.shift[0], k * k);
      y = lerp(y, p.y0 + it.shift[1], k * k);
    }
    return { x, y };
  });
  if (it.homeAt && now - it.homeAt > 160 + 330 + FRAME_MS * 2) {
    it.life = 0;
    return;
  }
  ctx.save();
  // the constellation, a line at a time once they're up, gone when they line up;
  // white over a violet copy, so it reads on a dark desktop and a light one
  if (!it.alignAt || now - it.alignAt < 160) {
    ctx.lineWidth = 1;
    it.links.forEach(([i, j], n) => {
      if (onTwos(age) < 900 + n * 60) return;
      for (const [d, color] of [[1, COLORS.violet], [0, COLORS.paper]]) {
        ctx.beginPath();
        ctx.moveTo(Math.round(pos[i].x) + 0.5 - d, Math.round(pos[i].y) + 0.5 + d);
        ctx.lineTo(Math.round(pos[j].x) + 0.5 - d, Math.round(pos[j].y) + 0.5 + d);
        ctx.strokeStyle = color;
        ctx.globalAlpha = d ? 1 : 0.75;
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }
  it.ps.forEach((p, i) => {
    const { x, y } = pos[i];
    let s = (frame + Math.round(p.phase * 3)) % 6 < 3 ? p.size : p.size * 0.6;
    // the light going up lights them as it passes, and they stay bright while it holds
    if (it.litAt && !it.homeAt && !(it.dimAt && now > it.dimAt)) {
      const since = now - it.litAt - p.u * it.litMs;
      if (since >= 0) s = since < FRAME_MS * 2 ? p.size * 3 : p.size * (frame % 2 ? 1.8 : 1.5);
    }
    ctx.fillStyle = COLORS.violet;
    ctx.fillRect(Math.round(x - s / 2) - 1, Math.round(y - s / 2) + 1, s, s);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
    if (s > 3) {
      ctx.fillRect(Math.round(x - s), Math.round(y) - 0.5, s * 2, 1);
      ctx.fillRect(Math.round(x) - 0.5, Math.round(y - s), 1, s * 2);
    }
  });
  // her fingertip, where the road starts, glinting on threes
  if (road && !it.homeAt) {
    sparkle(fx, road[0].x, road[0].y, [6, 9, 5, 10][Math.floor(frame / 3) % 4], COLORS.paper, COLORS.red);
  }
  ctx.restore();
  return;
}

export function satellite(fx, it, t, dt, now) {
  const { ctx } = fx;
  const fade = fadeStep(fx, it, now, 500);
  if (!fade) return;
  const age = now - it.born;
  const frame = Math.floor(age / FRAME_MS);
  const { x, y } = it.pos(now);
  const rays = (ray, w) => {
    for (const [dx, dy, color] of [[-2, 2, COLORS.violet], [0, 0, COLORS.paper]]) {
      ctx.fillStyle = color;
      ctx.fillRect(x - ray + dx, y - w / 2 + dy, ray * 2, w);
      ctx.fillRect(x - w / 2 + dx, y - ray + dy, w, ray * 2);
    }
  };
  ctx.save();
  ctx.globalAlpha = fade;
  // trail: where it was, a dot every few drawings back
  for (let k = 1; k <= 5; k++) {
    const p = it.pos(now - onTwos(k * 140));
    ctx.fillStyle = k % 2 ? COLORS.violet : COLORS.paper;
    const s = Math.max(1, 3.4 - k * 0.5);
    ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
  }
  const since = it.flare ? now - it.flare.at : Infinity;
  if (since < 460) {
    // a big four-point flare with long rays, shrinking over seven drawings
    const k = Math.floor(since / (FRAME_MS * 2));
    const size = [44, 38, 32, 26, 20, 16, 13][Math.min(6, k)] * it.flare.size;
    rays(size * 3, 2);
    sparkle(fx, x, y, size, COLORS.paper, COLORS.red);
  } else {
    // blinks in (a speck, a flash, settling), then glints on threes
    const size = frame < 8 ? [2, 3, 20, 20, 14, 14, 11, 11][frame] : [8, 11, 7, 12][Math.floor(frame / 3) % 4];
    if (size >= 14) rays(size * 2.4, 2);
    sparkle(fx, x, y, size, COLORS.paper);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(Math.round(x) - 1.5, Math.round(y) - 1.5, 3, 3);
  }
  ctx.restore();
  return;
}

export function surge(fx, it, t, dt, now) {
  const { ctx } = fx;
  const [a, b] = it.ends();
  ctx.save();
  ctx.lineJoin = 'miter';
  if (it.breakAt) {
    // snapped: one white drawing, then the pieces fall, fading out in four steps
    const pts = it.pts || [[a.x, a.y], [b.x, b.y]];
    it.pieces ||= pts.slice(1).map((end, i) => ({
      a: pts[i], b: end,
      vx: rand(-50, 50), vy: rand(-80, 0), vr: rand(-4, 4),
      w: lerp(22, 7, i / (pts.length - 1)),
    }));
    const since = now - it.breakAt;
    const k = since / 620;
    if (k >= 1) {
      it.life = 0;
      ctx.restore();
      return;
    }
    if (since < FRAME_MS) stroke(fx, pts, COLORS.paper, 7);
    const tau = onTwos(since) / 1000;
    ctx.globalAlpha = 1 - Math.floor(k * 4) / 4;
    for (const pc of it.pieces) {
      const mx = (pc.a[0] + pc.b[0]) / 2 + pc.vx * tau;
      const my = (pc.a[1] + pc.b[1]) / 2 + pc.vy * tau + 450 * tau * tau;
      const hx = ((pc.b[0] - pc.a[0]) / 2) * (1 - k * 0.4), hy = ((pc.b[1] - pc.a[1]) / 2) * (1 - k * 0.4);
      const c = Math.cos(pc.vr * tau), s = Math.sin(pc.vr * tau);
      const rx = hx * c - hy * s, ry = hx * s + hy * c;
      const seg = [[mx - rx, my - ry], [mx + rx, my + ry]];
      const w = pc.w * (1 - k * 0.5);
      stroke(fx, seg, COLORS.violet, w + 2, -2, 2);
      stroke(fx, seg, COLORS.red, w);
      stroke(fx, seg, COLORS.paper, Math.max(1, w * 0.2));
    }
    ctx.restore();
    return;
  }
  const frame = Math.floor((now - it.born) / FRAME_MS);
  const reach = [0.4, 0.74, 1][Math.min(2, frame)];
  const end = { x: lerp(a.x, b.x, reach), y: lerp(a.y, b.y, reach) };
  if (reach === 1 && it.onHit) {
    const hit = it.onHit;
    it.onHit = null;
    hit();
  }
  const len = Math.hypot(end.x - a.x, end.y - a.y);
  const pts = jag(fx, a, end, Math.min(24, Math.max(10, len * 0.05)), true);
  it.pts = pts;
  if (frame === 0) {
    // impact frame: the bolt in negative
    ribbon(fx, pts, 40, 22);
    ctx.fillStyle = COLORS.ink;
    ctx.fill();
    ribbon(fx, pts, 10, 4);
    ctx.fillStyle = COLORS.paper;
    ctx.fill();
  } else {
    const k = frame % 2 ? 1 : 0.75; // throbs on ones
    ribbon(fx, pts, 26 * k, 8 * k, -4, 4);
    ctx.fillStyle = COLORS.violet;
    ctx.fill();
    ribbon(fx, pts, 26 * k, 8 * k);
    ctx.fillStyle = COLORS.red;
    ctx.fill();
    ribbon(fx, pts, 8 * k, 2.5);
    ctx.fillStyle = COLORS.paper;
    ctx.fill();
    for (let f = 0; f < 3; f++) {
      const from = along(fx, pts, rand(0.1, 0.9));
      const ang = Math.atan2(b.y - a.y, b.x - a.x) + rand(-1.2, 1.2);
      const l = rand(24, 70);
      const fork = jag(fx, from, { x: from.x + Math.cos(ang) * l, y: from.y + Math.sin(ang) * l }, 9, true);
      stroke(fx, fork, COLORS.violet, 4, -2, 2);
      stroke(fx, fork, COLORS.red, 3);
      stroke(fx, fork, COLORS.paper, 1);
    }
    // light running up it, toward the sky
    if (reach === 1) {
      for (let i = 0; i < 2; i++) {
        const p = along(fx, pts, ((frame - 2) * 0.11 + i * 0.5) % 1);
        sparkle(fx, p.x, p.y, 9, COLORS.paper, COLORS.red);
      }
    }
  }
  ctx.restore();
  return;
}

export function possess(fx, it, t, dt, now) {
  const { ctx } = fx;
  const r = it.rect();
  const leaving = it.leaveAt ? now - it.leaveAt : -1;
  if (!r || leaving > FRAME_MS * 6) {
    it.life = 0;
    return;
  }
  // drawn on its own canvas so the windows in front of it can be cut out
  const M = 16, dpr = window.devicePixelRatio || 1;
  const cw = Math.ceil(r.w + M * 2), ch = Math.ceil(r.h + M * 2);
  it.off ||= document.createElement('canvas');
  if (it.off.width !== Math.round(cw * dpr) || it.off.height !== Math.round(ch * dpr)) {
    it.off.width = Math.round(cw * dpr);
    it.off.height = Math.round(ch * dpr);
  }
  const o = it.off.getContext('2d');
  o.setTransform(dpr, 0, 0, dpr, 0, 0);
  o.clearRect(0, 0, cw, ch);
  o.translate(M - r.x, M - r.y);
  fx.ctx = o; // the drawing helpers draw on fx.ctx
  try {
    possession(fx, it, r, now, leaving);
  } finally {
    fx.ctx = ctx;
  }
  o.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const c of it.covers()) o.clearRect(c.x - r.x + M, c.y - r.y + M, c.w, c.h);
  ctx.drawImage(it.off, r.x - M, r.y - M, cw, ch);
  return;
}
