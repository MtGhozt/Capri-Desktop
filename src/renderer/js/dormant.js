// Compact CAPRI // DORMANT capsule. Separate from the biochip (chip.js).

import { clamp, reducedMotion, sleep, tween } from './util.js';
import { statusText } from './state.js';

const RED = '#FF004D';
const GREEN = '#33FF88';
const EYE = '#000011';
const IRIS = '#3D8CFF';
const PUPIL = '#07070f';
const GOLD = '#FFD700';
const PURPLE = '#C44DFF';
const PIXELS = ['#FFD700', '#FF004D', '#33FF88'];
const FRAME = 1000 / 30;
const BOIL = 1000 / 10;
const CSS = 104;
const TURN_MS = 8000;
const SHARDS = 9;

export class DormantWidget {
  constructor({ el, host }) {
    this.el = el;
    this.host = host;
    this.open = false;
    this.fx = true;
    this.mode = 'DORMANT';
    this.x = 0;
    this.y = 0;
    this.view = { w: innerWidth, h: innerHeight };
    this.onOpenChange = null;
    this.onWake = null;
    this.labelEl = el.querySelector('.dormant__state');
    this.canvas = el.querySelector('.dormant__star');
    this.ctx = this.canvas.getContext('2d');
    this.born = 0;
    this.lastDraw = 0;
    this.lastBoil = 0;
    this.starAlpha = 1;
    this.glitchUntil = 0;
    this.nextGlitch = 0;
    this.nextBlink = 0;
    this.blinkUntil = 0;
    this.swap = false;
    this.particles = [];
    this.shards = [];
    this.loop = this.loop.bind(this);
    this.seedShards();

    this.el.addEventListener('click', (e) => {
      if (this.dragged) return;
      e.stopPropagation();
      this.onWake?.();
    });
    this.bindDrag();
  }

  get visible() {
    return this.open;
  }

  setFx(on) {
    this.fx = on !== false;
  }

  setLabel(state, pct) {
    this.mode = state || 'DORMANT';
    if (this.labelEl) this.labelEl.textContent = statusText(state, pct);
  }

  seedShards() {
    this.shards = [];
    for (let i = 0; i < SHARDS; i++) {
      this.shards.push({
        home: (i / SHARDS) * Math.PI * 2 - Math.PI / 2 + (Math.random() - 0.5) * 0.2,
        color: i % 2 === 0 ? RED : GREEN,
        fork: i === 1 || i === 4 || i === 7,
        a: 0,
        len: 22,
        inner: 14,
        w: 1.8,
      });
    }
    this.boil();
  }

  boil() {
    for (const s of this.shards) {
      s.a = s.home + (Math.random() - 0.5) * 0.55;
      s.len = 16 + Math.random() * 16;
      s.inner = 12 + Math.random() * 5;
      s.w = 1.2 + Math.random() * 1.5;
    }
  }

  show() {
    this.open = true;
    this.starAlpha = 1;
    this.el.classList.remove('is-line');
    this.el.hidden = false;
    this.place();
    this.born = performance.now();
    this.lastBoil = this.born;
    this.nextGlitch = this.born + 400;
    this.nextBlink = this.born + 3000 + Math.random() * 2000;
    this.particles.length = 0;
    this.boil();
    this.onOpenChange?.(true);
    requestAnimationFrame(this.loop);
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('is-line');
    this.el.hidden = true;
    this.particles.length = 0;
    this.onOpenChange?.(false);
  }

  async burst() {
    if (!this.open) return;
    const live = this.liveFx();
    this.swap = live;
    this.glitchUntil = performance.now() + 240;
    this.nextGlitch = this.glitchUntil + 2000;
    if (!live) {
      this.el.classList.add('is-line');
      this.starAlpha = 0;
      return;
    }
    await sleep(200);
    await tween(this, { starAlpha: 0 }, 80);
    this.el.classList.add('is-line');
    await sleep(50);
  }

  setView(w, h) {
    this.view = { w, h };
    this.x = clamp(this.x, 8, Math.max(8, w - this.el.offsetWidth - 8));
    this.y = clamp(this.y, 8, Math.max(8, h - this.el.offsetHeight - 8));
    this.place();
  }

  loadPos(widget, w, h) {
    this.view = { w, h };
    if (widget && Number.isFinite(widget.x) && Number.isFinite(widget.y)) {
      this.x = widget.x;
      this.y = widget.y;
    } else {
      this.x = Math.max(8, w - 140);
      this.y = Math.max(8, h - 150);
    }
    this.place();
  }

  contains(x, y, pad = 0) {
    if (!this.open) return false;
    const r = this.el.getBoundingClientRect();
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  rect() {
    if (!this.open || this.el.hidden) return null;
    return this.el.getBoundingClientRect();
  }

  place() {
    this.el.style.transform = `translate3d(${Math.round(this.x)}px, ${Math.round(this.y)}px, 0)`;
  }

  liveFx() {
    return this.fx && !reducedMotion.matches;
  }

  loop(now) {
    if (!this.open) return;
    requestAnimationFrame(this.loop);
    if (now - this.lastDraw < FRAME - 1) return;
    this.lastDraw = now;
    this.draw(now);
  }

  draw(now) {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(CSS * dpr);
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CSS, CSS);

    const live = this.liveFx();
    if (live && now - this.lastBoil >= BOIL) {
      this.lastBoil = now;
      this.boil();
    }
    if (live && now > this.nextBlink) {
      this.blinkUntil = now + 120;
      this.nextBlink = now + 3000 + Math.random() * 2000;
    }
    if (live && now > this.nextGlitch) {
      const peak = Math.random() < 0.35;
      this.glitchUntil = now + (peak ? 180 : 70);
      this.swap = peak;
      this.nextGlitch = now + 1800 + Math.random() * 2200;
    }
    const peak = live && now < this.glitchUntil;
    if (!peak) this.swap = false;
    const spin = live ? -((now - this.born) / TURN_MS) * Math.PI * 2 : 0;
    const blink = (!live || now >= this.blinkUntil) ? 1 : 0.08;
    const cx = CSS / 2;
    const cy = CSS / 2;
    const rim = (this.mode === 'LISTENING' || this.mode === 'THINKING') ? GOLD : PURPLE;

    if (live) this.tickParticles(cx, cy);

    ctx.save();
    ctx.globalAlpha = this.starAlpha;
    ctx.translate(cx, cy);
    ctx.rotate(spin);

    if (peak || (live && Math.random() < 0.55)) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      this.drawShards(ctx, -1.6, 0);
      this.drawShards(ctx, 1.6, 0);
      ctx.restore();
    }
    this.drawShards(ctx, 0, 0);
    ctx.rotate(-spin);
    this.eye(ctx, blink, rim);
    ctx.restore();

    if (live && this.starAlpha > 0.05) {
      this.paintParticles(ctx);
      if (peak || Math.random() < 0.45) this.slices(ctx, canvas, dpr, peak);
    }
  }

  drawShards(ctx, dx, dy) {
    ctx.save();
    ctx.translate(dx, dy);
    for (const s of this.shards) {
      let fill = s.color;
      if (this.swap) fill = fill === RED ? GREEN : RED;
      ctx.save();
      ctx.rotate(s.a);
      this.shardPath(ctx, s);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = '#0a0010';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  shardPath(ctx, s) {
    const inner = s.inner;
    const tip = inner + s.len;
    const w = s.w;
    ctx.beginPath();
    if (s.fork) {
      const spread = w * 1.8;
      ctx.moveTo(-w, -inner);
      ctx.lineTo(0, -inner - s.len * 0.28);
      ctx.lineTo(-spread, -tip);
      ctx.closePath();
      ctx.moveTo(w, -inner);
      ctx.lineTo(0, -inner - s.len * 0.28);
      ctx.lineTo(spread, -tip);
      ctx.closePath();
    } else {
      ctx.moveTo(-w, -inner);
      ctx.lineTo(w, -inner);
      ctx.lineTo(0, -tip);
      ctx.closePath();
    }
  }

  eye(ctx, blink, rim) {
    const diamond = () => {
      ctx.beginPath();
      ctx.moveTo(0, -8.2);
      ctx.lineTo(7.4, 0);
      ctx.lineTo(0, 8.2);
      ctx.lineTo(-7.4, 0);
      ctx.closePath();
    };
    ctx.save();
    ctx.scale(1, blink);
    diamond();
    ctx.fillStyle = EYE;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 4.1, 0, Math.PI * 2);
    ctx.fillStyle = IRIS;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0.15, 1.85, 0, Math.PI * 2);
    ctx.fillStyle = PUPIL;
    ctx.fill();
    if (blink > 0.4) {
      ctx.beginPath();
      ctx.arc(1.15, -1.2, 1.05, 0, Math.PI * 2);
      ctx.fillStyle = '#d6eeff';
      ctx.fill();
    }
    ctx.restore();
    diamond();
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.15;
    ctx.stroke();
  }

  tickParticles(cx, cy) {
    const dt = FRAME / 1000;
    this.particles = this.particles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      return p.life > 0;
    });
    while (this.particles.length < 8 && Math.random() < 0.28) {
      const a = Math.random() * Math.PI * 2;
      const sp = 18 + Math.random() * 28;
      const life = 0.45 + Math.random() * 0.55;
      this.particles.push({
        x: cx + Math.cos(a) * 8,
        y: cy + Math.sin(a) * 8,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        max: life,
        size: 1 + Math.floor(Math.random() * 2),
        color: PIXELS[Math.floor(Math.random() * PIXELS.length)],
      });
    }
  }

  paintParticles(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = this.starAlpha * (p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  slices(ctx, canvas, dpr, peak) {
    const n = peak ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const h = (peak ? 3 : 2) + Math.random() * (peak ? 7 : 3);
      const y = 12 + Math.random() * (CSS - 28);
      const dx = (Math.random() < 0.5 ? -1 : 1) * (peak ? 4 + Math.random() * 8 : 2 + Math.random() * 3);
      ctx.drawImage(
        canvas,
        0, y * dpr, CSS * dpr, h * dpr,
        dx, y, CSS, h,
      );
    }
  }

  bindDrag() {
    let start = null;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragged = false;
      start = { x: e.clientX, y: e.clientY, ox: this.x, oy: this.y };
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 4) this.dragged = true;
      if (!this.dragged) return;
      const w = this.el.offsetWidth;
      const h = this.el.offsetHeight;
      this.x = clamp(start.ox + dx, 8, this.view.w - w - 8);
      this.y = clamp(start.oy + dy, 8, this.view.h - h - 8);
      this.place();
    });
    const end = (e) => {
      if (!start) return;
      start = null;
      try { this.el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (this.dragged) {
        this.host.setConfig({ idle: { widget: { x: this.x, y: this.y } } });
      }
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }
}
