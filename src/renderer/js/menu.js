// Overlay context menu. Same actions as the tray, drawn like the chat bubble.

export class AppMenu {
  constructor({ el, host }) {
    this.el = el;
    this.host = host;
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

  async show(x, y) {
    this.opening = true;
    this.openedAt = performance.now();
    this.onOpenChange?.(true);
    try {
      const state = await this.host.getMenu();
      this.expanded = null;
      this.at = { x, y };
      this.render(state);
      this.open = true;
      this.el.hidden = false;
      this.place(x, y);
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

  place(x, y) {
    const pad = 8;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const left = Math.max(pad, Math.min(x, innerWidth - w - pad));
    const top = Math.max(pad, Math.min(y, innerHeight - h - pad));
    this.el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
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

    rows.push(item(state.online, { disabled: true }));
    rows.push(sep());
    rows.push(item(t.teleport, { action: () => this.act('teleport') }));
    rows.push(item(t.satellite, { action: () => this.act('satellite') }));
    rows.push(item(t.demo, { action: () => this.act('demo') }));
    rows.push(item(t.help, { action: () => this.act('help') }));
    rows.push(item(cfg.visible ? t.hide : t.show, { action: () => this.act('visible') }));
    rows.push(item(t.sleep, { action: () => this.act('sleep') }));
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

    rows.push(item(t.wander, { checked: cfg.wander, action: () => this.act('wander', !cfg.wander) }));
    rows.push(item(t.possess, { checked: cfg.possess, action: () => this.act('possess', !cfg.possess) }));
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

    if (state.hooks.installed) {
      rows.push(item(t.hooksOn, { disabled: true }));
      rows.push(item(t.hooksRemove, { action: () => this.act('hooks-remove') }));
    } else {
      rows.push(item(t.hooksOff, { action: () => this.act('hooks-install') }));
    }
    rows.push(sep());
    rows.push(item(t.quit, { action: () => this.act('quit') }));

    this.el.replaceChildren(...rows);
    if (this.open && this.at) this.place(this.at.x, this.at.y);
  }

  toggle(name, state) {
    this.expanded = this.expanded === name ? null : name;
    this.render(state);
  }

  async act(id, value) {
    const keep = id === 'scale' || id === 'muted' || id === 'display' || id === 'wander'
      || id === 'possess' || id === 'lang' || id === 'startup' || id === 'sounds-dir'
      || id === 'hooks-install' || id === 'hooks-remove';
    await this.host.menuAction({ id, value });
    if (id === 'quit' || id === 'teleport' || id === 'satellite' || id === 'demo' || id === 'help' || id === 'visible' || id === 'sleep') {
      this.hide();
      return;
    }
    if (keep && this.open) {
      const state = await this.host.getMenu();
      this.render(state);
    } else {
      this.hide();
    }
  }
}
