// Terminal chat bubble above Capri. Streaming text is shown as-is; the glitch
// decode runs once when a reply is finished.

import { clamp, reducedMotion } from './util.js';

const NOISE = '▚▞▙▟░▒#%&/\\<>01XZ';
const DECODE_STEP_MS = 28;
const OFFLINE = [
  "Link's dead, choom. Fire up LM Studio before you ping me.",
  "No brain on the wire. LM Studio's offline — don't leave me hanging.",
  "Net's quiet. Spin the local stack and try me again.",
];

export class Bubble {
  constructor({ el }) {
    this.el = el;
    this.logEl = el.querySelector('.bubble__log');
    this.field = el.querySelector('.bubble__field');
    this.stateEl = el.querySelector('.bubble__state');
    this.anchor = { x: 0, y: 0 };
    this.view = { w: innerWidth, h: innerHeight };
    this.open = false;
    this.busy = false;
    this.replyEl = null;
    this.replyText = '';
    this.decodeTimer = null;
    this.thinkTimer = null;
    this.onTalk = null;
    this.onOpenChange = null;
    this.boot = 'ready';

    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });
  }

  get visible() {
    return this.open;
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  show() {
    if (this.open) {
      this.field.focus();
      return;
    }
    this.open = true;
    this.el.hidden = false;
    this.setState(this.boot === 'booting' ? 'BOOTING' : 'ONLINE');
    this.place();
    const focusField = () => this.field.focus();
    focusField();
    requestAnimationFrame(focusField);
    setTimeout(focusField, 80);
    this.onOpenChange?.(true);
  }

  hide({ fromHost = false } = {}) {
    if (!this.open) return;
    this.open = false;
    this.stopThink();
    clearInterval(this.decodeTimer);
    if (this.busy) {
      window.host.cancelChat();
      this.busy = false;
      this.onTalk?.(false);
    }
    this.el.hidden = true;
    this.field.blur();
    this.onOpenChange?.(false);
    if (!fromHost) window.host.closeChat();
  }

  submit() {
    const text = this.field.value.trim();
    if (!text || this.busy) return;
    this.field.value = '';
    this.addLine('you', text);
    this.busy = true;
    this.replyText = '';
    this.replyEl = this.addLine('capri', '');
    this.startThink();
    this.onTalk?.(false);
    window.host.sendChat(text).catch(() => {
      if (this.busy) this.fail();
    });
  }

  onToken(piece) {
    if (!this.busy) return;
    this.stopThink();
    this.setState('TALKING');
    this.replyText += piece;
    if (this.replyEl) this.replyEl.textContent = this.replyText;
    this.scrollLog();
  }

  onDone(text) {
    if (!this.busy) return;
    this.stopThink();
    this.replyText = text || this.replyText;
    this.busy = false;
    this.decode(this.replyEl, this.replyText);
  }

  onError() {
    if (!this.busy) return;
    this.fail();
  }

  fail() {
    this.stopThink();
    this.busy = false;
    const line = OFFLINE[Math.floor(Math.random() * OFFLINE.length)];
    this.replyText = line;
    this.decode(this.replyEl, line);
  }

  addLine(who, text) {
    const row = document.createElement('div');
    row.className = `bubble__row is-${who}`;
    const prefix = document.createElement('span');
    prefix.className = 'bubble__prefix';
    prefix.textContent = who === 'you' ? '> you: ' : 'CAPRI > ';
    const body = document.createElement('span');
    body.className = 'bubble__text';
    body.textContent = text;
    row.append(prefix, body);
    this.logEl.append(row);
    this.scrollLog();
    return body;
  }

  decode(el, text) {
    clearInterval(this.decodeTimer);
    if (!el) {
      this.setState('ONLINE');
      return;
    }
    if (reducedMotion.matches || !text) {
      el.textContent = text;
      this.setState('ONLINE');
      this.onTalk?.(false);
      return;
    }
    const chars = [...text];
    let done = 0;
    this.setState('TALKING');
    this.onTalk?.(true);
    const step = () => {
      done = Math.min(chars.length, done + 2);
      const head = chars.slice(0, done).join('');
      let tail = '';
      for (let i = done; i < Math.min(chars.length, done + 6); i++) {
        tail += chars[i] === ' ' ? ' ' : NOISE[Math.floor(Math.random() * NOISE.length)];
      }
      el.textContent = head + tail;
      this.scrollLog();
      if (done >= chars.length) {
        clearInterval(this.decodeTimer);
        el.textContent = text;
        this.setState('ONLINE');
        this.onTalk?.(false);
      }
    };
    step();
    this.decodeTimer = setInterval(step, DECODE_STEP_MS);
  }

  startThink() {
    this.stopThink();
    this.setState('THINKING', 0);
    let pct = 0;
    this.thinkTimer = setInterval(() => {
      pct = Math.min(90, pct + 1 + Math.floor(Math.random() * 4));
      this.setState('THINKING', pct);
    }, 80);
  }

  stopThink() {
    clearInterval(this.thinkTimer);
    this.thinkTimer = null;
  }

  setBoot(state) {
    this.boot = state;
    if (this.open && !this.busy) {
      this.setState(state === 'booting' ? 'BOOTING' : 'ONLINE');
    }
  }

  setState(name, pct) {
    if (name === 'THINKING') {
      const n = String(Math.max(0, Math.min(99, pct ?? 0))).padStart(3, '0');
      this.stateEl.textContent = `decrypting ${n} %`;
    } else {
      this.stateEl.textContent = name;
    }
    this.el.dataset.state = name;
  }

  setAnchor(anchor, view) {
    this.anchor = anchor;
    this.view = view;
    this.place();
  }

  place() {
    if (!this.open) return;
    const { x, y, top: crown = y - 80 } = this.anchor;
    const { w, h } = this.view;
    const margin = 14;
    const bw = this.el.offsetWidth;
    const bh = this.el.offsetHeight;
    let left = x - bw / 2;
    left = clamp(left, margin, w - bw - margin);
    let top = crown - bh - 8;
    if (top < margin) top = y + 48;
    top = clamp(top, margin, h - bh - margin);
    this.el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  rect() {
    if (!this.open || this.el.hidden) return null;
    return this.el.getBoundingClientRect();
  }

  scrollLog() {
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}
