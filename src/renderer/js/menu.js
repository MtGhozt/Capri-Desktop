// Overlay context menu, laid out like the Cyberpunk 2077 settings plate: coral labels,
// toggles as OFF|ON blocks, selectors as ◀ value ▶, and microtext on the rails.

import { clamp } from './util.js';

const REPLY_OPTIONS = [
  { id: 'voice', label: 'VOZ' },
  { id: 'blips', label: 'BLIPS' },
  { id: 'silent', label: 'SILENCIO' },
];

export function unionRects(a, b) {
  if (!b) return a;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

// One Esc press peels one layer; never leave a blank plate in settings.
export function menuEscapeStep({ capturing, quickOpen, expanded, view, settingsMode } = {}) {
  if (capturing) return 'cancel-capture';
  if (quickOpen) return 'close-quick-submenu';
  if (expanded) return 'collapse-expanded';
  if (view === 'apps') return 'apps-to-main';
  if (settingsMode) return 'close-settings';
  return 'hide';
}

const CLOSE_OPTIONS = [
  { id: 'graceful', label: 'CON CUIDADO' },
  { id: 'ask', label: 'PREGUNTAR' },
  { id: 'force', label: 'FORZAR' },
];

const THEME_OPTIONS = [
  { id: 'cyberpunk', label: 'CYBERPUNK' },
  { id: 'capri', label: 'CAPRI' },
];

export const QUICK_MENU_ITEMS = [
  { id: 'mic' }, { id: 'mic-device' }, { id: 'reply-mode' }, { id: 'model-provider' },
  { id: 'fixes' }, { id: 'clip-save' }, { id: 'do-something' }, { id: 'behavior' }, { id: 'drone-mode' }, { id: 'theme' }, { id: 'settings' }, { id: 'quit' },
];

export const SETTINGS_TABS = [
  { id: 'model', label: 'Modelo y clave' }, { id: 'memory', label: 'Memoria' },
  { id: 'hearing', label: 'Oído' }, { id: 'apps', label: 'Mis apps' },
  { id: 'bubble', label: 'Apariencia' }, { id: 'music', label: 'Música / Reproductor' },
  { id: 'shortcuts', label: 'Atajos' }, { id: 'behavior', label: 'Comportamiento' },
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
    this.fixNote = '';     // "GUARDADO" under Corregir lo último, once a fix is saved
    this.keyboard = false; // Corregir lo último has text fields: the overlay has the keyboard
    this.capturing = false; // OÍDO › Tecla para hablar: waiting for the new combo
    this.talkNote = '';     // what came of the last combo (taken, saved...)
    this.lastState = null;
    this.view = 'main';     // 'apps': her app table instead of the menu (Paso 4C)
    this.appOpen = null;    // the app being edited
    this.appNote = '';      // what came of the last add / save / delete
    this.appDelete = null;  // BORRAR pressed once: the next press deletes
    this.linkForm = false;  // Añadir enlace open
    this.testText = '';     // Probar comando
    this.testResult = '';
    this.foundFilter = '';  // Encontrado en esta PC (Paso 4D)
    this.foundOpen = null;
    this.foundNote = '';
    this.scanning = false;
    this.modelNote = '';   // what came of the last model / key save (Paso 4K)
    this.settingsMode = false;
    this.settingsSection = 'model';
    this.quickOpen = null;
    this.quickAnchor = null;

    this.el.addEventListener('click', (e) => e.stopPropagation());
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    // the new push-to-talk combo: this keydown is the combo, not a menu key
    window.addEventListener('keydown', (e) => {
      if (!this.open || !this.capturing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        this.capturing = false;
        this.talkNote = '';
        this.rerender();
        return;
      }
      if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return; // still holding
      this.saveTalkKey({
        key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey,
      });
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.settingsMode) return; // settings.html binds Esc → onEscape once
      if (!this.open) return;
      e.preventDefault();
      this.onEscape();
    });
    // Left click outside dismisses. Right-click must not: its mousedown fires before
    // contextmenu, and after the first open the menu is often moved up (she's at the
    // bottom of the screen), so that mousedown looks "outside" and would hide the
    // menu and drop ignoreMouseEvents before contextmenu can reopen it.
    // Seen first (capture), so nothing under the pointer can keep it from her: while the menu is
    // up she takes the whole screen, and a click that doesn't close it would be a click lost.
    window.addEventListener('mousedown', (e) => {
      if (this.settingsMode) return;
      if (!this.visible || e.button !== 0) return;
      if (performance.now() - this.openedAt < 400) return;
      if (!this.open) return this.hide(); // still opening (or stuck at it): the click wins
      const r = this.rect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        this.hide();
      }
    }, true);
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
      this.expanded = expand === 'apps' ? null : expand;
      this.view = expand === 'apps' ? 'apps' : 'main';
      this.resetApps();
      this.confirmForget = false;
      this.fixNote = '';
      this.modelNote = '';
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

  // Esc: close one layer (submenu → parent), or the whole menu / settings window.
  onEscape() {
    const step = menuEscapeStep({
      capturing: this.capturing,
      quickOpen: this.quickOpen,
      expanded: this.expanded,
      view: this.view,
      settingsMode: this.settingsMode,
    });
    if (step === 'cancel-capture') {
      this.capturing = false;
      this.talkNote = '';
      if (this.lastState) this.render(this.lastState);
      return step;
    }
    if (step === 'close-quick-submenu') {
      this.quickOpen = null;
      if (this.lastState) this.renderQuick(this.lastState);
      return step;
    }
    if (step === 'collapse-expanded') {
      this.expanded = null;
      this.fixNote = '';
      this.useKeyboard(false);
      if (this.lastState) this.render(this.lastState);
      return step;
    }
    if (step === 'apps-to-main') {
      this.view = 'main';
      this.resetApps();
      if (this.lastState) this.render(this.lastState);
      return step;
    }
    if (step === 'close-settings') {
      this.host.closeSettings();
      return step;
    }
    this.hide();
    return step;
  }

  // force: whatever it thinks it is, it goes (a forced close, or drawn while it thought it was closed)
  hide({ force = false } = {}) {
    if (!force && !this.open && !this.opening && this.el.hidden) return;
    this.open = false;
    this.opening = false;
    this.expanded = null;
    this.quickOpen = null;
    this.confirmForget = false;
    this.el.hidden = true;
    this.capturing = false;
    this.talkNote = '';
    this.view = 'main';
    this.resetApps();
    this.useKeyboard(false);
    this.onOpenChange?.(false);
  }

  // The overlay never takes the keyboard by itself: ask for it while the fix fields are open.
  // Settings is a separate window — never steal the overlay's focus from here.
  useKeyboard(on) {
    if (this.settingsMode) return;
    if (this.keyboard === on) return;
    this.keyboard = on;
    this.host.menuAction({ id: 'menu-keyboard', value: on }).catch(() => {});
  }

  resetApps() {
    this.appOpen = null;
    this.appNote = '';
    this.appDelete = null;
    this.linkForm = false;
    this.testText = '';
    this.testResult = '';
    this.foundFilter = '';
    this.foundOpen = null;
    this.foundNote = '';
  }

  rect() {
    if (!this.open || this.el.hidden) return null;
    return unionRects(this.el.getBoundingClientRect(), this.el.querySelector('.appmenu__submenu')?.getBoundingClientRect());
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
    if (!this.settingsMode) return this.renderQuick(state);
    this.renderFull(state);
  }

  renderQuick(state) {
    this.lastState = state;
    const { cfg, model = {}, hearing = {} } = state;
    this.setTheme(cfg.theme);
    const build = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };
    const plate = build('div', 'appmenu__plate appmenu__quick-plate');
    const rail = build('div', 'appmenu__rail');
    rail.append(build('span', 'appmenu__rail-text', 'CAPRI.SYS // OVERLAY'), build('span', 'appmenu__rail-text', 'LOCAL LINK'));
    const body = build('div', 'appmenu__body appmenu__quick-body');
    const row = (label, value, id, onClick, danger = false) => {
      const item = build('button', 'appmenu__row appmenu__row--action appmenu__quick-row', label);
      item.type = 'button';
      if (danger) item.classList.add('is-danger');
      item.append(build('span', 'appmenu__meta', value || ''), build('span', 'appmenu__chevron', ['clip-save', 'do-something'].includes(id) ? '' : '›'));
      item.addEventListener('click', (e) => { e.stopPropagation(); onClick(item.getBoundingClientRect()); });
      body.append(item);
    };
    const openSubmenu = (id, options, current, action, anchor) => {
      this.quickOpen = this.quickOpen === id ? null : id;
      this.quickOptions = { id, options, current, action };
      this.quickAnchor = anchor;
      this.renderQuick(this.lastState);
      requestAnimationFrame(() => this.placeSubmenu());
    };
    row('Micrófono', cfg.mic ? 'ACTIVO' : 'MUTEADO', 'mic', () => this.act('mic', !cfg.mic));
    row('Dispositivo de audio', state.micDevices?.find((d) => String(d.id) === String(cfg.micDevice))?.name || 'PREDETERMINADO', 'mic-device',
      (anchor) => openSubmenu('mic-device', [{ id: null, label: 'PREDETERMINADO' }, ...(state.micDevices || []).map((d) => ({ id: d.id, label: d.name }))], cfg.micDevice, 'mic-device', anchor));
    row('Modo de respuesta', REPLY_OPTIONS.find((o) => o.id === cfg.replyMode)?.label || 'VOZ', 'reply-mode',
      (anchor) => openSubmenu('reply-mode', REPLY_OPTIONS, cfg.replyMode, 'reply-mode', anchor));
    row('Proveedor', model.providers?.find((o) => o.id === model.provider)?.label || model.provider, 'model-provider',
      (anchor) => openSubmenu('model-provider', model.providers || [], model.provider, 'model-provider', anchor));
    row('Corregir lo último', hearing.fixes?.length ? `${hearing.fixes.length} CORRECCIONES` : 'OÍDO', 'fixes',
      () => { this.hide(); this.host.openSettings('hearing'); });
    row('Guardar clip', 'ALT+F10', 'clip-save', () => this.act('clip-save'));
    row('Hacer algo', '', 'do-something', () => this.act('do-something'));
    row('Comportamiento', cfg.locked ? 'FIJO' : 'NORMAL', 'behavior',
      (anchor) => openSubmenu('behavior', [{ id: 'normal', label: 'NORMAL' }, { id: 'locked', label: 'FIJO' }], cfg.locked ? 'locked' : 'normal', 'drag-lock', anchor));
    row('Dron en modo juego', cfg.gaming?.drone === false ? 'NO' : 'SÍ', 'drone-mode',
      (anchor) => openSubmenu('drone-mode', [{ id: false, label: 'NO' }, { id: true, label: 'SÍ' }],
        cfg.gaming?.drone !== false, 'drone-mode', anchor));
    row('Tema', cfg.theme === 'capri' ? 'CAPRI' : 'CYBERPUNK', 'theme',
      (anchor) => openSubmenu('theme', THEME_OPTIONS, cfg.theme, 'theme', anchor));
    const rule = build('div', 'appmenu__quick-rule');
    body.append(rule);
    row('Ajustes…', '', 'settings', () => { this.hide(); this.host.openSettings(); });
    row('Salir', '', 'quit', () => this.act('quit'));
    const foot = build('div', 'appmenu__rail appmenu__quick-foot');
    foot.append(build('span', 'appmenu__kbd', 'ESC'), build('span', 'appmenu__rail-text', 'CERRAR'), build('span', 'appmenu__rail-text', 'CAPRICORN'));
    plate.append(rail, body, foot);
    this.el.replaceChildren(plate);
    if (this.quickOpen) {
      const menu = build('div', 'appmenu__submenu');
      menu.append(build('div', 'appmenu__submenu-title', this.quickOptions.id.toUpperCase()));
      for (const option of this.quickOptions.options) {
        const button = build('button', 'appmenu__submenu-row', option.label);
        button.type = 'button';
        button.classList.toggle('is-selected', String(option.id) === String(this.quickOptions.current));
        button.addEventListener('click', () => {
          const value = this.quickOptions.action === 'drag-lock' ? option.id === 'locked' : option.id;
          this.quickOpen = null;
          this.act(this.quickOptions.action, value);
        });
        menu.append(button);
      }
      this.el.append(menu);
    }
    if (this.open && this.at && !this.settingsMode) this.place();
  }

  placeSubmenu() {
    const menu = this.el.querySelector('.appmenu__submenu');
    if (!menu) return;
    const main = this.el.querySelector('.appmenu__quick-plate').getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const right = main.right + 8;
    const left = main.left - w - 8;
    const x = right + w <= innerWidth - 8 ? right : Math.max(8, left);
    const anchorTop = this.quickAnchor?.top ?? main.top;
    const anchorBottom = this.quickAnchor?.bottom ?? main.bottom;
    const y = Math.min(Math.max(8, anchorTop), innerHeight - h - 8);
    menu.style.left = `${Math.round(x - main.left)}px`;
    menu.style.top = `${Math.round(y - main.top)}px`;
  }

  renderFull(state) {
    this.lastState = state;
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
      build('span', 'appmenu__rail-text', this.view === 'apps' ? 'CAPRI.SYS // APPS' : 'CAPRI.SYS // OVERLAY CONFIG'),
      build('span', 'appmenu__rail-text', 'LOCAL LINK'),
    );

    const keys = build('div', 'appmenu__keys');
    const escape = build('span', 'appmenu__key');
    escape.append(kbd('ESC'), build('span', 'appmenu__key-label', 'Cerrar'));
    keys.append(escape, build('span', 'appmenu__keys-meta', 'CAPRICORN'));

    const section = (title, id = title) => {
      const heading = build('div', 'appmenu__section', title);
      heading.dataset.section = id;
      body.append(heading);
    };

    const action = (label, { value = '', hotkey = '', danger = false, sub = false, chevron = '', setting = '', onClick } = {}) => {
      const row = build(onClick ? 'button' : 'div', 'appmenu__row appmenu__row--action');
      if (onClick) row.type = 'button';
      if (danger) row.classList.add('is-danger');
      if (sub) row.classList.add('appmenu__row--sub');
      if (setting) row.dataset.setting = setting;
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
    const toggle = (label, { on, onChange, labels = ['OFF', 'ON'], setting = '' }) => {
      const row = build('div', 'appmenu__row');
      if (setting) row.dataset.setting = setting;
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

    const selector = (label, { options, current, onChange, setting = '' }, into = body) => {
      const index = Math.max(0, options.findIndex((o) => String(o.id) === String(current)));
      const row = build('div', 'appmenu__row');
      if (setting) row.dataset.setting = setting;
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
      into.append(row);
    };

    if (this.view === 'apps') {
      this.appsView(state, { body, build, kbd, section, action, selector });
      plate.append(rail, body, keys);
      this.filterSettingsBody(body);
      this.el.replaceChildren(plate);
      if (this.open && this.at && !this.settingsMode) this.place();
      this.useKeyboard(true); // its text fields
      return;
    }

    // AUDIO
    section('AUDIO', 'hearing');
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
      current: String(cfg.replyMode || 'blips'),
      onChange: (id) => this.act('reply-mode', id),
    });

    section('MÚSICA', 'music');
    selector('Reproductor', {
      options: [
        { id: 'namida', label: 'NAMIDA' },
        { id: 'spotify', label: 'SPOTIFY' },
        { id: 'none', label: 'NINGUNO' },
      ],
      current: cfg.musicPlayer || 'namida',
      onChange: (id) => this.act('music-player', id),
    });
    const spotify = build('div', 'appmenu__fix');
    const client = build('input', 'appmenu__input');
    client.type = 'text';
    client.placeholder = 'Client ID de Spotify';
    client.value = state.music?.clientId || '';
    client.maxLength = 100;
    client.spellcheck = false;
    const saveClient = build('button', `appmenu__toggle-btn appmenu__fix-save is-active ${state.music?.connected ? 'is-disconnect' : 'is-connect'}`, state.music?.connected ? 'DESCONECTAR' : 'CONECTAR');
    saveClient.type = 'button';
    saveClient.addEventListener('click', (e) => {
      e.stopPropagation();
      this.host.menuAction({
        id: state.music?.connected ? 'spotify-disconnect' : 'spotify-connect',
        value: client.value.trim(),
      }).then(() => this.refresh()).catch(() => {});
    });
    spotify.append(build('label', 'appmenu__fix-field', 'Client ID'), client, saveClient,
      build('div', 'appmenu__hint', state.music?.connected ? 'CONECTADO' : 'SIN CONEXIÓN'));
    body.append(spotify);

    // MODELO: who answers her, where the key lives, and what may leave the PC (Paso 4K)
    section('MODELO', 'model');
    const model = state.model || { providers: [{ id: 'local', label: 'LM Studio' }], provider: 'local', model: '', local: true };
    selector('Proveedor', {
      options: model.providers,
      current: model.provider,
      onChange: (id) => this.act('model-provider', id),
    });
    action('Modelo y clave', {
      value: model.local ? 'LOCAL' : (model.hasKey ? 'CLAVE GUARDADA' : 'SIN CLAVE'),
      chevron: 'model',
      onClick: () => this.toggle('model', state),
    });
    if (this.expanded === 'model') {
      body.append(this.modelPanel(model, { build }));
      toggle('Enviar mi pantalla cuando le pida mirar', {
        on: model.shareScreen,
        labels: ['NO', 'SÍ'],
        onChange: (on) => this.saveShare({ shareScreen: on }),
      });
      toggle('Enviar lo que recuerda de mí', {
        on: model.shareMemory,
        labels: ['NO', 'SÍ'],
        onChange: (on) => this.saveShare({ shareMemory: on }),
      });
      body.append(build('div', 'appmenu__hint', 'Apagados, a la nube solo va lo que le escribes. Con LM Studio nada sale de tu PC.'));
    }

    // MEMORIA
    section('MEMORIA', 'memory');
    action('Olvidar conversación', {
      value: this.confirmForget ? 'CONFIRMAR' : '',
      danger: this.confirmForget,
      onClick: () => this.act('forget'),
    });
    action('Abrir personalidad', {
      setting: 'memory',
      value: 'PERSONA.MD',
      onClick: () => this.act('persona-open'),
    });
    action('Abrir memoria', {
      setting: 'memory',
      value: 'MEMORY.MD',
      onClick: () => this.act('memory-open'),
    });
    action('Recargar personalidad', { setting: 'memory', value: 'RELEER', onClick: () => this.act('persona-reload') });

    // OÍDO: what she hears wrong (Paso 4A)
    section('OÍDO', 'hearing');
    const hearing = state.hearing || { fixes: [], lastHeard: '' };
    action('Corregir lo último', {
      value: hearing.fixes.length ? `${hearing.fixes.length} CORRECCIONES` : '',
      chevron: 'fixes',
      onClick: () => this.toggle('fixes', state),
    });
    if (this.expanded === 'fixes') body.append(this.fixPanel(hearing, build));
    body.append(this.sensitivityRow(hearing, build));
    body.append(this.talkKeyRow(hearing, build, kbd));

    // APPS: what "abre X" / "cierra X" reach, in a panel of its own
    section('APPS', 'apps');
    action('Mis apps', {
      value: `${(state.apps || []).length} APPS`,
      chevron: 'apps',
      onClick: () => {
        this.view = 'apps';
        this.resetApps();
        this.render(state);
      },
    });

    // CLIPS
    section('CLIPS', 'clips');
    action('Guardar clip', { hotkey: state.clips.hotkey, onClick: () => this.act('clip-save') });
    action('Abrir carpeta de clips', { value: state.clips.folder, onClick: () => this.act('clips-dir') });

    // COMPORTAMIENTO
    section('COMPORTAMIENTO', 'behavior');
    toggle('Comentarios', {
      setting: 'behavior',
      on: cfg.comments?.enabled !== false,
      labels: ['NO', 'SÍ'],
      onChange: (on) => this.act('comments', on),
    });
    const commentFrequency = build('div', 'appmenu__row appmenu__comment-frequency');
    commentFrequency.dataset.setting = 'behavior';
    commentFrequency.append(build('span', 'appmenu__label', 'Frecuencia (min–máx)'));
    for (const [key, fallback] of [['minMinutes', 20], ['maxMinutes', 40]]) {
      const input = build('input', 'appmenu__input');
      input.type = 'number';
      input.min = '1';
      input.max = '1440';
      input.value = String(cfg.comments?.[key] ?? fallback);
      input.title = key === 'minMinutes' ? 'Mínimo en minutos' : 'Máximo en minutos';
      input.addEventListener('change', () => this.act('comments-range', {
        [key]: Math.max(1, Math.min(1440, Number(input.value) || fallback)),
      }));
      commentFrequency.append(input);
    }
    body.append(commentFrequency);
    toggle('Saludos', {
      setting: 'behavior',
      on: cfg.behavior?.greetings !== false,
      labels: ['NO', 'SÍ'],
      onChange: (on) => this.act('greetings', on),
    });
    toggle('Saludo al desbloquear', {
      setting: 'behavior',
      on: cfg.behavior?.unlockGreeting !== false,
      labels: ['NO', 'SÍ'],
      onChange: (on) => this.act('unlock-greeting', on),
    });
    toggle('Caricias', {
      setting: 'behavior',
      on: cfg.behavior?.caresses !== false,
      labels: ['NO', 'SÍ'],
      onChange: (on) => this.act('caresses', on),
    });
    toggle('Bailar con música', {
      setting: 'behavior',
      on: cfg.behavior?.musicDance !== false,
      labels: ['NO', 'SÍ'],
      onChange: (on) => this.act('music-dance', on),
    });
    toggle('Dron en modo juego', {
      setting: 'behavior',
      on: cfg.gaming?.drone !== false,
      labels: ['NO', 'SÍ'],
      onChange: (on) => this.act('drone-mode', on),
    });
    section('APARIENCIA', 'bubble');
    toggle('Animaciones de apps', {
      setting: 'bubble',
      on: cfg.appFx !== false,
      labels: ['INACTIVO', 'ACTIVO'],
      onChange: (on) => this.act('app-fx', on),
    });
    toggle('Caja de mensaje', {
      setting: 'bubble',
      on: cfg.scanlines !== false,
      labels: ['PLANA', 'FX'],
      onChange: (on) => this.act('scanlines', on),
    });
    selector('Tema', {
      setting: 'bubble',
      options: THEME_OPTIONS,
      current: cfg.theme,
      onChange: (id) => this.act('theme', id),
    });
    selector('Pantalla', {
      setting: 'bubble',
      options: [
        { id: 'auto', label: 'AUTOMÁTICO' },
        { id: 'gl', label: 'OPENGL' },
        { id: 'software', label: 'SIN GPU' },
      ],
      current: cfg.render || 'auto',
      onChange: (id) => this.act('render', id),
    });
    if ((cfg.render || 'auto') !== 'auto') {
      const hint = build('div', 'appmenu__hint');
      hint.dataset.setting = 'bubble';
      hint.textContent = 'Se reinicia para aplicarlo. Si su fondo sale negro y esto no lo arregla, vuelve a AUTOMÁTICO.';
      body.append(hint);
    }
    section('ATAJOS', 'shortcuts');
    action('Atajos', { setting: 'shortcuts', chevron: 'shortcuts', onClick: () => this.toggle('shortcuts', state) });
    if (this.expanded === 'shortcuts') {
      for (const s of state.shortcuts || []) {
        action(s.label, s.accel ? { hotkey: s.accel, sub: true, setting: 'shortcuts' } : { value: '—', sub: true, setting: 'shortcuts' });
      }
      action('Abrir config.json', {
        setting: 'shortcuts',
        value: 'EDITAR',
        sub: true,
        onClick: () => this.act('shortcuts-file'),
      });
    }

    // SALIR
    section('SALIR', 'exit');
    action('Salir', { onClick: () => this.act('quit') });

    plate.append(rail, body, keys);
    this.filterSettingsBody(body);
    this.el.replaceChildren(plate);
    if (this.open && this.at && !this.settingsMode) this.place();
    this.useKeyboard(this.expanded === 'fixes' || this.expanded === 'model' || this.capturing);
  }

  filterSettingsBody(body) {
    if (!this.settingsMode) return;
    const groups = {
      model: ['model'], memory: ['memory'], hearing: ['hearing'], apps: ['apps', 'apps-add', 'apps-found', 'apps-test'],
      bubble: ['bubble'], music: ['music'], shortcuts: ['shortcuts'], behavior: ['behavior'],
    };
    const allowed = new Set(groups[this.settingsSection] || []);
    let sectionId = '';
    for (const child of body.children) {
      if (child.classList.contains('appmenu__section')) {
        sectionId = child.dataset.section || '';
        child.hidden = !allowed.has(sectionId);
        continue;
      }
      // Own section id wins; else inherit the last heading (rows under COMPORTAMIENTO / CAJA / …).
      const own = child.dataset.setting || sectionId;
      child.hidden = !allowed.has(own);
    }
  }

  // Her app table: the list (each one editable: aliases, how to close it, delete), adding a
  // program or a link, and "Probar comando" (what she would do, done nothing).
  appsView(state, { body, build, section, action, selector }) {
    const list = state.apps || [];
    action('◀ Volver al menú', {
      onClick: () => {
        this.view = 'main';
        this.resetApps();
        this.render(state);
      },
    });

    section('APPS', 'apps');
    const items = build('div', 'appmenu__apps-list');
    if (!list.length) items.append(build('span', 'appmenu__meta', 'SIN APPS TODAVÍA'));
    for (const app of list) {
      const open = this.appOpen === app.name;
      const row = build('button', 'appmenu__row appmenu__row--action appmenu__app');
      row.type = 'button';
      row.append(build('span', 'appmenu__label', app.name), build('span', 'appmenu__meta', app.typeLabel.toUpperCase()));
      const mark = build('span', 'appmenu__chevron', '›');
      if (open) mark.classList.add('is-open');
      row.append(mark);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.appOpen = open ? null : app.name;
        this.appDelete = null;
        this.appNote = '';
        this.rerender();
      });
      items.append(row);
      items.append(build('div', 'appmenu__hint appmenu__app-aliases', app.aliases.length ? `alias: ${app.aliases.join(', ')}` : 'sin alias'));
      if (open) items.append(this.appEditor(app, { build, selector }));
    }
    body.append(items);

    section('AÑADIR', 'apps-add');
    action('Buscar programa…', {
      value: 'EXE / LNK',
      onClick: async () => {
        const res = await this.host.menuAction({ id: 'apps-pick-program' }).catch(() => ({ ok: false, message: 'No se pudo.' }));
        this.appNote = res?.ok ? `AÑADIDA: ${res.name}` : res?.message || '';
        await this.refresh();
      },
    });
    action('Añadir enlace', {
      chevron: 'link',
      onClick: () => {
        this.linkForm = !this.linkForm;
        this.appNote = '';
        this.rerender();
      },
    });
    if (this.linkForm) body.append(this.linkEditor(build));
    if (this.appNote) body.append(build('div', 'appmenu__hint appmenu__app-note', this.appNote));

    this.foundView(state, { body, build, section, action });

    section('PROBAR COMANDO', 'apps-test');
    const test = build('div', 'appmenu__fix appmenu__apps-test');
    const input = this.textInput(build, this.testText, 'abre Discord y YouTube', 80);
    const result = build('div', 'appmenu__hint', this.testResult || 'Escribe una orden: te digo qué haría, sin hacerlo.');
    let timer = null;
    const check = async () => {
      this.testText = input.value;
      const res = await this.host.menuAction({ id: 'apps-test', value: input.value }).catch(() => null);
      this.testResult = res?.text || '';
      result.textContent = this.testResult || 'Escribe una orden: te digo qué haría, sin hacerlo.';
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(check, 250);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        check();
      }
    });
    test.append(input, result);
    body.append(test);
  }

  // What her scan found on this PC that isn't in the table: filter, add one, scan again.
  foundView(state, { body, build, section, action }) {
    const found = state.found || { items: [] };
    const items = found.items || [];
    section('ENCONTRADO EN ESTA PC', 'apps-found');
    const busy = this.scanning || found.scanning;
    action('Volver a escanear', {
      value: busy ? 'ESCANEANDO…' : found.at ? `HACE ${this.since(found.at)}` : 'NUNCA',
      onClick: async () => {
        if (this.scanning) return;
        this.scanning = true;
        this.foundNote = '';
        this.rerender();
        const res = await this.host.menuAction({ id: 'apps-rescan' }).catch(() => ({ ok: false, message: 'No se pudo escanear.' }));
        this.scanning = false;
        const c = res?.counts;
        this.foundNote = res?.ok && c ? `STEAM ${c.steam} · EPIC ${c.epic} · GOG ${c.gog} · INICIO ${c.start}` : res?.message || '';
        await this.refresh();
      },
    });
    if (this.foundNote) body.append(build('div', 'appmenu__hint appmenu__app-note', this.foundNote));
    if (!items.length) {
      body.append(build('div', 'appmenu__hint', busy ? 'Buscando juegos y programas…' : 'Nada todavía: escanea para ver tus juegos y programas.'));
      return;
    }
    const wrap = build('div', 'appmenu__fix appmenu__found');
    const input = this.textInput(build, this.foundFilter, `Filtrar ${items.length}…`, 40);
    const list = build('div', 'appmenu__apps-list appmenu__found-list');
    const show = () => {
      const q = this.foundFilter.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
      const hits = items.filter((it) => !q || `${it.name} ${it.sourceLabel}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(q));
      const rows = [];
      for (const it of hits.slice(0, 80)) {
        const open = this.foundOpen === it.name;
        const row = build('button', 'appmenu__row appmenu__row--action appmenu__app');
        row.type = 'button';
        row.append(build('span', 'appmenu__label', it.name), build('span', `appmenu__meta appmenu__tag appmenu__tag--${it.source}`, `[${it.sourceLabel}]`));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          this.foundOpen = open ? null : it.name;
          show();
        });
        rows.push(row);
        if (open) {
          const panel = build('div', 'appmenu__fix appmenu__app-edit');
          panel.append(build('div', 'appmenu__hint appmenu__app-target', `${it.typeLabel}: ${it.target}`));
          const actions = build('div', 'appmenu__fix-actions');
          const add = build('button', 'appmenu__toggle-btn appmenu__fix-save is-active', 'AÑADIR A MIS APPS');
          add.type = 'button';
          add.dataset.state = 'on';
          add.addEventListener('click', async (e) => {
            e.stopPropagation();
            const res = await this.host.menuAction({ id: 'apps-promote', value: it.name }).catch(() => ({ ok: false, message: 'No se pudo.' }));
            this.appNote = res?.ok ? `AÑADIDA: ${res.name}` : res?.message || 'No se pudo.';
            this.foundOpen = null;
            await this.refresh();
          });
          actions.append(add);
          panel.append(actions);
          rows.push(panel);
        }
      }
      if (!hits.length) rows.push(build('div', 'appmenu__hint', 'Nada con ese nombre.'));
      if (hits.length > 80) rows.push(build('div', 'appmenu__hint', `y ${hits.length - 80} más: filtra para verlos.`));
      list.replaceChildren(...rows);
    };
    input.addEventListener('input', () => {
      this.foundFilter = input.value;
      show();
    });
    show();
    wrap.append(input, list);
    body.append(wrap);
  }

  // "5 MIN", "3 H", "2 DÍAS"
  since(at) {
    const min = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (min < 60) return `${min} MIN`;
    const h = Math.round(min / 60);
    return h < 48 ? `${h} H` : `${Math.round(h / 24)} DÍAS`;
  }

  // A text field that keeps its keys to itself (Esc still closes the menu).
  textInput(build, value, placeholder, max = 60) {
    const input = build('input', 'appmenu__input');
    input.type = 'text';
    input.value = value || '';
    input.placeholder = placeholder;
    input.maxLength = max;
    input.spellcheck = false;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.onEscape();
      }
    });
    for (const type of ['mousedown', 'click']) input.addEventListener(type, (e) => e.stopPropagation());
    return input;
  }

  appEditor(app, { build, selector }) {
    const panel = build('div', 'appmenu__fix appmenu__app-edit');
    panel.append(build('div', 'appmenu__hint appmenu__app-target', app.target));
    const field = build('label', 'appmenu__fix-field');
    const aliases = this.textInput(build, app.aliases.join(', '), 'otros nombres, separados por comas', 200);
    field.append(build('span', 'appmenu__fix-label', 'Alias'), aliases);
    panel.append(field);
    let close = app.close;
    if (app.windows === 'explorer') {
      panel.append(build('div', 'appmenu__hint', 'Al cerrar: solo sus ventanas. Windows sigue igual.'));
    } else if (app.processes.length || app.dir || app.title) {
      // the selector helper appends to the menu body: build it into this panel instead
      const holder = build('div');
      selector('Al cerrar', {
        options: CLOSE_OPTIONS,
        current: close,
        onChange: (id) => {
          close = id;
          this.saveApp(app, aliases.value, close);
        },
      }, holder);
      panel.append(...holder.childNodes);
      const what = app.processes.length ? `proceso: ${app.processes.join(', ')}`
        : app.dir ? `lo que corra en: ${app.dir}` : `la ventana «${app.title}»`;
      panel.append(build('div', 'appmenu__hint', what));
    } else {
      panel.append(build('div', 'appmenu__hint', 'Sin proceso: esta no la puedo cerrar.'));
    }
    const actions = build('div', 'appmenu__fix-actions');
    const del = build('button', 'appmenu__toggle-btn appmenu__app-delete', this.appDelete === app.name ? 'CONFIRMAR' : 'BORRAR');
    del.type = 'button';
    if (this.appDelete === app.name) del.classList.add('is-danger');
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (this.appDelete !== app.name) {
        this.appDelete = app.name;
        this.rerender();
        return;
      }
      await this.host.menuAction({ id: 'apps-remove', value: app.name });
      this.appOpen = null;
      this.appDelete = null;
      this.appNote = `BORRADA: ${app.name}`;
      await this.refresh();
    });
    const save = build('button', 'appmenu__toggle-btn appmenu__fix-save is-active', 'GUARDAR');
    save.type = 'button';
    save.dataset.state = 'on';
    save.addEventListener('click', (e) => {
      e.stopPropagation();
      this.saveApp(app, aliases.value, close);
    });
    aliases.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.saveApp(app, aliases.value, close);
      }
    });
    actions.append(del, save);
    panel.append(actions);
    return panel;
  }

  async saveApp(app, aliases, close) {
    const res = await this.host.menuAction({ id: 'apps-update', value: { name: app.name, aliases, close } })
      .catch(() => ({ ok: false, message: 'No se pudo guardar.' }));
    this.appNote = res?.ok ? `GUARDADA: ${app.name}` : res?.message || 'No se pudo guardar.';
    await this.refresh();
  }

  linkEditor(build) {
    const panel = build('div', 'appmenu__fix');
    const field = (label, placeholder) => {
      const wrap = build('label', 'appmenu__fix-field');
      const input = this.textInput(build, '', placeholder, label === 'URL' ? 300 : 40);
      wrap.append(build('span', 'appmenu__fix-label', label), input);
      panel.append(wrap);
      return input;
    };
    const name = field('Nombre', 'Twitch');
    const url = field('URL', 'https://www.twitch.tv');
    const save = async () => {
      if (!name.value.trim()) return name.focus();
      if (!url.value.trim()) return url.focus();
      const res = await this.host.menuAction({ id: 'apps-add-link', value: { name: name.value, url: url.value } })
        .catch(() => ({ ok: false, message: 'No se pudo.' }));
      this.appNote = res?.ok ? `AÑADIDA: ${res.name}` : res?.message || 'No se pudo.';
      if (res?.ok) this.linkForm = false;
      return this.refresh();
    };
    for (const input of [name, url]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        }
      });
    }
    const actions = build('div', 'appmenu__fix-actions');
    const btn = build('button', 'appmenu__toggle-btn appmenu__fix-save is-active', 'AÑADIR');
    btn.type = 'button';
    btn.dataset.state = 'on';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      save();
    });
    actions.append(btn);
    panel.append(actions);
    requestAnimationFrame(() => name.focus());
    return panel;
  }

  rerender() {
    if (this.open && this.lastState) this.render(this.lastState);
  }

  // Wake word sensitivity: a % of how sure she must be it was "hey Jarvis". Saved on release,
  // and the sidecar takes it right away.
  sensitivityRow(hearing, build) {
    const wrap = build('div', 'appmenu__slider-wrap');
    const row = build('div', 'appmenu__row');
    const value = build('span', 'appmenu__meta appmenu__slider-value', `${hearing.sensitivity} %`);
    row.append(build('span', 'appmenu__label', 'Sensibilidad'), value);
    const range = build('input', 'appmenu__slider');
    range.type = 'range';
    range.min = String(hearing.sensMin ?? 10);
    range.max = String(hearing.sensMax ?? 90);
    range.step = String(hearing.sensStep ?? 5);
    range.value = String(hearing.sensitivity ?? 20);
    range.setAttribute('aria-label', 'Sensibilidad de la palabra de activación');
    const paint = () => {
      const lo = Number(range.min);
      const pct = ((Number(range.value) - lo) / (Number(range.max) - lo)) * 100;
      range.style.setProperty('--fill', `${pct}%`);
      value.textContent = `${range.value} %`;
    };
    range.addEventListener('input', paint);
    range.addEventListener('change', () => {
      hearing.sensitivity = Number(range.value);
      this.host.menuAction({ id: 'wake-sensitivity', value: Number(range.value) }).catch(() => {});
    });
    for (const type of ['mousedown', 'click']) range.addEventListener(type, (e) => e.stopPropagation());
    paint();
    wrap.append(row, range, build('div', 'appmenu__hint', 'Más alto: menos falsas alarmas, pero hay que decir «hey Jarvis» más claro.'));
    return wrap;
  }

  // Push to talk: the combo, and a way to change it (the next combo you press; Esc cancels).
  talkKeyRow(hearing, build, kbd) {
    const wrap = build('div', 'appmenu__talkkey');
    const row = build('button', 'appmenu__row appmenu__row--action');
    row.type = 'button';
    row.append(build('span', 'appmenu__label', 'Tecla para hablar'));
    if (this.capturing) row.append(build('span', 'appmenu__meta appmenu__capture', 'PULSA LA COMBINACIÓN…'));
    else if (hearing.talkHotkey) row.append(kbd(hearing.talkHotkey));
    row.append(build('span', 'appmenu__meta', this.capturing ? 'ESC' : 'CAMBIAR'));
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      this.capturing = !this.capturing;
      this.talkNote = '';
      this.rerender();
    });
    wrap.append(row);
    const note = this.capturing ? 'Ctrl, Alt o Win más una tecla. Esc cancela.'
      : this.talkNote || (hearing.talkActive ? '' : 'No se pudo registrar: elige otra combinación.');
    if (note) wrap.append(build('div', 'appmenu__hint', note));
    return wrap;
  }

  // Model name and key: the key is typed here, saved encrypted, and never shown back (Paso 4K).
  modelPanel(model, { build }) {
    const panel = build('div', 'appmenu__fix');
    const field = build('label', 'appmenu__fix-field');
    const name = this.textInput(build, model.model, model.local ? 'google/gemma-4-e2b' : 'el nombre exacto del modelo', 120);
    field.append(build('span', 'appmenu__fix-label', 'Modelo'), name);
    const save = build('button', 'appmenu__toggle-btn appmenu__fix-save is-active', 'GUARDAR');
    save.type = 'button';
    save.dataset.state = 'on';
    const actions = build('div', 'appmenu__fix-actions');
    actions.append(save);
    const note = build('div', 'appmenu__hint', this.modelNote);
    const saveModel = async () => {
      const res = await this.host.menuAction({ id: 'model-set', value: name.value.trim() })
        .catch(() => ({ ok: false, message: 'No se pudo guardar.' }));
      this.modelNote = res?.ok ? `MODELO: ${res.model}` : res?.message || 'No se pudo guardar.';
      await this.refresh();
    };
    save.addEventListener('click', (e) => {
      e.stopPropagation();
      saveModel();
    });
    name.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      saveModel();
    });
    panel.append(field, actions);

    if (model.provider === 'openrouter') {
      panel.append(build('div', 'appmenu__hint', 'En OpenRouter el nombre va exacto, con el proveedor delante: openai/gpt-4o-mini.'));
    }

    if (!model.local) {
      const keyField = build('label', 'appmenu__fix-field');
      const key = build('input', 'appmenu__input');
      key.type = 'password';
      key.value = '';
      key.placeholder = model.hasKey ? 'clave guardada: pega otra para cambiarla' : 'pega tu clave de ' + this.providerLabel(model, 'la nube');
      key.spellcheck = false;
      key.autocomplete = 'off';
      key.addEventListener('keydown', (e) => e.stopPropagation());
      for (const type of ['mousedown', 'click']) key.addEventListener(type, (e) => e.stopPropagation());
      keyField.append(build('span', 'appmenu__fix-label', 'Clave'), key);
      const keyActions = build('div', 'appmenu__fix-actions');
      const saveKey = build('button', 'appmenu__toggle-btn appmenu__fix-save is-active', 'GUARDAR CLAVE');
      saveKey.type = 'button';
      saveKey.dataset.state = 'on';
      saveKey.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await this.host.menuAction({ id: 'model-key', value: { provider: model.provider, key: key.value } })
          .catch(() => ({ ok: false, message: 'No se pudo guardar.' }));
        this.modelNote = res?.message || '';
        await this.refresh();
      });
      keyActions.append(saveKey);
      if (model.hasKey) {
        const drop = build('button', 'appmenu__toggle-btn appmenu__app-delete', 'BORRAR');
        drop.type = 'button';
        drop.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await this.host.menuAction({ id: 'model-key', value: { provider: model.provider, key: '' } })
            .catch(() => ({ ok: false, message: 'No se pudo borrar.' }));
          this.modelNote = res?.message || '';
          await this.refresh();
        });
        keyActions.append(drop);
      }
      panel.append(keyField, keyActions,
        build('div', 'appmenu__hint', 'La clave se guarda cifrada con tu cuenta de Windows, fuera de config.json.'));
    }
    panel.append(note);
    return panel;
  }

  providerLabel(model, fallback) {
    return (model.providers || []).find((p) => p.id === model.provider)?.label || fallback;
  }

  async saveShare(patch) {
    await this.host.menuAction({ id: 'model-share', value: patch }).catch(() => {});
    await this.refresh();
  }

  async saveTalkKey(keys) {
    let result;
    try {
      result = await this.host.menuAction({ id: 'talk-hotkey', value: keys });
    } catch {
      result = { ok: false, message: 'No se pudo guardar.' };
    }
    this.capturing = false;
    this.talkNote = result?.ok ? `GUARDADA: ${result.accel}` : result?.message || 'Esa no sirve.';
    await this.refresh();
  }

  // Corregir lo último: what she heard last, two fields (what she heard, what you meant), and the
  // fixes she already has, each with a way to drop it.
  fixPanel(hearing, build) {
    const panel = build('div', 'appmenu__fix');
    const last = String(hearing.lastHeard || '');
    const heardLine = build('div', 'appmenu__fix-last');
    heardLine.append(
      build('span', 'appmenu__meta', 'OYÓ'),
      build('span', 'appmenu__fix-said', last ? `«${last}»` : 'Todavía no oyó nada.'),
    );
    const field = (label, value, placeholder) => {
      const wrap = build('label', 'appmenu__fix-field');
      const input = build('input', 'appmenu__input');
      input.type = 'text';
      input.value = value;
      input.placeholder = placeholder;
      input.maxLength = 60;
      input.spellcheck = false;
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.onEscape();
        }
      });
      wrap.append(build('span', 'appmenu__fix-label', label), input);
      return { wrap, input };
    };
    const heard = field('Lo que oyó', last, 'la palabra que entendió mal');
    const meant = field('Lo que quise decir', '', 'cómo se lee');
    const saveBtn = build('button', 'appmenu__toggle-btn appmenu__fix-save is-active', 'GUARDAR');
    saveBtn.type = 'button';
    saveBtn.dataset.state = 'on';
    const note = build('span', 'appmenu__meta', this.fixNote);
    const save = async () => {
      const h = heard.input.value.trim();
      const m = meant.input.value.trim();
      if (!h || !m) {
        (h ? meant : heard).input.focus();
        return;
      }
      await this.host.menuAction({ id: 'fix-add', value: { heard: h, meant: m } });
      this.fixNote = 'GUARDADO';
      await this.refresh();
    };
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      save();
    });
    const actions = build('div', 'appmenu__fix-actions');
    actions.append(note, saveBtn);
    panel.append(heardLine, heard.wrap, meant.wrap, actions);

    const list = build('div', 'appmenu__fix-list');
    if (!hearing.fixes.length) list.append(build('span', 'appmenu__meta', 'SIN CORRECCIONES'));
    for (const fix of hearing.fixes) {
      const row = build('div', 'appmenu__row appmenu__row--sub appmenu__fix-item');
      row.append(build('span', 'appmenu__label', `${fix.heard} → ${fix.meant}`));
      const drop = build('button', 'appmenu__arrow', '✕');
      drop.type = 'button';
      drop.title = 'Borrar';
      drop.setAttribute('aria-label', `Borrar ${fix.heard}`);
      drop.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.host.menuAction({ id: 'fix-remove', value: fix.heard });
        this.fixNote = 'BORRADO';
        await this.refresh();
      });
      row.append(drop);
      list.append(row);
    }
    panel.append(list);
    // the field to type in: what you meant when she heard something, else what she heard
    const first = last ? meant.input : heard.input;
    requestAnimationFrame(() => first.focus());
    setTimeout(() => first.focus(), 80);
    return panel;
  }

  async refresh() {
    if (!this.open) return;
    const state = await this.host.getMenu({ folded: this.folded() });
    if (!this.open) return; // closed while it was asked: don't take the keyboard for a hidden menu
    this.render(state);
  }

  toggle(name, state) {
    this.confirmForget = false;
    this.fixNote = '';
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
    const keep = this.settingsMode || id === 'mic' || id === 'mic-device' || id === 'reply-mode' || id === 'music-player'
      || id === 'model-provider' || id === 'spotify-connect' || id === 'spotify-disconnect' || id === 'drag-lock' || id === 'theme'
      || id === 'startup' || id === 'gaming-mode' || id === 'drone-mode' || id === 'comments' || id === 'comments-range'
      || id === 'greetings' || id === 'unlock-greeting' || id === 'caresses' || id === 'music-dance'
      || id === 'app-fx' || id === 'scanlines';
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
