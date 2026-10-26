// Compact CAPRI // DORMANT capsule. Separate from the biochip (chip.js).

import { clamp, reducedMotion } from './util.js';
import { statusText } from './state.js';

const RED = '#ff2152';
const GREEN = '#36ff7a';
const BLUE = '#3d6bff';
const WHITE = '#f4f7ff';
const FRAME = 1000 / 12;

export class DormantWidget {
  constructor({ el, host }) {
    this.el = el;
    this.host = host;
    this.open = false;
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
    this.glitchUntil = 0;
    this.nextGlitch = 0;
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

  setLabel(state, pct) {
    if (this.labelEl) this.labelEl.textContent = statusText(state, pct);
  }

  show() {
    this.open = true;
    this.el.hidden = false;
    this.place();
    this.born = performance.now();
    this.nextGlitch = this.born + 2500;
    this.onOpenChange?.(true);
    requestAnimationFrame(this.loop);
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.el.hidden = true;
    this.onOpenChange?.(false);
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
      this.x = Math.max(8, w - 220);
      this.y = Math.max(8, h - 52);
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
    const css = 18;
    if (canvas.width !== Math.round(css * dpr)) {
      canvas.width = Math.round(css * dpr);
      canvas.height = Math.round(css * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, css, css);

    const calm = reducedMotion.matches;
    if (!calm && now > this.nextGlitch) {
      this.glitchUntil = now + 140;
      this.nextGlitch = now + 4000 + Math.random() * 5000;
    }
    const glitch = !calm && now < this.glitchUntil;
    const spin = calm ? 0 : ((now - this.born) / 1000) * 0.35;
    const blink = calm ? 1 : (Math.floor(now / 80) % 70 < 3 ? 0.12 : 1);
    const jx = glitch ? (Math.random() < 0.5 ? -1.2 : 1.2) : 0;
    const jy = glitch ? (Math.random() - 0.5) * 1.4 : 0;

    ctx.save();
    ctx.translate(css / 2 + jx, css / 2 + jy);
    ctx.rotate(spin);
    if (glitch) {
      ctx.globalCompositeOperation = 'screen';
      this.star(ctx, -1.4, 0, '#00e5ff', 1);
      this.star(ctx, 1.4, 0, '#ff2a7a', 1);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.star(ctx, 0, 0, null, blink);
    ctx.restore();
  }

  star(ctx, dx, dy, flat, blink) {
    ctx.save();
    ctx.translate(dx, dy);
    const outer = 8.2;
    const inner = 3.1;
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + i * Math.PI / 4;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    if (flat) {
      path();
      ctx.fillStyle = flat;
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(-outer, -outer, outer, outer * 2);
    ctx.clip();
    path();
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, -outer, outer, outer * 2);
    ctx.clip();
    path();
    ctx.fillStyle = GREEN;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.1, 2.1 * blink, 0, 0, Math.PI * 2);
    ctx.fillStyle = BLUE;
    ctx.fill();
    if (blink > 0.4) {
      ctx.beginPath();
      ctx.arc(0.5, -0.4, 0.7, 0, Math.PI * 2);
      ctx.fillStyle = WHITE;
      ctx.fill();
    }
    ctx.restore();
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
