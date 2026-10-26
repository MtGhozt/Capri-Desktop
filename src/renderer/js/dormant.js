// Compact CAPRI // DORMANT capsule. Separate from the biochip (chip.js).

import { clamp, reducedMotion, sleep, tween } from './util.js';
import { statusText } from './state.js';

const RED = '#FF004D';
const CYAN = '#00FFCC';
const EYE = '#000011';
const GOLD = '#FFD700';
const PUPIL = '#00FFFF';
const PIXELS = ['#FFD700', '#FF004D', '#00FFCC'];
const FRAME = 1000 / 30;
const CSS = 88;
const TURN_MS = 7000;

export class DormantWidget {
  constructor({ el, host }) {
    this.el = el;
    this.host = host;
    this.open = false;
    this.fx = true;
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
    this.starAlpha = 1;
    this.glitchUntil = 0;
    this.nextGlitch = 0;
    this.nextBlink = 0;
    this.blinkUntil = 0;
    this.swap = false;
    this.particles = [];
    this.loop = this.loop.bind(this);

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
    if (this.labelEl) this.labelEl.textContent = statusText(state, pct);
  }

  show() {
    this.open = true;
    this.starAlpha = 1;
    this.el.classList.remove('is-line');
    this.el.hidden = false;
    this.place();
    this.born = performance.now();
    this.nextGlitch = this.born + 400;
    this.nextBlink = this.born + 3000 + Math.random() * 2000;
    this.particles.length = 0;
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
      this.x = Math.max(8, w - 260);
      this.y = Math.max(8, h - 72);
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
    const t = (now - this.born) / 1000;
    const spin = live ? -((now - this.born) / TURN_MS) * Math.PI * 2 : 0;
    const breath = live ? 1 + 0.04 * Math.sin(t * 1.4) : 1;
    const blink = (!live || now >= this.blinkUntil) ? 1 : 0.08;
    const cx = CSS / 2;
    const cy = CSS / 2;

    if (live) this.tickParticles(now, cx, cy);

    ctx.save();
    ctx.globalAlpha = this.starAlpha;
    ctx.translate(cx, cy);
    ctx.scale(breath, breath);
    ctx.rotate(spin);

    if (peak) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      this.petals(ctx, -1.8, 0, true);
      this.petals(ctx, 1.8, 0, true);
      ctx.restore();
    }
    this.petals(ctx, 0, 0, this.swap);
    ctx.rotate(-spin);
    this.eye(ctx, blink);
    ctx.restore();

    if (live && this.starAlpha > 0.05) {
      this.paintParticles(ctx);
      if (peak || Math.random() < 0.45) this.slices(ctx, canvas, dpr, peak);
    }
  }

  petals(ctx, dx, dy, swap) {
    ctx.save();
    ctx.translate(dx, dy);
    const a = swap ? CYAN : RED;
    const b = swap ? RED : CYAN;
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate(i * Math.PI / 2);
      this.petal(ctx, i % 2 === 0 ? 26 : 21);
      ctx.fillStyle = i % 2 === 0 ? a : b;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  petal(ctx, outer) {
    const half = outer * 0.22;
    const waist = outer * 0.42;
    const notch = outer * 0.14;
    ctx.beginPath();
    ctx.moveTo(0, -outer);
    ctx.lineTo(half, -waist);
    ctx.quadraticCurveTo(outer * 0.08, -notch * 0.35, 0, -notch);
    ctx.quadraticCurveTo(-outer * 0.08, -notch * 0.35, -half, -waist);
    ctx.closePath();
  }

  eye(ctx, blink) {
    const diamond = () => {
      ctx.beginPath();
      ctx.moveTo(0, -7.2);
      ctx.lineTo(6.4, 0);
      ctx.lineTo(0, 7.2);
      ctx.lineTo(-6.4, 0);
      ctx.closePath();
    };
    ctx.save();
    ctx.scale(1, blink);
    diamond();
    ctx.fillStyle = EYE;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 3.1, 0, Math.PI * 2);
    ctx.fillStyle = PUPIL;
    ctx.fill();
    if (blink > 0.4) {
      ctx.beginPath();
      ctx.arc(1.1, -1.05, 1.05, 0, Math.PI * 2);
      ctx.fillStyle = '#e8ffff';
      ctx.fill();
    }
    ctx.restore();
    diamond();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.05;
    ctx.stroke();
  }

  tickParticles(now, cx, cy) {
    const dt = FRAME / 1000;
    this.particles = this.particles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      return p.life > 0;
    });
    while (this.particles.length < 10 && Math.random() < 0.28) {
      const a = Math.random() * Math.PI * 2;
      const sp = 18 + Math.random() * 28;
      this.particles.push({
        x: cx + Math.cos(a) * 6,
        y: cy + Math.sin(a) * 6,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.45 + Math.random() * 0.55,
        max: 1,
        size: 1 + Math.floor(Math.random() * 2),
        color: PIXELS[Math.floor(Math.random() * PIXELS.length)],
      });
      this.particles[this.particles.length - 1].max = this.particles[this.particles.length - 1].life;
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
