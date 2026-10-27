// Folder-shaped message box. Streaming text types out on the main line; a short colour log
// sits under it. The box itself never takes a click — only the text field does.

import { reducedMotion, sleep } from './util.js';
import { EventLog, DEFAULT_LOG_LIMIT } from './event-log.js';
import { messageBadge } from './message-status.js';
import { boxAbove, clampBox } from './box-place.js';

const NOISE = '▚▞▙▟░▒#%&/\\<>01XZ';
const DECODE_STEP_MS = 28;
const TYPE_MS = 18;
const VOICE_STALE_MS = 90_000;
const REPLY_STALE_MS = 180_000;
const OFFLINE = [
  "Link's dead, choom. Fire up LM Studio before you ping me.",
  "No brain on the wire. LM Studio's offline — don't leave me hanging.",
  "Net's quiet. Spin the local stack and try me again.",
];

const TAG = {
  oido: 'OÍDO',
  despierta: 'DESPIERTA',
  pregunta: 'PREGUNTA',
  cerrado: 'CERRADO',
  abierto: 'ABIERTO',
  sistema: 'SISTEMA',
};

export class Bubble {
  constructor({ el, machine }) {
    this.el = el;
    this.machine = machine;
    this.logEl = el.querySelector('.bubble__log');
    this.lineEl = el.querySelector('.bubble__text');
    this.field = el.querySelector('.bubble__field');
    this.stateEl = el.querySelector('.bubble__state');
    this.voiceEl = el.querySelector('.bubble__voice');
    this.meterEl = el.querySelector('.bubble__meter');
    this.meterBar = this.meterEl?.querySelector('i');
    this.bodyEl = el.querySelector('.bubble__body');
    // the tab and the header are its handle: the only parts of it besides the field that take the pointer
    this.grabEls = [el.querySelector('.bubble__tab'), el.querySelector('.bubble__head')].filter(Boolean);
    this.at = null; // { left, top } while open; null: next time it opens above her
    this.dragging = null;
    this.onMoved = null; // the box moved (dragged or popped): whoever is on it goes along
    this.anchor = { x: 0, y: 0 };
    this.view = { w: innerWidth, h: innerHeight };
    this.open = false;
    this.busy = false;
    this.replyEl = this.lineEl;
    this.replyText = '';
    this.typed = '';
    this.decodeTimer = null;
    this.thinkTimer = null;
    this.typeTimer = null;
    this.onTalk = null;
    this.onOpenChange = null;
    this.onPerchChange = null;
    this.boot = 'ready';
    this.holdVoice = false;
    this.replyMode = 'voice';
    this.voiceLoading = false;
    this.onBlip = null;
    this.voicePlaying = false;
    this.voiceTimer = 0;
    this.fx = true;
    this.events = new EventLog({ limit: DEFAULT_LOG_LIMIT });
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
    this.setFx(true);
    this.bindDrag();
  }

  bindDrag() {
    for (const grab of this.grabEls) {
      grab.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !this.open || !this.at) return;
        e.preventDefault(); // keep the text field's focus, no image drag
        this.dragging = { dx: e.clientX - this.at.left, dy: e.clientY - this.at.top };
        this.el.classList.add('is-dragging');
      });
    }
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      if (!(e.buttons & 1)) return this.endDrag(); // let go somewhere it couldn't hear it
      this.moveTo({ left: e.clientX - this.dragging.dx, top: e.clientY - this.dragging.dy });
    });
    window.addEventListener('mouseup', () => this.endDrag());
    this.el.addEventListener('animationend', (e) => {
      if (e.animationName === 'bubble-pop') this.el.classList.remove('is-pop');
    });
  }

  endDrag() {
    if (!this.dragging) return;
    this.dragging = null;
    this.el.classList.remove('is-dragging');
    this.onMoved?.();
  }

  boxSize() {
    return { w: this.el.offsetWidth || 320, h: this.el.offsetHeight || 180 };
  }

  moveTo(pos) {
    this.at = clampBox(pos, this.view, this.boxSize());
    this.el.style.transform = `translate3d(${this.at.left}px, ${this.at.top}px, 0)`;
    this.onMoved?.();
  }

  // You moved her: the box blinks out and back in above her, like the old chat bubble followed her.
  popAbove(anchor = this.anchor) {
    if (!this.open || this.dragging) return;
    this.moveTo(boxAbove(anchor, this.view, this.boxSize()));
    if (reducedMotion.matches) return;
    this.el.classList.remove('is-pop');
    void this.el.offsetWidth; // restart the animation
    this.el.classList.add('is-pop');
  }

  hitGrab(x, y) {
    if (!this.open || this.el.hidden) return false;
    return this.grabEls.some((g) => {
      const r = g.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  }

  get visible() {
    return this.open;
  }

  setFx(on) {
    this.fx = on !== false;
    this.el.classList.toggle('is-fx', this.fx && !reducedMotion.matches);
  }

  setLogLimit(n) {
    this.events.setLimit(n);
    this.renderLog();
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
    this.onPerchChange?.('open');
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
      this.onPerchChange?.('open');
      return;
    }
    const startX = from.left + from.width / 2 - this.el.offsetWidth / 2;
    const startY = from.top + from.height / 2 - 1;
    this.el.classList.add('bubble--birth');
    this.el.style.clipPath = 'inset(calc(50% - 1px) 0)';
    this.el.style.transform = `translate3d(${Math.round(startX)}px, ${Math.round(startY)}px, 0)`;
    this.el.style.opacity = '1';
    this.onOpenChange?.(true);
    this.onPerchChange?.('open');
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
    this.stopType();
    clearTimeout(this.voiceTimer);
    this.voiceTimer = 0;
    this.clearDecode();
    if (this.busy) {
      window.host.cancelChat();
      this.busy = false;
      this.onTalk?.(false);
    }
    this.el.hidden = true;
    this.endDrag();
    this.at = null;
    this.field.blur();
    if (this.machine.get() === 'LISTENING' || this.machine.get() === 'THINKING' || this.machine.get() === 'TALKING') {
      this.machine.set('ONLINE');
    }
    this.setMeter(false);
    this.onOpenChange?.(false);
    this.onPerchChange?.('close');
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
    this.note('oido', line);
    this.sendLine(line, { heard: true });
  }

  sendLine(text, { heard = false } = {}) {
    if (!heard) this.note('pregunta', text);
    this.voicePlaying = false;
    this.busy = true;
    this.busyAt = Date.now();
    this.replyText = '';
    this.typed = '';
    this.setLine('');
    this.replyEl = this.lineEl;
    this.startThink();
    this.onTalk?.(false);
    window.host.sendChat(text).catch(() => {
      if (this.busy) this.fail();
    });
  }

  note(kind, text = '') {
    if (!TAG[kind]) return;
    this.events.push(kind, text);
    this.renderLog();
  }

  renderLog() {
    if (!this.logEl) return;
    this.logEl.replaceChildren();
    for (const row of this.events.lines) {
      const li = document.createElement('li');
      li.className = `bubble__row is-${row.kind}`;
      const tag = document.createElement('span');
      tag.className = 'bubble__tag';
      tag.textContent = TAG[row.kind] || row.kind.toUpperCase();
      const body = document.createElement('span');
      body.textContent = row.text ? ` ${row.text}` : '';
      li.append(tag, body);
      this.logEl.append(li);
    }
  }

  setMeter(on) {
    if (!this.meterEl) return;
    this.meterEl.hidden = !on;
    if (!on && this.meterBar) this.meterBar.style.width = '0%';
  }

  setVoiceLoading(on) {
    this.voiceLoading = Boolean(on);
    if (this.voiceEl) this.voiceEl.hidden = !this.voiceLoading;
  }

  setLevel(rms) {
    if (!this.meterBar) return;
    this.setMeter(true);
    const pct = Math.max(0, Math.min(100, Math.round(Number(rms) * 100)));
    this.meterBar.style.width = `${pct}%`;
  }

  setLine(text) {
    if (this.lineEl) this.lineEl.textContent = text;
  }

  onToken(piece) {
    if (!this.busy) return;
    this.busyAt = Date.now();
    this.stopThink();
    this.replyText += piece;
    this.typeToward(this.replyText);
  }

  onDone(text) {
    if (!this.busy) return;
    this.stopThink();
    this.replyText = text || this.replyText;
    this.busy = false;
    this.armVoiceWatch();
    this.typeToward(this.replyText, { finish: true });
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
    this.note('sistema', line);
    this.typeToward(line, { finish: true });
  }

  addLine(who, text) {
    if (who === 'you') {
      this.note('pregunta', text);
      return this.lineEl;
    }
    this.setLine(text);
    return this.lineEl;
  }

  clearDecode() {
    if (this.decodeTimer) {
      clearInterval(this.decodeTimer);
      clearTimeout(this.decodeTimer);
      this.decodeTimer = null;
    }
  }

  stopType() {
    if (this.typeTimer) {
      clearTimeout(this.typeTimer);
      this.typeTimer = null;
    }
  }

  typeToward(text, { finish = false } = {}) {
    this.clearDecode();
    if (!this.lineEl || reducedMotion.matches || !text) {
      this.typed = text;
      this.setLine(text);
      if (finish && !this.voicePlaying) {
        this.setState('ONLINE');
        this.onTalk?.(false);
      }
      return;
    }
    const blips = this.replyMode === 'blips' || this.voiceLoading;
    if (blips && finish) {
      this.decode(this.lineEl, text);
      return;
    }
    this.onTalk?.(true);
    const step = () => {
      if (this.typed.length >= text.length) {
        this.setLine(text);
        this.typeTimer = null;
        if (finish && !this.voicePlaying) {
          this.setState('ONLINE');
          this.onTalk?.(false);
        }
        return;
      }
      this.typed = text.slice(0, this.typed.length + 1);
      this.setLine(this.typed);
      if (this.typed.slice(-1).trim()) this.onBlip?.();
      this.typeTimer = setTimeout(step, TYPE_MS);
    };
    this.stopType();
    if (!this.typed || !text.startsWith(this.typed)) this.typed = '';
    step();
  }

  decode(el, text) {
    this.clearDecode();
    const finish = () => {
      this.clearDecode();
      if (el) el.textContent = text;
      this.typed = text;
      if (!this.voicePlaying) {
        this.setState('ONLINE');
        this.onTalk?.(false);
      }
    };
    if (!el || reducedMotion.matches || !text) {
      finish();
      return;
    }
    const chars = [...text];
    const blips = this.replyMode === 'blips' || this.voiceLoading;
    let done = 0;
    this.onTalk?.(true);
    if (blips) this.setState('TALKING');
    const paint = () => {
      const head = chars.slice(0, done).join('');
      let tail = '';
      for (let i = done; i < Math.min(chars.length, done + 6); i++) {
        tail += chars[i] === ' ' ? ' ' : NOISE[Math.floor(Math.random() * NOISE.length)];
      }
      el.textContent = head + tail;
    };
    if (!blips) {
      const step = () => {
        done = Math.min(chars.length, done + 2);
        paint();
        if (done >= chars.length) finish();
      };
      step();
      this.decodeTimer = setInterval(step, DECODE_STEP_MS);
      return;
    }
    const tick = () => {
      if (done >= chars.length) {
        finish();
        return;
      }
      const ch = chars[done];
      let take = 1;
      let wait = 40;
      if (ch === '…' || (ch === '.' && chars[done + 1] === '.' && chars[done + 2] === '.')) {
        take = ch === '…' ? 1 : 3;
        wait = 220;
      } else if ('.!?'.includes(ch)) wait = 110;
      else if (ch === ',') wait = 80;
      done = Math.min(chars.length, done + take);
      paint();
      if (ch !== ' ' && ch !== '\n' && ch !== '\t') this.onBlip?.();
      if (done >= chars.length) {
        finish();
        return;
      }
      this.decodeTimer = setTimeout(tick, wait);
    };
    tick();
  }

  armVoiceWatch() {
    clearTimeout(this.voiceTimer);
    this.voiceTimer = setTimeout(() => {
      this.voiceTimer = 0;
      if (this.voicePlaying) {
        if (Date.now() - (this.voiceAt || 0) < VOICE_STALE_MS) {
          this.armVoiceWatch();
          return;
        }
        this.voicePlaying = false;
      }
      if (this.decodeTimer) {
        this.clearDecode();
        if (this.replyEl) this.replyEl.textContent = this.replyText;
      }
      if (this.machine.get() === 'THINKING' || this.machine.get() === 'TALKING') {
        this.setState('ONLINE');
        this.onTalk?.(false);
      }
    }, 2000);
  }

  watchdog(now = Date.now()) {
    const state = this.machine.get();
    if (this.busy) {
      if (now - (this.busyAt || now) > REPLY_STALE_MS) {
        window.host.cancelChat?.();
        this.fail();
      }
      return;
    }
    if (this.voicePlaying && now - (this.voiceAt || 0) > VOICE_STALE_MS) this.voicePlaying = false;
    if (this.voicePlaying || this.voiceTimer || this.decodeTimer || this.thinkTimer || this.typeTimer) return;
    if (state === 'THINKING' || state === 'TALKING') {
      this.setState('ONLINE');
      this.onTalk?.(false);
    }
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

  abortForListen() {
    const cutting = this.busy || this.voicePlaying || Boolean(this.decodeTimer) || Boolean(this.typeTimer);
    this.stopThink();
    this.stopType();
    clearTimeout(this.voiceTimer);
    this.voiceTimer = 0;
    this.clearDecode();
    this.voicePlaying = false;
    this.onTalk?.(false);
    if (cutting) this.settleInterrupted();
    this.busy = false;
  }

  settleInterrupted() {
    if (!this.lineEl) return;
    let text = String(this.replyText || this.typed || '').trim();
    if (!text) text = '…';
    else if (this.busy && !/[.!?…]$/.test(text)) text = `${text} …`;
    this.replyText = text;
    this.typed = text;
    this.setLine(text);
    this.lineEl.classList.add('is-cut');
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
    if (this.stateEl) this.stateEl.textContent = messageBadge(name);
    this.el.dataset.state = name;
  }

  setAnchor(anchor, view) {
    this.anchor = anchor;
    this.view = view;
    this.place();
  }

  place() {
    if (!this.open) return;
    // opened: above her; after that it stays where it is (dragged, or popped over her), just kept on screen
    const size = this.boxSize();
    this.at = this.at ? clampBox(this.at, this.view, size) : boxAbove(this.anchor, this.view, size);
    this.el.style.transform = `translate3d(${this.at.left}px, ${this.at.top}px, 0)`;
  }

  rect() {
    if (!this.open || this.el.hidden) return null;
    return this.el.getBoundingClientRect();
  }

  inputRect() {
    if (!this.open || this.el.hidden || !this.field) return null;
    return this.field.getBoundingClientRect();
  }

  hitInput(x, y) {
    const r = this.inputRect();
    return Boolean(r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  }

  // Top edge of the folder body (under the tab): where she lies or stands.
  ledge() {
    if (!this.open || this.el.hidden) return null;
    const r = (this.bodyEl || this.el).getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, top: r.top };
  }

  scrollLog() {
    if (this.logEl) this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}
