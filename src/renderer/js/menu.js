// Overlay context menu, laid out like the Cyberpunk 2077 settings plate: coral labels,
// toggles as OFF|ON blocks, selectors as ◀ value ▶, and microtext on the rails.

import { clamp } from './util.js';

const REPLY_OPTIONS = [
  { id: 'voice', label: 'VOZ' },
  { id: 'blips', label: 'BLIPS' },
  { id: 'silent', label: 'SILENCIO' },
];

const THEME_OPTIONS = [
  { id: 'cyberpunk', label: 'CYBERPUNK' },
  { id: 'capri', label: 'CAPRI' },
];

export class AppMenu {
  constructor({ el, host, folded }) {
    this.el = el;
    this.host = host;
    this.folded = typeof folded === 'function' ? folded : () => false;
    this.open = false;
    this.opening = false;
    this.openedAt = 0;
    this.expanded = null;
    this.confirmForget = false;
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

  async show(x, y, avoid, expand = null) {
    this.opening = true;
    this.openedAt = performance.now();
    this.onOpenChange?.(true);
    try {
      const state = await this.host.getMenu({ folded: this.folded() });
      this.expanded = expand;
      this.confirmForget = false;
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
    this.confirmForget = false;
    this.el.hidden = true;
    this.onOpenChange?.(false);
  }

  rect() {
    if (!this.open || this.el.hidden) return null;
    return this.el.getBoundingClientRect();
  }

  setTheme(theme) {
    this.el.dataset.theme = theme === 'capri' ? 'capri' : 'cyberpunk';
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
    const { cfg } = state;
    this.setTheme(cfg.theme);
    const build = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };
    const kbd = (text) => build('kbd', 'appmenu__kbd', text);

    const body = build('div', 'appmenu__body');
    const plate = build('div', 'appmenu__plate');

    const rail = build('div', 'appmenu__rail');
    rail.append(
      build('span', 'appmenu__rail-text', 'CAPRI.SYS // OVERLAY CONFIG'),
      build('span', 'appmenu__rail-text', 'LOCAL LINK'),
    );

    const keys = build('div', 'appmenu__keys');
    const escape = build('span', 'appmenu__key');
    escape.append(kbd('ESC'), build('span', 'appmenu__key-label', 'Cerrar'));
    keys.append(escape, build('span', 'appmenu__keys-meta', 'CAPRICORN'));

    const section = (title) => body.append(build('div', 'appmenu__section', title));

    const action = (label, { value = '', hotkey = '', danger = false, sub = false, chevron = '', onClick } = {}) => {
      const row = build(onClick ? 'button' : 'div', 'appmenu__row appmenu__row--action');
      if (onClick) row.type = 'button';
      if (danger) row.classList.add('is-danger');
      if (sub) row.classList.add('appmenu__row--sub');
      row.append(build('span', 'appmenu__label', label));
      if (hotkey) row.append(kbd(hotkey));
      else if (value) row.append(build('span', 'appmenu__meta', value));
      if (chevron) {
        const mark = build('span', 'appmenu__chevron', '›');
        if (this.expanded === chevron) mark.classList.add('is-open');
        row.append(mark);
      }
      if (onClick) {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          onClick();
        });
      }
      body.append(row);
    };

    // labels: [estado apagado, estado encendido]; por defecto OFF|ON.
    const toggle = (label, { on, onChange, labels = ['OFF', 'ON'] }) => {
      const row = build('div', 'appmenu__row');
      row.append(build('span', 'appmenu__label', label));
      const group = build('div', 'appmenu__toggle');
      for (const [id, text] of [['off', labels[0]], ['on', labels[1]]]) {
        const pressed = (id === 'on') === Boolean(on);
        const btn = build('button', 'appmenu__toggle-btn', text);
        btn.type = 'button';
        btn.dataset.state = id;
        btn.classList.toggle('is-active', pressed);
        btn.setAttribute('aria-pressed', String(pressed));
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          onChange(id === 'on');
        });
        group.append(btn);
      }
      row.append(group);
      body.append(row);
    };

    const selector = (label, { options, current, onChange }) => {
      const index = Math.max(0, options.findIndex((o) => String(o.id) === String(current)));
      const row = build('div', 'appmenu__row');
      row.append(build('span', 'appmenu__label', label));
      const box = build('div', 'appmenu__select');
      const step = (delta) => onChange(options[(index + delta + options.length) % options.length].id);
      const back = build('button', 'appmenu__arrow', '◀');
      back.type = 'button';
      back.setAttribute('aria-label', `${label}: anterior`);
      back.addEventListener('click', (e) => {
        e.stopPropagation();
        step(-1);
      });
      const placed = options[index];
      const value = build('span', 'appmenu__select-value', placed.label);
      value.title = placed.label;
      const next = build('button', 'appmenu__arrow', '▶');
      next.type = 'button';
      next.setAttribute('aria-label', `${label}: siguiente`);
      next.addEventListener('click', (e) => {
        e.stopPropagation();
        step(1);
      });
      box.append(back, value, next);
      row.append(box);
      body.append(row);
    };

    // AUDIO
    section('AUDIO');
    toggle('Micrófono', { on: cfg.mic, labels: ['MUTEADO', 'ACTIVO'], onChange: (on) => this.act('mic', on) });
    const devices = [
      { id: null, label: 'Predeterminado' },
      ...(state.micDevices || []).map((d) => ({ id: d.id, label: d.name })),
    ];
    selector('Dispositivo de entrada', {
      options: devices,
      current: cfg.micDevice,
      onChange: (id) => this.act('mic-device', id),
    });
    selector('Respuesta', {
      options: REPLY_OPTIONS,
      current: String(cfg.replyMode || 'voice'),
      onChange: (id) => this.act('reply-mode', id),
    });

    // MEMORIA
    section('MEMORIA');
    action('Olvidar conversación', {
      value: this.confirmForget ? 'CONFIRMAR' : '',
      danger: this.confirmForget,
      onClick: () => this.act('forget'),
    });
    action('Recargar personalidad', { value: 'PERSONA.MD', onClick: () => this.act('persona-reload') });

    // CLIPS
    section('CLIPS');
    action('Guardar clip', { hotkey: state.clips.hotkey, onClick: () => this.act('clip-save') });
    action('Abrir carpeta de clips', { value: state.clips.folder, onClick: () => this.act('clips-dir') });

    // COMPORTAMIENTO
    section('COMPORTAMIENTO');
    toggle('Arrastrar', { on: cfg.locked, labels: ['NORMAL', 'FIJO'], onChange: (on) => this.act('drag-lock', on) });
    toggle('Iniciar con Windows', { on: state.login, labels: ['INACTIVO', 'ACTIVO'], onChange: (on) => this.act('startup', on) });
    toggle('Modo juego', {
      on: cfg.gaming !== 'off',
      labels: ['OFF', 'AUTO'],
      onChange: (on) => this.act('gaming-mode', on ? 'auto' : 'off'),
    });
    toggle('Comentarios', {
      on: cfg.comments !== false,
      labels: ['INACTIVO', 'ACTIVO'],
      onChange: (on) => this.act('comments', on),
    });
    selector('Tema', {
      options: THEME_OPTIONS,
      current: cfg.theme,
      onChange: (id) => this.act('theme', id),
    });
    action('Atajos', { chevron: 'shortcuts', onClick: () => this.toggle('shortcuts', state) });
    if (this.expanded === 'shortcuts') {
      for (const s of state.shortcuts || []) {
        action(s.label, s.accel ? { hotkey: s.accel, sub: true } : { value: '—', sub: true });
      }
      action('Abrir config.json', {
        value: 'EDITAR',
        sub: true,
        onClick: () => this.act('shortcuts-file'),
      });
    }

    // SALIR
    section('SALIR');
    action('Salir', { onClick: () => this.act('quit') });

    plate.append(rail, body, keys);
    this.el.replaceChildren(plate);
    if (this.open && this.at) this.place();
  }

  toggle(name, state) {
    this.confirmForget = false;
    this.expanded = this.expanded === name ? null : name;
    this.render(state);
  }

  async act(id, value) {
    if (id === 'forget' && !this.confirmForget) {
      this.confirmForget = true;
      const state = await this.host.getMenu({ folded: this.folded() });
      this.render(state);
      return;
    }
    this.confirmForget = false;
    const keep = id === 'mic' || id === 'mic-device' || id === 'reply-mode' || id === 'drag-lock' || id === 'theme'
      || id === 'startup' || id === 'gaming-mode' || id === 'comments';
    await this.host.menuAction({ id, value });
    if (!keep) {
      this.hide();
      return;
    }
    if (this.open) {
      const state = await this.host.getMenu({ folded: this.folded() });
      this.render(state);
    }
  }
}
