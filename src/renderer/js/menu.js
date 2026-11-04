// Overlay context menu, laid out like the Cyberpunk 2077 settings plate: coral labels,
// toggles as OFF|ON blocks, selectors as ◀ value ▶, and microtext on the rails.

import { clamp } from './util.js';
import { HELP_STEPS, toggleHelp, splitHelpText } from './help-steps.js';

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

// Keep the "?" panel inside its host (.appmenu). Settings uses overflow:hidden on the
// content pane — viewport-relative left flips used to park half the panel under the tabs.
export function placeHelpPanel({ main, anchor, width, height, pad = 8, gap = 8 } = {}) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  let x = anchor.right + gap;
  if (x + w > main.right - pad) x = anchor.left - gap - w;
  if (x < main.left + pad) x = main.left + pad;
  if (x + w > main.right - pad) x = Math.max(main.left + pad, main.right - pad - w);

  let y = anchor.top;
  if (y + h > main.bottom - pad) y = Math.max(main.top + pad, main.bottom - pad - h);
  if (y < main.top + pad) y = main.top + pad;
  return { left: x - main.left, top: y - main.top };
}

// One Esc press peels one layer; never leave a blank plate in settings.
export function menuEscapeStep({ capturing, helpOpen, quickOpen, expanded, view, settingsMode } = {}) {
  if (capturing) return 'cancel-capture';
  if (helpOpen) return 'close-help';
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
  { id: 'model', label: 'Cerebro' }, { id: 'agents', label: 'Agentes' },
  { id: 'memory', label: 'Memoria' },
  { id: 'hearing', label: 'Oído' }, { id: 'apps', label: 'Mis apps' },
  { id: 'bubble', label: 'Apariencia' }, { id: 'music', label: 'Música / Reproductor' },
  { id: 'shortcuts', label: 'Atajos' }, { id: 'behavior', label: 'Comportamiento' },
  { id: 'about', label: 'Acerca de' },
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
    this.confirmSoftware = false; // Apariencia › Pantalla › SIN GPU: ask once before relaunch
    this.onOpenChange = null;
    this.fixNote = '';     // "GUARDADO" under Corregir lo último, once a fix is saved
    this.keyboard = false; // Corregir lo último has text fields: the overlay has the keyboard
    this.capturing = false; // OÍDO › Tecla para hablar: waiting for the new combo
    this.talkNote = '';     // what came of the last combo (taken, saved...)
    this.lastState = null;
    this.view = 'main';     // 'apps': her app table instead of the menu (Paso 4C)
    this.appOpen = null;    // the app being edited
    this.appNote = '';      // what came of the last add / save / delete
    this.gameNote = '';
    this.appDelete = null;  // BORRAR pressed once: the next press deletes
    this.linkForm = false;  // Añadir enlace open
    this.testText = '';     // Probar comando
    this.testResult = '';
    this.foundFilter = '';  // Encontrado en esta PC (Paso 4D)
    this.foundOpen = null;
    this.foundNote = '';
    this.scanning = false;
    this.modelNote = '';   // first-run Capri welcome (or last cerebro note)
    this.agentNote = '';   // last Agentes install / remove result
    this.probeNote = '';   // last Probar result
    this.probeOk = false;
    this.settingsMode = false;
    this.settingsSection = 'model';
    this.quickOpen = null;
    this.quickAnchor = null;
    this.helpOpen = null;
    this.helpAnchor = null;
    this.voiceNote = '';
    this.voiceInstall = null; // live progress from main (voice:install)
    this.voiceOmni = null;    // null = follow NVIDIA detect; boolean = checkbox override
    this.voiceRefForm = false; // Usar mi propia voz… transcript step
    this.pendingRefWav = '';
    this.pendingRefText = '';
    this.pendingRefTranscriptPath = '';
    this.voiceDetails = false;

    if (typeof this.host.onVoiceInstall === 'function') {
      this.host.onVoiceInstall((payload) => {
        this.voiceInstall = payload || null;
        if (this.open && this.settingsMode && this.lastState) this.render(this.lastState);
      });
    }

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
    // A help panel closes on a click anywhere outside it and its "?".
    window.addEventListener('mousedown', (e) => {
      if (!this.helpOpen) return;
      if (e.target?.closest?.('.appmenu__help, .appmenu__submenu--help')) return;
      this.helpOpen = null;
      this.rerender();
    }, true);
  }

  get visible() {
    return this.open || this.opening;
  }

  async show(x, y, avoid, expand = null) {
    this.opening = true;
    this.openedAt = performance.now();
    this.onOpenChange?.(true);
    console.time('menu:show');
    try {
      this.expanded = expand === 'apps' ? null : expand;
      this.view = expand === 'apps' ? 'apps' : 'main';
      this.resetApps();
      this.confirmForget = false;
      this.confirmSoftware = false;
      this.fixNote = '';
      this.gameNote = '';
      this.modelNote = '';
      this.at = { x, y };
      this.avoid = avoid || { left: x, top: y, right: x, bottom: y };
      // paint texts immediately from cache so the plate is never empty while IPC runs
      if (this.lastState) {
        this.render(this.lastState);
        this.open = true;
        this.el.hidden = false;
        this.place();
        console.timeLog('menu:show', 'painted-cache');
      }
      // light: skip PATH CLI scans / agents / found apps (those belong in Ajustes)
      const state = await this.host.getMenu({ folded: this.folded(), light: true });
      console.timeLog('menu:show', 'getMenu-light');
      if (!this.opening && !this.open) return;
      this.render(state);
      this.open = true;
      this.el.hidden = false;
      this.place();
      this.openedAt = performance.now();
      this.onOpenChange?.(true);
      console.timeEnd('menu:show');
    } catch (err) {
      console.error('[capri] menu show failed', err);
      this.opening = false;
      this.open = false;
      this.el.hidden = true;
      this.onOpenChange?.(false);
      console.timeEnd('menu:show');
    } finally {
      this.opening = false;
    }
  }

  // Esc: close one layer (submenu → parent), or the whole menu / settings window.
  onEscape() {
    const step = menuEscapeStep({
      capturing: this.capturing,
      helpOpen: this.helpOpen,
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
    if (step === 'close-help') {
      this.helpOpen = null;
      if (this.lastState) this.render(this.lastState);
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
    this.helpOpen = null;
    this.confirmForget = false;
    this.confirmSoftware = false;
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
    this.helpOpen = null;
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
    try {
      this.renderFull(state);
    } catch (err) {
      console.error('[capri] settings render failed:', err);
      this.lastState = state;
      const line = document.createElement('div');
      line.className = 'appmenu__hint appmenu__brain-status is-bad';
      line.textContent = `No se pudo dibujar esta sección: ${err?.message || 'error desconocido'}`;
      this.el.replaceChildren(line);
    }
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
    row('Dron en No molestar', cfg.gaming?.drone === false ? 'NO' : 'SÍ', 'drone-mode',
      (anchor) => openSubmenu('drone-mode', [{ id: false, label: 'NO' }, { id: true, label: 'SÍ' }],
        cfg.gaming?.drone !== false, 'drone-mode', anchor));
    row('No molestar', cfg.gaming?.fgKey || 'SIN APP ACTIVA', 'game-list',
      (anchor) => openSubmenu('game-list', [
        { id: 'allow', label: 'SILENCIAR EN ESTA APP' },
        { id: 'ignore', label: 'NO SILENCIAR NUNCA' },
        { id: 'remove', label: 'SACAR DE LA LISTA' },
      ], null, 'game-list', anchor));
    if (this.gameNote) body.append(build('div', 'appmenu__hint', this.gameNote));
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
    // One popout at a time: the help panel takes the submenu's place while it is open.
    if (this.quickOpen && !this.helpOpen) {
      const menu = build('div', 'appmenu__submenu');
      const title = build('div', 'appmenu__submenu-title', this.quickOptions.id === 'game-list' ? 'NO MOLESTAR' : this.quickOptions.id.toUpperCase());
      if (this.quickOptions.id === 'game-list') title.append(this.helpButton('gaming'));
      menu.append(title);
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
    if (this.helpOpen) {
      const panel = this.helpPanel(this.helpOpen, build);
      if (panel) this.el.append(panel);
    }
    requestAnimationFrame(() => this.placeSubmenu());
    if (this.open && this.at && !this.settingsMode) this.place();
  }

  placeSubmenu() {
    const menu = this.el.querySelector('.appmenu__submenu');
    if (!menu) return;
    const host = this.el.getBoundingClientRect();
    if (!host.width) return;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    // After re-render the old rect is stale (scroll restore); prefer the live "?".
    const live = this.helpOpen
      && this.el.querySelector(`.appmenu__help[data-help="${this.helpOpen}"]`);
    if (live) this.helpAnchor = live.getBoundingClientRect();
    if (this.helpOpen && this.helpAnchor) {
      const { left, top } = placeHelpPanel({
        main: host, anchor: this.helpAnchor, width: w, height: h,
      });
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      return;
    }
    // Quick-menu selector: park beside the plate (same as before).
    const main = (this.el.querySelector('.appmenu__quick-plate') || this.el.querySelector('.appmenu__plate'))?.getBoundingClientRect() || host;
    const anchor = this.quickAnchor || main;
    const right = main.right + 8;
    const leftSide = main.left - w - 8;
    const x = right + w <= innerWidth - 8 ? right : Math.max(8, leftSide);
    const y = Math.min(Math.max(8, anchor.top ?? main.top), innerHeight - h - 8);
    menu.style.left = `${Math.round(x - host.left)}px`;
    menu.style.top = `${Math.round(y - host.top)}px`;
  }

  // The "?" that opens a HELP_STEPS panel, in Ajustes and in the quick menu.
  helpButton(helpId) {
    // A span, not a button: some rows are buttons and a nested one is invalid HTML.
    const btn = document.createElement('span');
    btn.className = 'appmenu__help';
    btn.textContent = '?';
    btn.setAttribute('role', 'button');
    btn.tabIndex = 0;
    btn.dataset.help = helpId;
    btn.title = 'Cómo se hace';
    btn.setAttribute('aria-expanded', String(this.helpOpen === helpId));
    const openHelp = () => {
      this.helpOpen = toggleHelp(this.helpOpen, helpId);
      this.helpAnchor = null; // placeSubmenu reads the live "?" after render
      if (this.lastState) this.render(this.lastState);
      else requestAnimationFrame(() => this.placeSubmenu());
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openHelp();
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      openHelp();
    });
    return btn;
  }

  // The numbered steps for one "?", beside the button that opened it.
  // http(s) in the copy open via menu open-url → shell.openExternal (never inside Capri).
  helpPanel(helpId, build) {
    const help = HELP_STEPS[helpId];
    if (!help) return null;
    const menu = build('div', 'appmenu__submenu appmenu__submenu--help');
    menu.dataset.help = helpId;
    menu.append(build('div', 'appmenu__submenu-title', help.title.toUpperCase()));
    if (help.note) menu.append(build('div', 'appmenu__hint', help.note));
    const list = build('ol', 'appmenu__help-list');
    const fillText = (parent, text) => {
      for (const part of splitHelpText(text)) {
        if (part.type === 'url') {
          const a = build('a', 'appmenu__help-link', part.value);
          a.href = part.value;
          a.rel = 'noopener noreferrer';
          a.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.host.menuAction({ id: 'open-url', value: part.value }).catch(() => {});
          });
          parent.append(a);
        } else {
          parent.append(document.createTextNode(part.value));
        }
      }
    };
    for (const step of help.steps) {
      const item = build('li', 'appmenu__help-step');
      if (typeof step === 'string') {
        fillText(item, step);
      } else {
        const line = build('div', '');
        fillText(line, step.text);
        item.append(line);
        const cmd = build('div', 'appmenu__help-cmd');
        const code = build('code', 'appmenu__help-code', step.command);
        // Command row may be a URL: same external open on click, plus COPIAR.
        if (/^https?:\/\//i.test(String(step.command || ''))) {
          code.classList.add('appmenu__help-link');
          code.setAttribute('role', 'link');
          code.tabIndex = 0;
          const openCmd = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.host.menuAction({ id: 'open-url', value: step.command }).catch(() => {});
          };
          code.addEventListener('click', openCmd);
          code.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') openCmd(e);
          });
        }
        cmd.append(code);
        const copy = build('button', 'appmenu__toggle-btn', 'COPIAR');
        copy.type = 'button';
        copy.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(step.command);
            copy.textContent = 'COPIADO';
          } catch { /* no clipboard: the command is still on screen */ }
        });
        cmd.append(copy);
        item.append(cmd);
      }
      list.append(item);
    }
    menu.append(list);
    return menu;
  }

  renderFull(state) {
    // Re-render replaces the scrollable body; keep the user's place in Cerebro / long tabs.
    const prevScroll = this.settingsMode
      ? (this.el.querySelector('.appmenu__body')?.scrollTop || 0)
      : 0;
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

    const section = (title, id = title, help = '') => {
      const heading = build('div', 'appmenu__section');
      heading.dataset.section = id;
      heading.append(build('span', 'appmenu__section-title', title));
      if (help) heading.append(this.helpButton(help));
      body.append(heading);
    };

    // The "?" sits right next to its label, never taking the row's action.
    const labelNode = (text, help = '') => {
      if (!help) return build('span', 'appmenu__label', text);
      const wrap = build('span', 'appmenu__label appmenu__label--help');
      wrap.append(build('span', '', text), this.helpButton(help));
      return wrap;
    };

    const action = (label, { value = '', hotkey = '', danger = false, sub = false, chevron = '', setting = '', onClick, help = '' } = {}) => {
      const row = build(onClick ? 'button' : 'div', 'appmenu__row appmenu__row--action');
      if (onClick) row.type = 'button';
      if (danger) row.classList.add('is-danger');
      if (sub) row.classList.add('appmenu__row--sub');
      if (setting) row.dataset.setting = setting;
      row.append(labelNode(label, help));
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

    const selector = (label, { options, current, onChange, setting = '', help = '' }, into = body) => {
      const index = Math.max(0, options.findIndex((o) => String(o.id) === String(current)));
      const row = build('div', 'appmenu__row');
      if (setting) row.dataset.setting = setting;
      row.append(labelNode(label, help));
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
      if (placed.hint) into.append(build('div', 'appmenu__hint', placed.hint));
    };

    if (this.view === 'apps') {
      this.appsView(state, { body, build, kbd, section, action, selector });
      plate.append(rail, body, keys);
      this.filterSettingsBody(body);
      this.el.replaceChildren(plate);
      this.restoreSettingsScroll(prevScroll);
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
    selector('Sensibilidad de la palabra', {
      options: [
        { id: 'low', label: 'BAJA' },
        { id: 'normal', label: 'NORMAL' },
        { id: 'high', label: 'ALTA' },
      ],
      current: String(cfg.wakeSensitivity || 'normal'),
      onChange: (id) => this.act('wake-level', id),
      help: 'wake',
    });
    selector('Respuesta', {
      options: REPLY_OPTIONS,
      current: String(cfg.replyMode || 'blips'),
      onChange: (id) => this.act('reply-mode', id),
      help: 'voice',
    });
    const voice = cfg.voice || { dir: '', status: '' };
    action('Carpeta de voz', {
      help: 'hearing',
      value: String(voice.dir || '').split(/[\\/]/).filter(Boolean).pop() || 'SIN CARPETA',
      onClick: async () => {
        const res = await this.host.menuAction({ id: 'voice-dir' }).catch(() => ({ ok: false, message: 'No se pudo.' }));
        this.voiceNote = res?.message || '';
        await this.refresh();
      },
    });
    const install = this.voiceInstall || state.voiceInstall || {};
    const installBusy = Boolean(install.busy);
    const hasNvidia = Boolean(install.hasNvidia);
    const omniChecked = this.voiceOmni == null ? hasNvidia : Boolean(this.voiceOmni);
    const installRow = build('div', 'appmenu__voice-install');
    const installBtns = build('div', 'appmenu__voice-install-btns');
    const installed = Boolean(voice.installed || install.installed);
    const installBtn = build('button', `appmenu__toggle-btn is-active${installBusy ? ' is-busy' : ''}`, installBusy ? 'Instalando…' : installed ? 'Voz ya instalada ✓' : 'Instalar voz');
    installBtn.type = 'button';
    installBtn.dataset.state = 'on';
    installBtn.disabled = installBusy;
    installBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.voiceNote = '';
      this.voiceInstall = { ...(this.voiceInstall || {}), busy: true, phase: 'download', label: 'Descargando…', lines: [] };
      this.render(this.lastState);
      const res = await this.host.menuAction({
        id: 'voice-install',
        value: { omniVoice: omniChecked },
      }).catch((err) => ({ ok: false, message: err?.message || 'No se pudo.' }));
      this.voiceNote = res?.message || (res?.ok ? 'Voz instalada' : '');
      if (res?.needPython) {
        this.voiceInstall = {
          ...(this.voiceInstall || {}),
          busy: false,
          phase: 'error',
          label: 'Error',
          needPython: true,
          error: res.message,
          lines: [res.message].filter(Boolean),
        };
      }
      await this.refresh();
    });
    const cancelBtn = build('button', 'appmenu__toggle-btn', 'Cancelar');
    cancelBtn.type = 'button';
    cancelBtn.disabled = !installBusy;
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.host.menuAction({ id: 'voice-install-cancel' }).catch(() => {});
    });
    installBtns.append(installBtn, cancelBtn);
    if (installed && !installBusy) {
      const reinstall = build('button', 'appmenu__toggle-btn', 'Reinstalar');
      reinstall.type = 'button';
      reinstall.addEventListener('click', (e) => installBtn.click(e));
      installBtns.append(reinstall);
    }
    installRow.append(installBtns);
    if (!hasNvidia) {
      const omni = build('label', 'appmenu__voice-omni');
      const box = build('input', '');
      box.type = 'checkbox';
      box.checked = omniChecked;
      box.disabled = installBusy;
      box.addEventListener('change', () => {
        this.voiceOmni = box.checked;
      });
      omni.append(box, document.createTextNode(' OmniVoice (mejor con GPU NVIDIA)'));
      installRow.append(omni);
    } else {
      installRow.append(build('div', 'appmenu__hint', 'GPU NVIDIA detectada: se instala OmniVoice.'));
    }
    if (state.vcMissing || install.needVc) {
      const vcRow = build('div', 'appmenu__voice-install-btns');
      const vcBtn = build('button', 'appmenu__toggle-btn is-active', 'Instalar VC++ x64');
      vcBtn.type = 'button';
      vcBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.host.menuAction({ id: 'open-vc' }).catch(() => {});
      });
      vcRow.append(vcBtn);
      installRow.append(build('div', 'appmenu__hint', state.vcMessage || 'Falta Microsoft Visual C++ Redistributable (x64).'), vcRow);
    }
    if (install.needPython || (install.phase === 'error' && /Python 3\.11/i.test(String(install.error || this.voiceNote || '')))) {
      const pyRow = build('div', 'appmenu__voice-install-btns');
      const pyBtn = build('button', 'appmenu__toggle-btn is-active', 'Bajar Python 3.11');
      pyBtn.type = 'button';
      pyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.host.menuAction({ id: 'open-python' }).catch(() => {});
      });
      pyRow.append(pyBtn);
      installRow.append(build('div', 'appmenu__hint', install.error || this.voiceNote || 'Falta Python 3.11.'), pyRow);
    }
    if (install.label || installBusy) {
      const progress = build('div', 'appmenu__voice-progress');
      progress.append(build('div', 'appmenu__voice-progress-label', install.label || (installBusy ? 'Descargando…' : '')));
      const bar = build('div', 'appmenu__voice-progress-bar');
      const fill = build('span');
      fill.style.width = install.phase === 'done' ? '100%' : install.phase === 'install' ? '70%' : '35%';
      bar.append(fill);
      progress.append(bar);
      installRow.append(progress);
    }
    if (Array.isArray(install.lines) && install.lines.length) {
      const details = build('button', 'appmenu__toggle-btn', this.voiceDetails ? 'Ocultar detalles' : 'Ver detalles');
      details.type = 'button';
      details.addEventListener('click', (e) => {
        e.stopPropagation();
        this.voiceDetails = !this.voiceDetails;
        this.render(this.lastState);
      });
      installRow.append(details);
      if (this.voiceDetails) installRow.append(build('pre', 'appmenu__voice-log', install.lines.join('\n')));
    }
    body.append(installRow);
    const voiceSource = voice.source || voice.ttsSourceName
      || (String(voice.ttsRef || '').trim() ? `Tu voz (${String(voice.ttsRef).split(/[\\/]/).pop()})` : 'Voz por defecto');
    body.append(build('div', 'appmenu__hint appmenu__voice-source', `Voz activa: ${voiceSource}`));
    if (this.voiceRefForm) {
      const form = build('div', 'appmenu__voice-ref');
      form.append(build('div', 'appmenu__hint', this.pendingRefWav
        ? `Archivo: ${String(this.pendingRefWav).split(/[\\/]/).pop()}`
        : 'Elegí un .wav corto (5–15 s).'));
      const transcript = build('input', 'appmenu__input');
      let saveRef;
      transcript.type = 'text';
      transcript.placeholder = 'Transcripción exacta del audio';
      transcript.value = this.pendingRefText || '';
      transcript.maxLength = 500;
      transcript.spellcheck = true;
      transcript.hidden = Boolean(this.pendingRefTranscriptPath);
      transcript.addEventListener('input', () => {
        this.pendingRefText = transcript.value;
        if (saveRef) saveRef.disabled = !transcript.value.trim();
      });
      saveRef = build('button', 'appmenu__toggle-btn is-active', 'GUARDAR VOZ');
      saveRef.type = 'button';
      saveRef.disabled = !this.pendingRefTranscriptPath && !transcript.value.trim();
      saveRef.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await this.host.menuAction({
          id: 'voice-ref-save',
          value: {
            path: this.pendingRefWav,
            transcript: transcript.value,
            transcriptPath: this.pendingRefTranscriptPath,
          },
        }).catch(() => ({ ok: false, message: 'No se pudo.' }));
        this.voiceNote = res?.message || '';
        if (res?.ok) {
          this.voiceRefForm = false;
          this.pendingRefWav = '';
          this.pendingRefText = '';
          this.pendingRefTranscriptPath = '';
        }
        await this.refresh();
      });
      const cancelRef = build('button', 'appmenu__toggle-btn', 'CANCELAR');
      cancelRef.type = 'button';
      cancelRef.addEventListener('click', (e) => {
        e.stopPropagation();
        this.voiceRefForm = false;
        this.pendingRefWav = '';
        this.pendingRefText = '';
        this.pendingRefTranscriptPath = '';
        this.render(this.lastState);
      });
      const refBtns = build('div', 'appmenu__voice-install-btns');
      refBtns.append(saveRef, cancelRef);
      form.append(transcript, refBtns);
      body.append(form);
    } else {
      const refRow = build('div', 'appmenu__voice-install-btns');
      const custom = String(voice.ttsRef || '').trim();
      const useMine = build('button', `appmenu__toggle-btn${custom ? ' is-active' : ''}`,
        custom ? `${voice.source || 'Tu voz'} ✓` : 'Usar mi propia voz…');
      useMine.type = 'button';
      useMine.dataset.state = custom ? 'on' : 'off';
      useMine.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await this.host.menuAction({ id: 'voice-ref-pick' }).catch(() => null);
        if (!res?.ok || !res.path) return;
        this.pendingRefWav = res.path;
        this.pendingRefTranscriptPath = res.transcriptPath || '';
        this.pendingRefText = '';
        this.voiceRefForm = true;
        this.render(this.lastState);
      });
      refRow.append(useMine);
      const clear = build('button', `appmenu__toggle-btn${custom ? '' : ' is-active'}`,
        custom ? 'Voz por defecto' : 'Voz por defecto ✓');
      clear.type = 'button';
      clear.dataset.state = custom ? 'off' : 'on';
      clear.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await this.host.menuAction({ id: 'voice-ref-clear' }).catch(() => null);
        this.voiceNote = res?.message || 'Voz por defecto.';
        await this.refresh();
      });
      refRow.append(clear);
      body.append(refRow);
    }
    body.append(build(
      'div',
      'appmenu__hint',
      this.voiceNote || voice.dir || 'Instalá la voz con un clic, o elegí una carpeta con server.py y setup.ps1.',
    ));
    if (voice.status) body.append(build('div', 'appmenu__hint', voice.status));

    section('MÚSICA', 'music', 'spotify');
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

    // CEREBRO: three cards (free key / on this PC / own key) — fase 5
    section('CEREBRO', 'model', 'brain');
    const model = state.model || {
      providers: [{ id: 'local', label: 'LM Studio' }], provider: 'local', model: '', local: true,
      groups: { free: ['gemini', 'nvidia'], local: ['local', 'ollama'], own: ['openai', 'deepseek', 'gemini', 'openrouter', 'groq', 'mistral'] },
      freeLinks: {},
      hasKeys: {},
      baseUrl: 'http://localhost:1235/v1',
    };
    if (this.modelNote) {
      const welcome = build('div', 'appmenu__hint appmenu__brain-welcome', this.modelNote);
      welcome.dataset.setting = 'model';
      body.append(welcome);
    }
    body.append(this.brainPanel(model, { build }));
    toggle('Enviar mi pantalla cuando le pida mirar', {
      setting: 'model',
      on: model.shareScreen,
      labels: ['NO', 'SÍ'],
      onChange: (on) => this.saveShare({ shareScreen: on }),
    });
    toggle('Mirar sola de vez en cuando', {
      setting: 'model',
      on: model.autoLook,
      labels: ['NO', 'SÍ'],
      onChange: (on) => this.saveShare({ autoLook: on, ...(on ? { shareScreen: true } : {}) }),
    });
    toggle('Enviar lo que recuerda de mí', {
      setting: 'model',
      on: model.shareMemory,
      labels: ['NO', 'SÍ'],
      onChange: (on) => this.saveShare({ shareMemory: on }),
    });
    const privacy = build(
      'div',
      'appmenu__hint',
      model.shareScreen
        ? (model.vision
          ? 'Con «mirá mi pantalla» te mando una foto JPEG (solo memoria) a este cerebro.'
          : 'Este cerebro no ve imágenes; con Gemini sí. Activá el interruptor igual para cuando cambies.')
        : 'Apagados, a la nube solo va lo que le escribes. En tu PC (LM Studio / Ollama) nada sale.',
    );
    privacy.dataset.setting = 'model';
    body.append(privacy);

    // AGENTES: who can tell her what they're doing (Phase 6A)
    section('AGENTES', 'agents', 'agents');
    const agents = state.agents || [];
    for (const agent of agents) {
      const stateLabel = !agent.found ? 'NO ENCONTRADO' : agent.installed ? 'INSTALADO' : 'NO INSTALADO';
      action(agent.name, {
        setting: 'agents',
        value: agent.installed ? 'QUITAR' : 'INSTALAR',
        onClick: async () => {
          const res = await this.host.menuAction({
            id: agent.installed ? 'agent-remove' : 'agent-install',
            value: agent.id,
          }).catch(() => ({ ok: false, message: 'No se pudo.' }));
          this.agentNote = res?.ok
            ? (agent.installed ? `${agent.name}: hooks quitados.` : `${agent.name}: hooks instalados. Reiniciá el agente.`)
            : res?.message || `No se pudo con ${agent.name}.`;
          await this.refresh();
        },
      });
      const file = build('div', 'appmenu__hint', `${stateLabel} · ${agent.file}`);
      file.dataset.setting = 'agents';
      body.append(file);
    }
    if (!agents.length) {
      const empty = build('div', 'appmenu__hint', 'No encontré agentes compatibles en esta PC.');
      empty.dataset.setting = 'agents';
      body.append(empty);
    }
    if (this.agentNote) {
      const note = build('div', 'appmenu__hint', this.agentNote);
      note.dataset.setting = 'agents';
      body.append(note);
    }
    const agentsHint = build('div', 'appmenu__hint', 'Codex pide confiar en los hooks con /hooks. Los demás los cargan al reiniciar.');
    agentsHint.dataset.setting = 'agents';
    body.append(agentsHint);

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
    selector('Pausa antes de cortar', {
      options: [
        { id: 'short', label: 'CORTA · 0.8 s' },
        { id: 'normal', label: 'NORMAL · 1.4 s' },
        { id: 'long', label: 'LARGA · 2.2 s' },
      ],
      current: String(hearing.pauseBeforeCut || 'normal'),
      onChange: (id) => this.act('pause-before-cut', id),
      help: 'talk',
    });

    // APPS: what "abre X" / "cierra X" reach, in a panel of its own
    section('APPS', 'apps', 'apps');
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
    section('NO MOLESTAR', 'behavior', 'gaming');
    toggle('Dron en No molestar', {
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
    const renderOptions = [
      { id: 'auto', label: 'Automático (recomendado)', hint: 'Usa la configuración gráfica normal de Windows.' },
      { id: 'gl', label: 'OpenGL (experimental)', hint: 'Si Capri se vuelve invisible o transparente, volvé a Automático.' },
      { id: 'software', label: 'Sin GPU (lento)', hint: 'Dibuja por CPU; sirve como último recurso.' },
    ];
    const screenLabel = build('div', 'appmenu__row');
    screenLabel.dataset.setting = 'bubble';
    screenLabel.append(labelNode('Pantalla', 'screen'));
    body.append(screenLabel);
    const renderRow = build('div', 'appmenu__radio-group');
    renderRow.dataset.setting = 'bubble';
    for (const option of renderOptions) {
      const label = build('label', 'appmenu__radio');
      const input = build('input');
      input.type = 'radio';
      input.name = 'capri-render';
      input.checked = (cfg.render || 'auto') === option.id;
      input.addEventListener('change', () => this.pickRender(option.id, state));
      label.append(input, build('span', 'appmenu__label', option.label));
      // OpenGL's warning only shows while it is the chosen one
      const hint = option.id === 'gl' && !input.checked ? '' : option.hint;
      if (hint) label.append(build('span', 'appmenu__hint', hint));
      renderRow.append(label);
    }
    body.append(renderRow);
    if (this.confirmSoftware) {
      action('SIN GPU', {
        setting: 'bubble',
        value: 'CONFIRMAR',
        danger: true,
        onClick: () => {
          this.confirmSoftware = false;
          this.act('render', 'software');
        },
      });
    }
    section('ATAJOS', 'shortcuts');
    for (const s of state.shortcuts || []) {
      action(s.label, s.accel ? { hotkey: s.accel, sub: true, setting: 'shortcuts' } : { value: '—', sub: true, setting: 'shortcuts' });
    }
    action('Abrir config.json', {
      setting: 'shortcuts',
      value: 'EDITAR',
      sub: true,
      onClick: () => this.act('shortcuts-file'),
    });

    // ACERCA DE
    section('ACERCA DE', 'about');
    body.append(this.aboutPanel(state, { build }));

    // SALIR
    section('SALIR', 'exit');
    action('Salir', { onClick: () => this.act('quit') });

    plate.append(rail, body, keys);
    this.filterSettingsBody(body);
    this.el.replaceChildren(plate);
    this.restoreSettingsScroll(prevScroll);
    if (this.helpOpen) {
      const visible = !this.settingsMode || HELP_STEPS[this.helpOpen]?.section === this.settingsSection;
      const panel = visible ? this.helpPanel(this.helpOpen, build) : null;
      if (panel) {
        this.el.append(panel);
        requestAnimationFrame(() => this.placeSubmenu());
      } else {
        this.helpOpen = null;
      }
    }
    if (this.open && this.at && !this.settingsMode) this.place();
    this.useKeyboard(this.expanded === 'fixes' || this.settingsSection === 'model' || this.capturing);
  }

  restoreSettingsScroll(top) {
    if (!this.settingsMode) return;
    const scroller = this.el.querySelector('.appmenu__body');
    if (!scroller) return;
    scroller.scrollTop = top;
    requestAnimationFrame(() => {
      scroller.scrollTop = top;
      if (this.helpOpen) this.placeSubmenu();
    });
  }

  filterSettingsBody(body) {
    if (!this.settingsMode) return;
    const groups = {
      model: ['model'], agents: ['agents'], memory: ['memory'], hearing: ['hearing'], apps: ['apps', 'apps-add', 'apps-found', 'apps-test'],
      bubble: ['bubble'], music: ['music'], shortcuts: ['shortcuts'], behavior: ['behavior'], about: ['about'],
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
      value: 'PROGRAMA / ACCESO DIRECTO',
      onClick: async () => {
        const res = await this.host.menuAction({ id: 'apps-pick-program' }).catch(() => ({ ok: false, message: 'No se pudo.' }));
        this.appNote = res?.ok ? `AÑADIDA: ${res.name}` : res?.message || '';
        await this.refresh();
      },
    });
    action('Añadir enlace', {
      value: 'LINK',
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

  // Wake word sensitivity: a % of how sure she must be it was the active phrase. Saved on release,
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
    const phrase = hearing.wakePhrase || 'hey Capri';
    wrap.append(row, range, build('div', 'appmenu__hint', `Más alto: menos falsas alarmas, pero hay que decir «${phrase}» más claro.`));
    return wrap;
  }

  // Push to talk: the combo, and a way to change it (the next combo you press; Esc cancels).
  talkKeyRow(hearing, build, kbd) {
    const wrap = build('div', 'appmenu__talkkey');
    const row = build('button', 'appmenu__row appmenu__row--action');
    row.type = 'button';
    const talkLabel = build('span', 'appmenu__label appmenu__label--help');
    talkLabel.append(build('span', '', 'Tecla para hablar'), this.helpButton('talk'));
    row.append(talkLabel);
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

  // Cerebro: three cards always visible — free key, on this PC, own key.
  brainPanel(model, { build }) {
    const wrap = build('div', 'appmenu__brain');
    wrap.dataset.setting = 'model';
    const providers = model.providers || [];
    const labelOf = (id) => providers.find((p) => p.id === id)?.label || id;
    const groups = model.groups || {};
    const freeLinks = model.freeLinks || {};
    const hasKeys = model.hasKeys || {};
    const active = model.provider || 'local';
    const activeIds = new Set(model.brains || [active]);
    const chain = (model.brainChain || [...activeIds].map((id) => ({ id, label: labelOf(id) })));
    wrap.append(build(
      'div',
      'appmenu__hint appmenu__brain-chain',
      chain.map((item, index) => `${index + 1}. ${item.label}`).join(' → '),
    ));

    const card = (title, blurb) => {
      const el = build('div', 'appmenu__brain-card');
      el.append(build('div', 'appmenu__brain-card-title', title));
      if (blurb) el.append(build('div', 'appmenu__hint', blurb));
      return el;
    };

    const pickRow = (ids, onPick, { recommend } = {}) => {
      const row = build('div', 'appmenu__brain-picks');
      for (const id of ids) {
        const text = id === recommend ? `${labelOf(id)} · recomendado` : labelOf(id);
        const btn = build('button', `appmenu__toggle-btn${activeIds.has(id) ? ' is-active' : ''}`, text);
        btn.type = 'button';
        if (activeIds.has(id)) btn.dataset.state = 'on';
        // Avoid focus scrolling the panel to the top on re-render.
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onPick(id);
        });
        row.append(btn);
      }

      return row;
    };

    const providerCardsPanel = (model, { build }) => {
        const wrap = build('div', 'appmenu__brain');
        const providers = model.providers || [];
        const labelOf = (id) => providers.find((p) => p.id === id)?.label || id;
        const cardGroups = [
          ['Gratis', ['local', 'openrouter']],
          ['Gratis con límite', ['gemini', 'groq']],
          ['De pago', ['openai', 'anthropic', 'deepseek', 'mistral', 'nvidia', 'xai']],
        ];
        const active = new Set(model.brains || []);
        const links = { ...(model.freeLinks || {}), ...(model.ownLinks || {}) };
        const models = model.models || {};
        const notes = this.probeNotes || {};
        const field = (label, value, placeholder, type = 'text') => {
          const input = build('input', 'appmenu__input');
          input.type = type;
          input.value = value || '';
          input.placeholder = placeholder;
          input.spellcheck = false;
          input.autocomplete = 'off';
          input.addEventListener('keydown', (e) => e.stopPropagation());
          for (const ev of ['mousedown', 'click']) input.addEventListener(ev, (e) => e.stopPropagation());
          const row = build('label', 'appmenu__fix-field');
          row.append(build('span', 'appmenu__fix-label', label), input);
          return { input, row };
        };
        const move = (id, direction) => this.host.menuAction({ id: 'model-reorder', value: { id, direction } }).then(() => this.refresh());
        const priority = build('div', 'appmenu__brain-card');
        priority.append(build('div', 'appmenu__brain-card-title', 'Prioridad'));
        priority.append(build('div', 'appmenu__hint', 'Orden en que Capri prueba los cerebros'));
        for (const [index, id] of (model.brainChain || []).entries()) {
          const row = build('div', 'appmenu__row appmenu__row--sub');
          row.append(build('span', 'appmenu__label', `${index + 1}. ${id.label}`));
          const arrowActions = build('div', 'appmenu__priority-actions');
          for (const [direction, glyph, disabled] of [['up', '↑', index === 0], ['down', '↓', index === model.brainChain.length - 1]]) {
            const btn = build('button', 'appmenu__arrow', glyph);
            btn.type = 'button';
            btn.disabled = disabled;
            btn.addEventListener('click', (e) => { e.stopPropagation(); move(id.id, direction); });
            arrowActions.append(btn);
          }
          row.append(arrowActions);
          priority.append(row);
        }
        wrap.append(priority);
        for (const [group, ids] of cardGroups) {
          wrap.append(build('div', 'appmenu__brain-group', group));
          for (const id of ids) {
          const p = providers.find((item) => item.id === id) || { label: id };
          const card = build('div', 'appmenu__brain-card');
          const needsKey = !model.localIds?.includes(id) && !['local'].includes(id);
          const hasKey = Boolean(model.hasKeys?.[id]);
          const header = build('div', 'appmenu__brain-card-header');
          header.append(build('div', 'appmenu__brain-card-title', p.label));
          const toggle = build('button', `appmenu__toggle-btn${active.has(id) ? ' is-active' : ''}`,
            active.has(id) ? 'Activo' : 'Apagado');
          toggle.type = 'button';
          toggle.dataset.state = active.has(id) ? 'on' : 'off';
          toggle.disabled = needsKey && !hasKey;
          if (toggle.disabled) toggle.title = 'Pegá una key primero';
          toggle.setAttribute('aria-pressed', String(active.has(id)));
          toggle.addEventListener('click', (e) => { e.stopPropagation(); this.act('model-provider', id); });
          header.append(toggle);
          card.append(header);
          const key = needsKey
            ? field('Key', '', model.hasKeys?.[id] ? 'key guardada: pega otra para cambiarla' : 'Pega tu key', 'password')
            : null;
          const modelField = field('Modelo', models[id], p.model || 'nombre exacto del modelo');
          const url = id === 'local' ? field('URL', model.baseUrls?.[id] || model.baseUrl, 'http://localhost:1235/v1') : null;
          const link = links[id];
          if (link?.url) {
            const get = build('button', 'appmenu__toggle-btn', `Conseguir key · ${link.label}`);
            get.type = 'button';
            get.addEventListener('click', (e) => { e.stopPropagation(); this.host.menuAction({ id: 'open-url', value: link.url }); });
            card.append(get);
          }
          if (key) card.append(key.row);
          card.append(modelField.row);
          if (url) card.append(url.row);
          const actions = build('div', 'appmenu__fix-actions appmenu__card-actions');
          const probe = build('button', 'appmenu__toggle-btn appmenu__fix-save is-active', 'Probar');
          probe.type = 'button';
          probe.addEventListener('click', async (e) => {
            e.stopPropagation();
            probe.disabled = true;
            const result = await this.host.menuAction({
              id: 'model-probe',
              value: {
                provider: id,
                key: key?.input.value,
                model: modelField.input.value.trim(),
                baseUrl: url?.input.value.trim(),
              },
            }).catch(() => ({ ok: false, message: 'No se pudo probar.' }));
            this.probeNotes = { ...(this.probeNotes || {}), [id]: result?.message || 'Falló.' };
            await this.refresh();
          });
          actions.append(probe);
          if (hasKey) {
            const remove = build('button', 'appmenu__toggle-btn appmenu__danger', 'Quitar key');
            remove.type = 'button';
            remove.addEventListener('click', async (e) => {
              e.stopPropagation();
              await this.host.menuAction({ id: 'model-key', value: { provider: id, key: '' } });
              await this.refresh();
            });
            actions.append(remove);
          }
          if (notes[id]) {
            const message = notes[id].startsWith('Listo') ? `Listo, ${labelOf(id)} contesta.` : notes[id];
            actions.append(build('span', `appmenu__hint appmenu__brain-status${notes[id].startsWith('Listo') ? ' is-ok' : ' is-bad'}`, message));
          }
          card.append(actions);
          wrap.append(card);
          }
        }
        const agents = build('div', 'appmenu__brain-card');
        agents.append(build('div', 'appmenu__brain-card-title', 'Agentes instalados'));
        agents.append(build('div', 'appmenu__hint', 'Se instalan desde cualquier ventana de PowerShell.'));
        for (const item of model.agentsInstalled || []) {
          const brainId = `agent-${item.id === 'cursor-agent' ? 'cursor' : item.id}`;
          const row = build('div', 'appmenu__agent-row');
          row.append(build('span', 'appmenu__agent-name', item.label));
          const toggle = build('button', `appmenu__toggle-btn${active.has(brainId) ? ' is-active' : ''}`,
            item.installed ? (active.has(brainId) ? 'Activo' : 'Apagado') : 'No instalado');
          toggle.type = 'button';
          toggle.dataset.state = item.installed && active.has(brainId) ? 'on' : 'off';
          toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!item.installed) {
              this.probeNotes = { ...(this.probeNotes || {}), [brainId]: 'No encontrado, copiá el comando de al lado.' };
              this.refresh();
              return;
            }
            this.agentNote = `${item.label} ${active.has(brainId) ? 'desactivado' : 'activado'}`;
            this.act('model-provider', brainId);
          });
          row.append(toggle);
          if (!item.installed) {
            const command = build('input', 'appmenu__input');
            command.value = item.installHow || '';
            command.readOnly = true;
            command.title = 'Seleccioná y copiá el comando';
            row.append(command);
          }
          const hint = item.installed
            ? 'Instalado · clic para activar/apagar'
            : `No instalado · copiá el comando${item.id === 'cursor-agent' ? ' · El editor Cursor solo no alcanza.' : ''}`;
          row.append(build('span', 'appmenu__hint appmenu__agent-hint',
            this.agentNote?.startsWith(item.label)
              ? this.agentNote
              : hint));
          agents.append(row);
        }
        wrap.append(agents);
        return wrap;
      };

    return providerCardsPanel(model, { build });

    const textField = (label, value, placeholder, type = 'text') => {
      const field = build('label', 'appmenu__fix-field');
      const input = build('input', 'appmenu__input');
      input.type = type;
      input.value = value || '';
      input.placeholder = placeholder;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.addEventListener('keydown', (e) => e.stopPropagation());
      for (const ev of ['mousedown', 'click']) input.addEventListener(ev, (e) => e.stopPropagation());
      field.append(build('span', 'appmenu__fix-label', label), input);
      return { field, input };
    };

    const probeBtn = (getPayload) => {
      const btn = build('button', 'appmenu__toggle-btn appmenu__fix-save is-active', 'PROBAR');
      btn.type = 'button';
      btn.dataset.state = 'on';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const payload = getPayload(); // before any re-render wipes the key field
        btn.disabled = true;
        btn.textContent = 'PROBANDO…';
        const res = await this.host.menuAction({ id: 'model-probe', value: payload })
          .catch(() => ({ ok: false, message: 'No se pudo probar.' }));
        this.probeNote = res?.message || (res?.ok ? 'Listo.' : 'Falló.');
        this.probeOk = Boolean(res?.ok);
        await this.refresh();
      });
      return btn;
    };

    // Only providers with a saved key get one, so nothing here ever shows what the key is.
    const removeRow = (ids) => {
      const row = build('div', 'appmenu__brain-free-links');
      for (const id of ids.filter((pid) => hasKeys[pid])) {
        const btn = build('button', 'appmenu__toggle-btn', `Quitar key · ${labelOf(id)}`);
        btn.type = 'button';
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const res = await this.host.menuAction({ id: 'model-key', value: { provider: id, key: '' } })
            .catch(() => ({ ok: false, message: 'No se pudo quitar.' }));
          this.probeNote = res?.message || 'Clave borrada.';
          this.probeOk = Boolean(res?.ok);
          await this.refresh();
        });
        row.append(btn);
      }
      return row;
    };

    // —— Gratis con key ——
    const freeIds = groups.free || ['gemini', 'nvidia'];
    const freeCard = card('Gratis con key', 'Sin cobro por token (límites del sitio). Abre el enlace, copia la key y pruébala.');
    const freeLinksRow = build('div', 'appmenu__brain-free-links');
    for (const id of freeIds) {
      const link = freeLinks[id];
      if (!link?.url) continue;
      const keyLabel = link.recommended
        ? `Key gratis · ${link.label} ★`
        : `Key gratis · ${link.label}`;
      const btn = build('button', 'appmenu__toggle-btn', keyLabel);
      btn.type = 'button';
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.host.menuAction({ id: 'open-url', value: link.url }).catch(() => {});
      });
      freeLinksRow.append(btn);
    }
    freeCard.append(
      freeLinksRow,
      build(
        'div',
        'appmenu__hint',
        'NVIDIA: logueate, elegí un modelo y tocá Get API Key (empieza con nvapi-). NVIDIA pide verificar tu teléfono.',
      ),
    );
    freeCard.append(pickRow(freeIds, (id) => this.act('model-provider', id), { recommend: 'gemini' }));
    const freeId = freeIds.includes(active) ? active : freeIds[0];
    const freeKey = textField(
      'Key',
      '',
      hasKeys[freeId] ? 'key guardada: pega otra para cambiarla' : 'pega la key aquí',
      'password',
    );
    const freeModel = textField('Modelo', freeIds.includes(active) ? model.model : '', 'nombre del modelo');
    freeCard.append(
      freeKey.field,
      freeModel.field,
      removeRow(freeIds),
      probeBtn(() => ({
        provider: freeIds.includes(active) ? active : freeId,
        key: freeKey.input.value,
        model: freeModel.input.value.trim(),
      })),
      build('div', 'appmenu__hint', 'La key se guarda cifrada en tu PC, fuera de git y de los logs.'),
    );
    wrap.append(freeCard);

    // —— En mi PC ——
    const localIds = groups.local || ['local', 'ollama'];
    const localCard = card('En mi PC', '8 GB de RAM, 3–5 GB de disco, GPU opcional. Ollama o LM Studio en local.');
    localCard.append(pickRow(localIds, (id) => this.act('model-provider', id)));
    const localId = localIds.includes(active) ? active : 'local';
    const urlDefault = localIds.includes(active)
      ? (model.baseUrl || '')
      : (localId === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:1235/v1');
    const localUrl = textField('URL', urlDefault, 'http://localhost:…/v1');
    const localModel = textField('Modelo', localIds.includes(active) ? model.model : '', 'nombre del modelo local');
    localCard.append(
      localUrl.field,
      localModel.field,
      probeBtn(() => ({
        provider: localIds.includes(active) ? active : localId,
        baseUrl: localUrl.input.value.trim(),
        model: localModel.input.value.trim(),
      })),
    );
    wrap.append(localCard);

    // —— Mi propia key ——
    const ownIds = groups.own || ['openai', 'anthropic', 'xai', 'deepseek', 'gemini', 'openrouter', 'groq', 'mistral'];
    const ownLinks = model.ownLinks || {};
    const ownCard = card('Mi propia key', 'La que ya pagas: OpenAI, Anthropic, Grok/xAI, DeepSeek, Gemini, OpenRouter, Groq o Mistral.');
    const ownLinksRow = build('div', 'appmenu__brain-free-links');
    for (const id of ['anthropic', 'xai', 'openai']) {
      const link = ownLinks[id];
      if (!link?.url) continue;
      const btn = build('button', 'appmenu__toggle-btn', `Key · ${link.label}`);
      btn.type = 'button';
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.host.menuAction({ id: 'open-url', value: link.url }).catch(() => {});
      });
      ownLinksRow.append(btn);
    }
    ownCard.append(
      ownLinksRow,
      build('div', 'appmenu__hint', 'Anthropic: console.anthropic.com → API keys. Grok: console.x.ai → Create API key. Pegá la key abajo y probá.'),
    );
    ownCard.append(pickRow(ownIds, (id) => this.act('model-provider', id)));
    const ownId = ownIds.includes(active) && !freeIds.includes(active) && !String(active).startsWith('agent-') ? active : ownIds[0];
    const ownKey = textField(
      'Key',
      '',
      hasKeys[ownIds.includes(active) ? active : ownId] ? 'key guardada: pega otra para cambiarla' : 'pega tu key',
      'password',
    );
    const ownModel = textField('Modelo', ownIds.includes(active) && !localIds.includes(active) ? model.model : '', 'nombre exacto del modelo');
    ownCard.append(
      ownKey.field,
      ownModel.field,
      removeRow(ownIds.filter((id) => !freeIds.includes(id))),
      probeBtn(() => ({
        provider: ownIds.includes(active) ? active : ownId,
        key: ownKey.input.value,
        model: ownModel.input.value.trim(),
      })),
      build('div', 'appmenu__hint', 'Nada de keys de Claude Code, Codex ni Cursor: van contra sus términos. Usá la tarjeta de agente instalado.'),
    );
    wrap.append(ownCard);

    // —— Usar mi agente instalado ——
    const agentIds = groups.agent || [
      'agent-auto', 'agent-claude', 'agent-cursor', 'agent-opencode', 'agent-codex', 'agent-gemini',
    ];
    const installed = model.agentsInstalled || [];
    const agentCard = card(
      'Usar mi agente instalado',
      'Corre el CLI de tu cuenta (claude / cursor-agent / opencode / codex / gemini). Capri no guarda esas keys.',
    );
    agentCard.append(build(
      'div',
      'appmenu__hint',
      'Se instalan desde cualquier ventana de PowerShell (no hace falta estar en la carpeta de Capri).',
    ));
    if (!installed.length) {
      agentCard.append(build('div', 'appmenu__hint', 'Ningún CLI en el PATH.'));
    }
    for (const id of agentIds.filter((item) => item !== 'agent-auto')) {
      const a = installed.find((item) => item.id === (id === 'agent-cursor' ? 'cursor-agent' : id.replace(/^agent-/, '')));
      const label = labelOf(id);
      const row = build('div', 'appmenu__agent-row');
      const button = build('button', `appmenu__toggle-btn${activeIds.has(id) ? ' is-active' : ''}`,
        `${label} · ${a?.ready ? 'instalado' : 'no instalado'}`);
      button.type = 'button';
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.act('model-provider', id);
      });
      const command = build('input', 'appmenu__input');
      command.type = 'text';
      command.value = a?.installHow || '';
      command.readOnly = true;
      command.title = 'Seleccioná y copiá el comando';
      row.append(button, command);
      agentCard.append(row);
    }
    agentCard.append(pickRow(['agent-auto'], (id) => this.act('model-provider', id)));
    agentCard.append(probeBtn(() => ({
      provider: agentIds.includes(active) ? active : 'agent-auto',
    })));
    wrap.append(agentCard);

    if (this.probeNote) {
      const status = build(
        'div',
        `appmenu__hint appmenu__brain-status${this.probeOk ? ' is-ok' : ' is-bad'}`,
        this.probeNote,
      );
      wrap.append(status);
    }

    // —— Requisitos ——
    const table = build('div', 'appmenu__brain-table');
    table.append(build('div', 'appmenu__brain-card-title', 'En mi PC vs con key'));
    const grid = build('div', 'appmenu__brain-table-grid');
    const cell = (t, strong = false) => {
      const c = build('div', strong ? 'appmenu__brain-table-h' : 'appmenu__brain-table-c', t);
      return c;
    };
    grid.append(
      cell('', true), cell('En mi PC', true), cell('Con key', true),
      cell('Internet'), cell('No hace falta'), cell('Sí'),
      cell('RAM / disco'), cell('~8 GB RAM, 3–5 GB'), cell('Casi nada extra'),
      cell('Privacidad'), cell('Todo se queda aquí'), cell('El chat sale a ese servicio'),
      cell('Costo'), cell('Gratis (tu luz)'), cell('Gratis con cupo, o lo que cobren'),
    );
    table.append(grid);
    wrap.append(table);
    return wrap;
  }

  aboutPanel(state, { build }) {
    const wrap = build('div', 'appmenu__brain');
    wrap.dataset.setting = 'about';
    const about = state.about || { name: 'Capri', version: '?', author: 'MtGhozt', community: [], dev: [], donate: [], other: [] };
    const updates = state.updates || { enabled: true };

    const head = build('div', 'appmenu__brain-card');
    const icon = document.createElement('img');
    icon.src = about.icon || '../../assets/icons/capri.png';
    icon.alt = 'Capri';
    icon.width = 64;
    icon.height = 64;
    icon.style.imageRendering = 'auto';
    head.append(icon);
    head.append(build('div', 'appmenu__brain-card-title', `${about.name} v${about.version}`));
    head.append(build('div', 'appmenu__hint', `Autor: ${about.author}`));
    wrap.append(head);

    const linkBtn = (item) => {
      const btn = build('button', 'appmenu__toggle-btn', item.label);
      btn.type = 'button';
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.url) {
          await this.host.menuAction({ id: 'open-url', value: item.url }).catch(() => {});
          return;
        }
        if (item.action === 'check-updates') {
          const res = await this.host.menuAction({ id: 'check-updates' }).catch(() => null);
          if (res?.message) this.probeNote = res.message;
          await this.refresh();
          return;
        }
        if (item.action === 'share-logs') {
          const res = await this.host.menuAction({ id: 'share-logs' }).catch(() => null);
          if (res?.message) this.probeNote = res.message;
          await this.refresh();
        }
      });
      return btn;
    };

    const block = (title, items) => {
      if (!items?.length) return;
      const card = build('div', 'appmenu__brain-card');
      card.append(build('div', 'appmenu__brain-card-title', title));
      const row = build('div', 'appmenu__brain-free-links');
      for (const item of items) row.append(linkBtn(item));
      card.append(row);
      wrap.append(card);
    };

    block('Comunidad', about.community);
    block('Desarrollo', about.dev);
    block('Donar', about.donate);
    block('Otros', about.other);

    const upd = build('div', 'appmenu__brain-card');
    upd.append(build('div', 'appmenu__brain-card-title', 'Actualizaciones'));
    const toggle = build('button', `appmenu__toggle-btn${updates.enabled !== false ? ' is-active' : ''}`,
      updates.enabled !== false ? 'Buscar al abrir: SÍ' : 'Buscar al abrir: NO');
    toggle.type = 'button';
    if (updates.enabled !== false) toggle.dataset.state = 'on';
    toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.host.menuAction({ id: 'updates-enabled', value: updates.enabled === false });
      await this.refresh();
    });
    upd.append(toggle);
    upd.append(build('div', 'appmenu__hint', 'Como máximo una vez cada 24 h. Si hay release nuevo, te pregunta; Sí abre la página (no instala sola).'));
    wrap.append(upd);

    if (this.probeNote) {
      wrap.append(build('div', 'appmenu__hint appmenu__brain-status', this.probeNote));
    }
    return wrap;
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
    const state = await this.host.getMenu({ folded: this.folded(), light: !this.settingsMode });
    if (!this.open) return; // closed while it was asked: don't take the keyboard for a hidden menu
    this.render(state);
  }

  toggle(name, state) {
    this.confirmForget = false;
    this.confirmSoftware = false;
    this.fixNote = '';
    this.expanded = this.expanded === name ? null : name;
    this.render(state);
  }

  // Apariencia › Pantalla: SIN GPU asks once (CONFIRMAR) before the relaunch.
  pickRender(id, state) {
    const current = state?.cfg?.render || 'auto';
    if (id === 'software' && id !== current && !this.confirmSoftware) {
      this.confirmSoftware = true;
      if (this.lastState) this.render(this.lastState);
      return;
    }
    this.confirmSoftware = false;
    this.act('render', id);
  }

  async act(id, value) {
    if (id === 'forget' && !this.confirmForget) {
      this.confirmForget = true;
      const state = await this.host.getMenu({ folded: this.folded() });
      this.render(state);
      return;
    }
    this.confirmForget = false;
    if (id !== 'render') this.confirmSoftware = false;
    const keep = this.settingsMode || id === 'mic' || id === 'mic-device' || id === 'reply-mode' || id === 'music-player'
      || id === 'model-provider' || id === 'spotify-connect' || id === 'spotify-disconnect' || id === 'drag-lock' || id === 'theme'
      || id === 'startup' || id === 'gaming-mode' || id === 'drone-mode' || id === 'comments' || id === 'comments-range'
      || id === 'greetings' || id === 'unlock-greeting' || id === 'caresses' || id === 'music-dance'
      || id === 'app-fx' || id === 'scanlines' || id === 'game-list';
    const result = await this.host.menuAction({ id, value });
    if (id === 'game-list' && result?.message) this.gameNote = result.message;
    if (!keep) {
      this.hide();
      return;
    }
    if (this.open) {
      const state = await this.host.getMenu({ folded: this.folded(), light: !this.settingsMode });
      this.render(state);
    }
  }
}
