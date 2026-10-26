// Terminal chat bubble above Capri. Streaming text is shown as-is; the glitch
// decode runs once when a reply is finished.

import { clamp, reducedMotion, sleep } from './util.js';
import { statusText } from './state.js';

const NOISE = '▚▞▙▟░▒#%&/\\<>01XZ';
const DECODE_STEP_MS = 28;
const OFFLINE = [
  "Link's dead, choom. Fire up LM Studio before you ping me.",
  "No brain on the wire. LM Studio's offline — don't leave me hanging.",
  "Net's quiet. Spin the local stack and try me again.",
];

export class Bubble {
  constructor({ el, machine }) {
    this.el = el;
    this.machine = machine;
    this.logEl = el.querySelector('.bubble__log');
    this.field = el.querySelector('.bubble__field');
    this.stateEl = el.querySelector('.bubble__state');
    this.meterEl = el.querySelector('.bubble__meter');
    this.meterBar = this.meterEl?.querySelector('i');
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
    machine.onChange(() => this.paint());

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
      this.focusField();
      return;
    }
    this.open = true;
    this.el.hidden = false;
    this.syncBoot();
    this.paint();
    this.place();
    this.focusField();
    this.onOpenChange?.(true);
  }

  syncBoot() {
    if (this.machine.get() === 'LISTENING') return;
    if (this.machine.get() === 'DORMANT') {
      this.machine.set(this.boot === 'booting' ? 'BOOTING' : this.boot === 'failed' ? 'OFFLINE' : 'ONLINE');
    } else if (this.boot === 'booting') this.machine.set('BOOTING');
    else if (this.boot === 'failed') this.machine.set('OFFLINE');
    else if (this.machine.get() === 'BOOTING' || this.machine.get() === 'OFFLINE') this.machine.set('ONLINE');
  }

  focusField() {
    const focus = () => this.field.focus();
    focus();
    requestAnimationFrame(focus);
    setTimeout(focus, 80);
  }

  readPos() {
    const m = /translate3d\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px/.exec(this.el.style.transform || '');
    return { x: Number(m?.[1] || 0), y: Number(m?.[2] || 0) };
  }

  async birth(from, { animate = true } = {}) {
    if (this.open) {
      this.focusField();
      return;
    }
    this.open = true;
    this.el.hidden = false;
    this.el.style.opacity = '0';
    this.paint();
    this.place();
    const dest = this.readPos();
    if (!animate || !from || reducedMotion.matches) {
      this.el.style.opacity = '';
      this.focusField();
      this.onOpenChange?.(true);
      return;
    }
    const startX = from.left + from.width / 2 - this.el.offsetWidth / 2;
    const startY = from.top + from.height / 2 - 1;
    this.el.classList.add('bubble--birth');
    this.el.style.clipPath = 'inset(calc(50% - 1px) 0)';
    this.el.style.transform = `translate3d(${Math.round(startX)}px, ${Math.round(startY)}px, 0)`;
    this.el.style.opacity = '1';
    this.onOpenChange?.(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    this.el.style.transition = 'transform 420ms cubic-bezier(0.16, 1, 0.3, 1), clip-path 420ms cubic-bezier(0.16, 1, 0.3, 1)';
    this.el.style.clipPath = 'inset(0)';
    this.el.style.transform = `translate3d(${Math.round(dest.x)}px, ${Math.round(dest.y)}px, 0)`;
    await sleep(430);
    this.el.style.transition = '';
    this.el.style.clipPath = '';
    this.el.style.opacity = '';
    this.el.classList.remove('bubble--birth');
    this.place();
    this.focusField();
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
    if (this.machine.get() === 'LISTENING' || this.machine.get() === 'THINKING' || this.machine.get() === 'TALKING') {
      this.machine.set('ONLINE');
    }
    this.setMeter(false);
    this.onOpenChange?.(false);
    if (!fromHost) window.host.closeChat();
  }

  submit() {
    const text = this.field.value.trim();
    if (!text || this.busy) return;
    this.field.value = '';
    this.sendLine(text);
  }

  submitFromVoice(text) {
    const line = String(text || '').trim();
    if (!line || this.busy) return;
    if (!this.open) this.show();
    this.sendLine(line);
  }

  sendLine(text) {
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

  setMeter(on) {
    if (!this.meterEl) return;
    this.meterEl.hidden = !on;
    if (!on && this.meterBar) this.meterBar.style.width = '0%';
  }

  setLevel(rms) {
    if (!this.meterBar) return;
    this.setMeter(true);
    const pct = Math.max(0, Math.min(100, Math.round(Number(rms) * 100)));
    this.meterBar.style.width = `${pct}%`;
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
    if (this.machine.get() === 'DORMANT' || this.machine.get() === 'LISTENING') return;
    if (state === 'booting') this.machine.set('BOOTING');
    else if (state === 'failed') this.machine.set('OFFLINE');
    else if (!this.busy) this.machine.set('ONLINE');
  }

  setState(name, pct) {
    if (name === 'THINKING') {
      if (this.machine.get() !== 'THINKING') this.machine.set('THINKING');
      this.machine.setPct(pct ?? 0);
      return;
    }
    this.machine.set(name);
  }

  paint() {
    const name = this.machine.get();
    this.stateEl.textContent = statusText(name, this.machine.pct);
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
