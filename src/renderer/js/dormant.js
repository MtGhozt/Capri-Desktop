// Compact CAPRI // DORMANT capsule. Separate from the biochip (chip.js).

import { clamp } from './util.js';
import { statusText } from './state.js';

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
    this.onOpenChange?.(true);
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
