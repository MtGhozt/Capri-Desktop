// Shards, beams, cut-ins, pointer reticle, glyphs (pure move from fx.js).

import { COLORS, FRAME_MS, lerp, rand, shard as drawShard, sparkle, eye, fadeStep } from './primitives.js';
import { stroke } from './electric.js';

const CUTIN = { w: 360, h: 240 }; // assets/capri/cutin-*.png

export function shard(fx, it, t, dt, now) {
  const { ctx } = fx;
  it.x += it.vx * dt;
  it.y += it.vy * dt;
  it.vx *= 0.86;
  it.vy *= 0.86;
  it.rot += it.vr * dt;
  const k = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.rotate(it.rot);
  drawShard(fx, it.len * k, it.wid * k, it.color);
  ctx.restore();
  return;
}

export function beam(fx, it, t, dt, now) {
  const { ctx } = fx;
  const k = it.down ? 1 - t : t;
  const w = it.width * (1 - t) + 2;
  const top = it.down ? it.bottom * k * 0.15 : 0;
  const h = it.bottom - top;
  ctx.save();
  // jagged edges, re-rolled every frame
  const edge = (side) => {
    const pts = [];
    for (let y = top; y <= it.bottom; y += 18) pts.push([it.x + side * (w / 2 + rand(0, w * 0.35)), y]);
    return pts;
  };
  const left = edge(-1), right = edge(1).reverse();
  const poly = (dx) => {
    ctx.beginPath();
    [...left, ...right].forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y) : ctx.moveTo(x + dx, y)));
    ctx.closePath();
  };
  poly(-4);
  ctx.fillStyle = COLORS.violet;
  ctx.fill();
  poly(0);
  ctx.fillStyle = COLORS.red;
  ctx.fill();
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(it.x - Math.max(1, w * 0.12), top, Math.max(2, w * 0.24), h);
  ctx.restore();
  return;
}

export function streak(fx, it, t, dt, now) {
  const { ctx } = fx;
  ctx.save();
  ctx.lineJoin = 'miter';
  ctx.globalAlpha = 1 - t * 0.6;
  stroke(fx, it.pts, COLORS.violet, 5, -3, 3);
  stroke(fx, it.pts, COLORS.red, 4);
  stroke(fx, it.pts, COLORS.paper, 1.2);
  ctx.restore();
  return;
}

export function slice(fx, it, t, dt, now) {
  const { ctx } = fx;
  ctx.fillStyle = it.color;
  ctx.globalAlpha = 1 - t;
  ctx.fillRect(it.x + it.dx * t, it.y, it.w, it.h);
  ctx.globalAlpha = 1;
  return;
}

export function slit(fx, it, t, dt, now) {
  const { ctx } = fx;
  const k = Math.floor(t * 5) / 5; // closes in five drawings
  const w = Math.max(3, it.width * (1 - k));
  const h = it.bottom - it.top;
  ctx.fillStyle = COLORS.violet;
  ctx.fillRect(it.x - w / 2 - 3, it.top, w + 6, h);
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(it.x - w / 2, it.top, w, h);
  ctx.fillStyle = COLORS.red;
  ctx.fillRect(it.x - 1, it.top + h * 0.08, 2, h * 0.84);
  return;
}

export function vortex(fx, it, t, dt, now) {
  const { ctx } = fx;
  const k = Math.floor(t * 8) / 8; // eight drawings
  for (const p of it.ps) {
    const ang = p.a + k * 4.2;
    const rr = it.radius * p.r * (1 - k);
    const px = it.x + Math.cos(ang) * rr, py = it.y + Math.sin(ang) * rr * 0.85;
    if (p.eye) {
      sparkle(fx, px, py, 11 * (1 - k) + 3, COLORS.green, COLORS.ink);
    } else {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang + Math.PI / 2);
      drawShard(fx, p.len * (1 - k * 0.6), p.wid * (1 - k * 0.5), p.color);
      ctx.restore();
    }
  }
  return;
}

export function drift(fx, it, t, dt, now) {
  const { ctx } = fx;
  // moved on twos, like the body it came from
  const age = Math.floor((t * it.life) / 1000 * 12) / 12;
  const k = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  ctx.save();
  ctx.translate(Math.round(it.x + it.vx * age), Math.round(it.y + it.vy * age));
  ctx.rotate(it.rot + it.vr * age);
  drawShard(fx, it.len * (0.6 + 0.4 * k), it.wid * k, it.color);
  ctx.restore();
  return;
}

export function cutin(fx, it, t, dt, now) {
  const { ctx } = fx;
  const W = 250, H = 96, skew = 24;
  // three-frame wipe in, two-frame squash out
  const open = t < 0.06 ? 0.3 : t < 0.12 ? 0.7 : 1;
  const tall = t > 0.9 ? 0.12 : t > 0.82 ? 0.5 : 1;
  const w = W * open, h = H * tall;
  const x0 = it.dir > 0 ? it.x : it.x - w;
  const y0 = it.y - h / 2;
  const band = (dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(x0 + skew + dx, y0 + dy);
    ctx.lineTo(x0 + w + skew + dx, y0 + dy);
    ctx.lineTo(x0 + w + dx, y0 + h + dy);
    ctx.lineTo(x0 + dx, y0 + h + dy);
    ctx.closePath();
  };
  ctx.save();
  band(6, 6);
  ctx.fillStyle = COLORS.violet;
  ctx.fill();
  band(0, 0);
  ctx.fillStyle = COLORS.ink;
  ctx.fill();
  ctx.clip();
  // speed lines, re-drawn every frame, rushing away from her
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = i % 3 ? COLORS.red : COLORS.paper;
    ctx.fillRect(x0 + rand(-20, w), y0 + rand(0, h), rand(30, 110), rand(1, 3));
  }
  // the close-up, pushed in a little more every frame, shaking on ones
  const zoom = ((h * 1.1) / CUTIN.h) * (1 + t * 0.08);
  const fw = CUTIN.w * zoom, fh = CUTIN.h * zoom;
  const cx = x0 + w / 2 + skew / 2 + rand(-2, 2), cy = y0 + h / 2 + rand(-2, 2);
  ctx.drawImage(it.image, cx - fw / 2, cy - fh / 2, fw, fh);
  ctx.fillStyle = COLORS.red;
  ctx.fillRect(x0, y0, w + skew, 3);
  ctx.restore();
  return;
}

export function pointer(fx, it, t, dt, now) {
  const { ctx } = fx;
  const fade = fadeStep(fx, it, now, 260);
  if (!fade) return;
  const { w: vw, h: vh } = fx.size || { w: 1e5, h: 1e5 };
  const age = now - it.born;
  const frame = Math.floor(age / FRAME_MS);
  // reeling back in: the wire shortens toward her finger over four drawings, then it's gone
  const back = it.retractAt ? Math.floor((now - it.retractAt) / FRAME_MS) / 4 : 0;
  if (back >= 1) {
    it.life = 0;
    return;
  }
  const a = it.from(), b = it.aim;
  const grow = Math.min(1, (frame + 1) / 2) * (1 - back);
  const ex = lerp(a.x, b.x, grow), ey = lerp(a.y, b.y, grow);
  const off = it.rect.y > vh - 2 ? [0, 1] : it.rect.y + it.rect.h < 2 ? [0, -1] : it.rect.x > vw - 2 ? [1, 0] : it.rect.x + it.rect.w < 2 ? [-1, 0] : null;
  ctx.save();
  ctx.globalAlpha = fade;

  // the wire, dashes crawling toward it on twos, and data running down it
  ctx.setLineDash([9, 6]);
  ctx.lineDashOffset = -Math.floor(frame / 2) * 5;
  const line = [[a.x, a.y], [ex, ey]];
  stroke(fx, line, COLORS.violet, 4, -2, 2);
  stroke(fx, line, COLORS.paper, 2);
  ctx.setLineDash([]);
  if (!back) {
    for (let i = 0; i < 3; i++) {
      const u = (Math.floor(frame / 2) * 0.06 + i / 3) % 1;
      if (u > grow) continue;
      const px = lerp(a.x, b.x, u), py = lerp(a.y, b.y, u);
      ctx.fillStyle = COLORS.violet;
      ctx.fillRect(Math.round(px) - 3, Math.round(py) - 1, 5, 5);
      ctx.fillStyle = i ? COLORS.green : COLORS.paper;
      ctx.fillRect(Math.round(px) - 2, Math.round(py) - 2, 5, 5);
    }
  }

  if (grow >= 1 && !off) {
    // arrowhead, with its violet copy
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    for (const [dx, dy, color] of [[-2, 2, COLORS.violet], [0, 0, COLORS.red]]) {
      ctx.beginPath();
      ctx.moveTo(b.x + dx, b.y + dy);
      ctx.lineTo(b.x - Math.cos(ang - 0.45) * 16 + dx, b.y - Math.sin(ang - 0.45) * 16 + dy);
      ctx.lineTo(b.x - Math.cos(ang + 0.45) * 16 + dx, b.y - Math.sin(ang + 0.45) * 16 + dy);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  // the reticle: comes in from wide and slams on (four drawings), bounces once, then holds.
  // A tap makes it pulse; letting go, it opens back out.
  const SLAM = [64, 36, 16, 4, 11, 7];
  const tapK = it.tapAt ? Math.floor((now - it.tapAt) / FRAME_MS) : 99;
  let pad = frame < SLAM.length ? SLAM[frame] : 7;
  if (tapK < 2) pad += 6;
  if (back) pad += back * 60;
  const x0 = Math.max(4, it.rect.x - pad), y0 = Math.max(4, it.rect.y - pad);
  const x1 = Math.min(vw - 4, it.rect.x + it.rect.w + pad), y1 = Math.min(vh - 4, it.rect.y + it.rect.h + pad);
  const flash = frame < 5 || tapK < 2; // white as it lands
  if ((frame % 8 !== 7 || frame < 8) && x1 > x0 && y1 > y0) {
    const arm = Math.min(28, (x1 - x0) / 3, (y1 - y0) / 3);
    const corners = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]];
    for (const [dx, dy, color, width] of [[-2, 2, COLORS.violet, 5], [0, 0, flash ? COLORS.paper : COLORS.red, 4]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (const [cx, cy, sx, sy] of corners) {
        ctx.beginPath();
        ctx.moveTo(cx + dx, cy + sy * arm + dy);
        ctx.lineTo(cx + dx, cy + dy);
        ctx.lineTo(cx + sx * arm + dx, cy + dy);
        ctx.stroke();
      }
    }
    // two of her eyes open on its corners and watch it, blinking now and then
    if (!back && frame >= 6 && x1 - x0 > 90 && y1 - y0 > 60) {
      const open = Math.min(1, (frame - 6) / 3);
      const blink = frame % 70 > 66 ? 0.15 : 1;
      const center = { x: it.rect.x + it.rect.w / 2, y: it.rect.y + it.rect.h / 2 };
      eye(fx, x1 - 4, y0 + 4, 8, open * blink, center);
      eye(fx, x0 + 4, y1 - 4, 8, open * blink, center);
    }
  }

  // off her screen: an arrow on the edge, bobbing on twos, pointing the rest of the way
  let tagAt = null;
  if (off && grow >= 1) {
    const bob = Math.floor(frame / 2) % 2 ? 3 : 0;
    const px = clamp(it.rect.x + it.rect.w / 2, 14, vw - 14) - off[0] * (14 + bob);
    const py = clamp(it.rect.y + it.rect.h / 2, 14, vh - 14) - off[1] * (14 + bob);
    tagAt = { x: px - off[0] * 50, y: py - off[1] * 30 };
    const ang2 = Math.atan2(off[1], off[0]);
    for (const [dx, dy, color] of [[-2, 2, COLORS.violet], [0, 0, flash ? COLORS.paper : COLORS.red]]) {
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(ang2) * 13 + dx, py + Math.sin(ang2) * 13 + dy);
      ctx.lineTo(px + Math.cos(ang2 + 2.4) * 13 + dx, py + Math.sin(ang2 + 2.4) * 13 + dy);
      ctx.lineTo(px + Math.cos(ang2 - 2.4) * 13 + dx, py + Math.sin(ang2 - 2.4) * 13 + dy);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  // the word, on a red tag: at the reticle's top corner (under it at the top of the screen),
  // or next to the edge arrow; it drops in once the reticle has landed
  if (it.label && !back && frame >= 4 && (x1 > x0 || tagAt)) {
    ctx.font = '600 11px "JetBrains Mono", monospace';
    const tw = ctx.measureText(it.label).width + 14;
    const drop = frame < 6 ? (6 - frame) * 4 : 0;
    const tx = clamp(tagAt ? tagAt.x - tw / 2 : x0, 4, vw - tw - 4);
    const ty = (tagAt ? clamp(tagAt.y - 10, 4, vh - 23) : y0 > 30 ? y0 - 24 : y1 + 6) - drop;
    ctx.fillStyle = COLORS.violet;
    ctx.fillRect(tx - 2, ty + 2, tw, 19);
    ctx.fillStyle = COLORS.red;
    ctx.fillRect(tx, ty, tw, 19);
    ctx.fillStyle = COLORS.paper;
    ctx.fillText(it.label, tx + 7, ty + 13.5);
  }
  ctx.restore();
  return;
}

export function glyph(fx, it, t, dt, now) {
  const { ctx } = fx;
  ctx.save();
  ctx.font = '600 11px "JetBrains Mono", monospace';
  ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
  // stepped rise: whole pixels, every frame
  const y = Math.round(it.y - t * 46);
  const x = Math.round(it.x + it.drift * t);
  ctx.fillStyle = COLORS.violet;
  ctx.fillText(it.text, x - 1, y + 1);
  ctx.fillStyle = COLORS.green;
  ctx.fillText(it.text, x, y);
  ctx.restore();
  return;
}
