// Overlay context menu. Same actions as the tray, drawn like the chat bubble.

import { clamp } from './util.js';

export class AppMenu {
  constructor({ el, host, folded }) {
    this.el = el;
    this.host = host;
    this.folded = typeof folded === 'function' ? folded : () => false;
    this.open = false;
    this.opening = false;
    this.openedAt = 0;
    this.expanded = null;
    this.onOpenChange = null;

    this.el.addEventListener('click', (e) => e.stopPropagation());
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) {
        e.preventDefault();
        this.hide();
      }
    });
    // Left click outside dismisses. Right-click must not: its mousedown fires before
    // contextmenu, and after the first open the menu is often moved up (she's at the
    // bottom of the screen), so that mousedown looks "outside" and would hide the
    // menu and drop ignoreMouseEvents before contextmenu can reopen it.
    window.addEventListener('mousedown', (e) => {
      if (!this.open || e.button !== 0) return;
      if (performance.now() - this.openedAt < 400) return;
      const r = this.el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        this.hide();
      }
    });
  }

  get visible() {
    return this.open || this.opening;
  }

  async show(x, y, avoid) {
    this.opening = true;
    this.openedAt = performance.now();
    this.onOpenChange?.(true);
    try {
      const state = await this.host.getMenu({ folded: this.folded() });
      this.expanded = null;
      this.at = { x, y };
      this.avoid = avoid || { left: x, top: y, right: x, bottom: y };
      this.render(state);
      this.open = true;
      this.el.hidden = false;
      this.place();
      this.openedAt = performance.now();
      this.onOpenChange?.(true);
    } catch (err) {
      console.error('[capri] menu show failed', err);
      this.opening = false;
      this.open = false;
      this.el.hidden = true;
      this.onOpenChange?.(false);
    } finally {
      this.opening = false;
    }
  }

  hide() {
    if (!this.open && !this.opening) return;
    this.open = false;
    this.opening = false;
    this.expanded = null;
    this.el.hidden = true;
    this.onOpenChange?.(false);
  }

  rect() {
    if (!this.open || this.el.hidden) return null;
    return this.el.getBoundingClientRect();
  }

  place() {
    const pad = 8;
    const mw = this.el.offsetWidth;
    const mh = this.el.offsetHeight;
    const vw = innerWidth;
    const vh = innerHeight;
    const a = this.avoid || { left: this.at.x, top: this.at.y, right: this.at.x, bottom: this.at.y };
    const maxL = Math.max(pad, vw - mw - pad);
    const maxT = Math.max(pad, vh - mh - pad);
    const snap = (left, top) => ({
      left: clamp(left, pad, maxL),
      top: clamp(top, pad, maxT),
    });
    const slots = [
      { left: a.right + pad, top: a.top },
      { left: a.right + pad, top: a.bottom - mh },
      { left: a.left - pad - mw, top: a.top },
      { left: a.left - pad - mw, top: a.bottom - mh },
      { left: a.left, top: a.bottom + pad },
      { left: a.right - mw, top: a.bottom + pad },
      { left: a.left, top: a.top - pad - mh },
      { left: a.right - mw, top: a.top - pad - mh },
    ];
    const onScreen = (p) => (
      p.left >= pad && p.top >= pad && p.left + mw <= vw - pad && p.top + mh <= vh - pad
    );
    const overlap = (p) => {
      const x = Math.max(0, Math.min(p.left + mw, a.right) - Math.max(p.left, a.left));
      const y = Math.max(0, Math.min(p.top + mh, a.bottom) - Math.max(p.top, a.top));
      return x * y;
    };
    let best = null;
    for (let i = 0; i < slots.length; i++) {
      const p = snap(slots[i].left, slots[i].top);
      const score = (onScreen(p) ? 0 : 1e9) + overlap(p) + i * 0.01;
      if (!best || score < best.score) best = { ...p, score };
    }
    this.el.style.transform = `translate3d(${Math.round(best.left)}px, ${Math.round(best.top)}px, 0)`;
  }

  render(state) {
    const t = state.labels;
    const { cfg } = state;
    const scale = cfg.scale;
    const rows = [];

    const item = (label, { action, checked, radio, disabled, expander } = {}) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'appmenu__item';
      if (disabled) btn.disabled = true;
      if (expander) btn.classList.add('is-branch');
      if (checked) btn.classList.add('is-on');
      const mark = checked ? (radio ? '● ' : '■ ') : expander ? '> ' : '  ';
      btn.textContent = mark + label;
      if (action && !disabled) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          action();
        });
      }
      return btn;
    };

    const sep = () => {
      const hr = document.createElement('div');
      hr.className = 'appmenu__sep';
      return hr;
    };

    const folded = Boolean(state.folded);
    rows.push(item(state.online, { disabled: true }));
    rows.push(sep());
    rows.push(item(t.teleport, { action: () => this.act('teleport') }));
    if (!folded) {
      rows.push(item(t.satellite, { action: () => this.act('satellite') }));
      rows.push(item(t.demo, { action: () => this.act('demo') }));
    }
    rows.push(item(t.help, { action: () => this.act('help') }));
    if (!folded) rows.push(item(cfg.visible ? t.hide : t.show, { action: () => this.act('visible') }));
    rows.push(item(folded ? t.wake : t.sleep, { action: () => this.act(folded ? 'wake' : 'sleep') }));
    rows.push(sep());

    rows.push(item(t.size, { expander: true, action: () => this.toggle('size', state) }));
    if (this.expanded === 'size') {
      for (const [label, value] of [[t.small, 0.45], [t.medium, 0.6], [t.large, 0.8]]) {
        rows.push(item(label, {
          radio: true,
          checked: Math.abs(scale - value) < 0.01,
          action: () => this.act('scale', value),
        }));
      }
    }

    rows.push(item(t.sound, { expander: true, action: () => this.toggle('sound', state) }));
    if (this.expanded === 'sound') {
      rows.push(item(t.mute, { checked: cfg.muted, action: () => this.act('muted', !cfg.muted) }));
      rows.push(item(t.reply, { disabled: true }));
      for (const [mode, label] of [['voice', t.replyVoice], ['blips', t.replyBlips], ['silent', t.replySilent]]) {
        rows.push(item(label, {
          radio: true,
          checked: String(cfg.replyMode || 'voice') === mode,
          action: () => this.act('reply-mode', mode),
        }));
      }
      rows.push(item(t.soundsDir, { action: () => this.act('sounds-dir') }));
    }

    rows.push(item(t.screen, {
      expander: true,
      disabled: state.displays.length < 2,
      action: () => this.toggle('screen', state),
    }));
    if (this.expanded === 'screen') {
      for (const d of state.displays) {
        rows.push(item(d.label, {
          radio: true,
          checked: d.current,
          action: () => this.act('display', d.id),
        }));
      }
    }

    if (!folded) rows.push(item(t.wander, { checked: cfg.wander, action: () => this.act('wander', !cfg.wander) }));
    rows.push(item(t.possess, { checked: cfg.possess, action: () => this.act('possess', !cfg.possess) }));
    rows.push(item(cfg.mic ? t.micOn : t.micOff, { checked: cfg.mic, action: () => this.act('mic', !cfg.mic) }));
    rows.push(item(t.micDevice, { expander: true, action: () => this.toggle('mic-device', state) }));
    if (this.expanded === 'mic-device') {
      rows.push(item(t.micDefault, {
        radio: true,
        checked: cfg.micDevice == null,
        action: () => this.act('mic-device', null),
      }));
      for (const d of state.micDevices || []) {
        rows.push(item(d.name, {
          radio: true,
          checked: Number(cfg.micDevice) === Number(d.id),
          action: () => this.act('mic-device', d.id),
        }));
      }
    }
    rows.push(item(t.lang, { expander: true, action: () => this.toggle('lang', state) }));
    if (this.expanded === 'lang') {
      for (const [value, label] of state.langs) {
        rows.push(item(label, {
          radio: true,
          checked: state.langSetting === value,
          action: () => this.act('lang', value),
        }));
      }
    }

    rows.push(item(t.startup, {
      checked: state.login,
      action: () => this.act('startup', !state.login),
    }));
    rows.push(sep());
    rows.push(item(t.quit, { action: () => this.act('quit') }));

    this.el.replaceChildren(...rows);
    if (this.open && this.at) this.place();
  }

  toggle(name, state) {
    this.expanded = this.expanded === name ? null : name;
    this.render(state);
  }

  async act(id, value) {
    const keep = id === 'scale' || id === 'muted' || id === 'display' || id === 'wander'
      || id === 'possess' || id === 'lang' || id === 'startup' || id === 'sounds-dir'
      || id === 'mic' || id === 'mic-device' || id === 'reply-mode';
    await this.host.menuAction({ id, value });
    if (id === 'quit' || id === 'teleport' || id === 'satellite' || id === 'demo' || id === 'help' || id === 'visible' || id === 'sleep' || id === 'wake') {
      this.hide();
      return;
    }
    if (keep && this.open) {
      const state = await this.host.getMenu({ folded: this.folded() });
      this.render(state);
    } else {
      this.hide();
    }
  }
}
