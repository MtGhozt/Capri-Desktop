// Overlay context menu, laid out like the Cyberpunk 2077 settings plate: coral labels,
// toggles as OFF|ON blocks, selectors as ◀ value ▶, and microtext on the rails.

import { clamp, voiceRefMissing } from './util.js';
import { HELP_STEPS, toggleHelp, splitHelpText } from './help-steps.js';
import {
  REPLY_OPTIONS,
  THEME_OPTIONS,
  build as widgetBuild,
  createRowHelpers,
  textInput as widgetTextInput,
} from './menu/widgets.js';
import { render as renderAbout } from './menu/about.js';
import { render as renderMusica } from './menu/musica.js';
import { render as renderApariencia, pickRender as pickRenderBubble } from './menu/apariencia.js';
import { render as renderAtajos, saveShortcut as saveShortcutKeys } from './menu/atajos.js';
import { render as renderMemoria } from './menu/memoria.js';
import { render as renderAgentes } from './menu/agentes.js';
import { render as renderRecordatorios } from './menu/recordatorios.js';
import { render as renderComportamiento, renderTail as renderComportamientoTail } from './menu/comportamiento.js';
import { renderAppsEntry, renderView as renderAppsView } from './menu/apps.js';
import { render as renderCerebro, saveShare as saveShareModel } from './menu/cerebro.js';
import { render as renderVoz } from './menu/voz.js';


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

export const QUICK_MENU_ITEMS = [
  { id: 'mic' }, { id: 'mic-device' }, { id: 'reply-mode' }, { id: 'model-provider' },
  { id: 'fixes' }, { id: 'clip-save' }, { id: 'do-something' }, { id: 'behavior' }, { id: 'theme' }, { id: 'settings' }, { id: 'quit' },
];

export const SETTINGS_TABS = [
  { id: 'model', label: 'Cerebro' }, { id: 'agents', label: 'Agentes' },
  { id: 'memory', label: 'Memoria y personalidad' },
  { id: 'hearing', label: 'Oído y voz' }, { id: 'apps', label: 'Mis apps' },
  { id: 'bubble', label: 'Apariencia' }, { id: 'music', label: 'Música / Reproductor' },
  { id: 'shortcuts', label: 'Atajos' }, { id: 'behavior', label: 'Comportamiento' },
  { id: 'reminders', label: 'Recordatorios' },
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
    this.capturingId = null; // Atajos / OÍDO: waiting for the new combo ('toggle' | 'chat' | 'talk')
    this.talkNote = '';     // what came of the last talk combo (taken, saved...)
    this.shortcutNote = ''; // what came of any shortcut change
    this.lastState = null;
    this.view = 'main';     // 'apps': her app table instead of the menu (Paso 4C)
    this.appOpen = null;    // the app being edited
    this.appNote = '';      // what came of the last add / save / delete
    this.gameNote = '';
    this.gamePlayNote = ''; // first-time anti-cheat warning for En juegos › Comentar
    this.reminderNote = '';
    this.placeNote = '';    // resolved city label or "No encontré esa ciudad"
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
    this.diag = null;      // Ajustes › Diagnóstico: { lines, text }
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
    if (typeof this.host.onSettingsRefresh === 'function') {
      this.host.onSettingsRefresh(async () => {
        if (!this.open || !this.settingsMode) return;
        try {
          const state = await this.host.getMenu({ folded: this.folded(), light: false });
          this.render(state);
        } catch { /* settings closed mid-refresh */ }
      });
    }

    this.el.addEventListener('click', (e) => e.stopPropagation());
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    // the new push-to-talk combo: this keydown is the combo, not a menu key
    window.addEventListener('keydown', (e) => {
      if (!this.open || !this.capturingId) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        this.capturingId = null;
        this.talkNote = '';
        this.shortcutNote = '';
        this.rerender();
        return;
      }
      if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return; // still holding
      this.saveShortcut(this.capturingId, {
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
      capturing: this.capturingId,
      helpOpen: this.helpOpen,
      quickOpen: this.quickOpen,
      expanded: this.expanded,
      view: this.view,
      settingsMode: this.settingsMode,
    });
    if (step === 'cancel-capture') {
      this.capturingId = null;
      this.talkNote = '';
      this.shortcutNote = '';
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
    if (this.voiceRefForm && this.pendingRefWav) {
      this.voiceNote = 'No se guardó la voz.';
      this.voiceRefForm = false;
      this.pendingRefWav = '';
      this.pendingRefText = '';
      this.pendingRefTranscriptPath = '';
    }
    this.open = false;
    this.opening = false;
    this.expanded = null;
    this.quickOpen = null;
    this.helpOpen = null;
    this.confirmForget = false;
    this.confirmSoftware = false;
    this.el.hidden = true;
    this.capturingId = null;
    this.talkNote = '';
    this.shortcutNote = '';
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
    const chain = model.brainChain || [];
    const activeLabel = chain[0]?.label
      || model.providers?.find((o) => o.id === model.provider)?.label
      || model.provider;
    row('Proveedor', activeLabel, 'model-provider',
      (anchor) => openSubmenu(
        'model-provider',
        [
          ...chain.map((brain, index) => ({
            id: brain.id,
            label: `${index + 1}. ${brain.label}${index === 0 ? ' · activo' : ''}`,
            reorder: true,
          })),
          { id: '__more__', label: 'Más proveedores…' },
        ],
        model.provider,
        'model-provider',
        anchor,
      ));
    row('Corregir lo último', hearing.fixes?.length ? `${hearing.fixes.length} CORRECCIONES` : 'OÍDO', 'fixes',
      () => { this.hide(); this.host.openSettings('hearing'); });
    const clipNvidia = state.clips?.nvidia !== false;
    row(
      'Guardar clip',
      clipNvidia ? (state.clips?.hotkey || 'ALT+F10') : 'Win+Alt+G · Game Bar',
      'clip-save',
      () => this.act('clip-save'),
    );
    row('Hacer algo', '', 'do-something', () => this.act('do-something'));
    row('Comportamiento', cfg.locked ? 'FIJO' : 'NORMAL', 'behavior',
      (anchor) => openSubmenu('behavior', [{ id: 'normal', label: 'NORMAL' }, { id: 'locked', label: 'FIJO' }], cfg.locked ? 'locked' : 'normal', 'drag-lock', anchor));
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
      const title = build('div', 'appmenu__submenu-title', this.quickOptions.id === 'game-list' ? 'NO MOLESTAR'
        : this.quickOptions.id === 'model-provider' ? 'PRIORIDAD' : this.quickOptions.id.toUpperCase());
      if (this.quickOptions.id === 'game-list') title.append(this.helpButton('gaming'));
      menu.append(title);
      const providerPriority = this.quickOptions.id === 'model-provider';
      for (const [index, option] of this.quickOptions.options.entries()) {
        if (providerPriority && option.id === '__more__') {
          const more = build('button', 'appmenu__submenu-row', option.label);
          more.type = 'button';
          more.addEventListener('click', () => {
            this.quickOpen = null;
            this.hide();
            this.host.openSettings('model');
          });
          menu.append(more);
          continue;
        }
        if (providerPriority && option.reorder) {
          const row = build('div', 'appmenu__submenu-row appmenu__submenu-priority');
          row.classList.toggle('is-selected', String(option.id) === String(this.quickOptions.current));
          row.append(build('span', '', option.label));
          const arrows = build('span', 'appmenu__priority-actions');
          const brains = (this.lastState?.model?.brainChain || []).filter((b) => b.id !== '__more__');
          for (const [direction, glyph, disabled] of [
            ['up', '↑', index === 0],
            ['down', '↓', index >= brains.length - 1],
          ]) {
            const btn = build('button', 'appmenu__arrow', glyph);
            btn.type = 'button';
            btn.disabled = disabled;
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              // Optimistic swap, then reconcile with getMenu after main finishes.
              const chain = [...brains];
              const from = chain.findIndex((b) => b.id === option.id);
              const to = direction === 'up' ? from - 1 : from + 1;
              if (from >= 0 && to >= 0 && to < chain.length) {
                [chain[from], chain[to]] = [chain[to], chain[from]];
                if (this.lastState?.model) this.lastState.model.brainChain = chain;
                this.quickOptions = {
                  ...this.quickOptions,
                  options: [
                    ...chain.map((brain, i) => ({
                      id: brain.id,
                      label: `${i + 1}. ${brain.label}${i === 0 ? ' · activo' : ''}`,
                      reorder: true,
                    })),
                    { id: '__more__', label: 'Más proveedores…' },
                  ],
                  current: chain[0]?.id || this.quickOptions.current,
                };
                this.renderQuick(this.lastState);
                requestAnimationFrame(() => this.placeSubmenu());
              }
              await this.host.menuAction({ id: 'model-reorder', value: { id: option.id, direction } });
              const next = await this.host.getMenu({ folded: this.folded(), light: true });
              this.lastState = next;
              const confirmed = next.model?.brainChain || [];
              this.quickOptions = {
                ...this.quickOptions,
                options: [
                  ...confirmed.map((brain, i) => ({
                    id: brain.id,
                    label: `${i + 1}. ${brain.label}${i === 0 ? ' · activo' : ''}`,
                    reorder: true,
                  })),
                  { id: '__more__', label: 'Más proveedores…' },
                ],
                current: next.model?.provider,
              };
              this.renderQuick(next);
              requestAnimationFrame(() => this.placeSubmenu());
            });
            arrows.append(btn);
          }
          row.append(arrows);
          menu.append(row);
          continue;
        }
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
            clearTimeout(copy.resetTimer);
            copy.resetTimer = setTimeout(() => { copy.textContent = 'COPIAR'; }, 1600);
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
    const build = widgetBuild;
    const body = build('div', 'appmenu__body');
    const { section, labelNode, action, toggle, selector, kbd } = createRowHelpers(this, body, build);
    const ctx = { body, build, section, labelNode, action, toggle, selector, kbd };
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

    if (this.view === 'apps') {
      renderAppsView(this, state, { body, build, kbd, section, action, selector });
      plate.append(rail, body, keys);
      this.filterSettingsBody(body);
      this.el.replaceChildren(plate);
      this.restoreSettingsScroll(prevScroll);
      if (this.open && this.at && !this.settingsMode) this.place();
      this.useKeyboard(true); // its text fields
      return;
    }

    renderVoz(this, state, ctx);
    renderMusica(this, state, ctx);
    renderCerebro(this, state, ctx);
    renderAgentes(this, state, ctx);
    renderMemoria(this, state, ctx);
    renderAppsEntry(this, state, ctx);
    renderComportamiento(this, state, ctx);
    renderRecordatorios(this, state, ctx);
    renderComportamientoTail(this, state, ctx);
    renderApariencia(this, state, ctx);
    renderAtajos(this, state, ctx);
    renderAbout(this, state, { body, build, section, labelNode, action, toggle, selector, kbd });

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
    this.useKeyboard(this.expanded === 'fixes' || this.settingsSection === 'model' || Boolean(this.capturingId));
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
      bubble: ['bubble'], music: ['music'], shortcuts: ['shortcuts'], behavior: ['behavior'], reminders: ['reminders'],
      about: ['about'],
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

  // What her scan found on this PC that isn't in the table: filter, add one, scan again.

  // "5 MIN", "3 H", "2 DÍAS"

  // Mirrors reminders.formatDateTimeLocal / parseDateTimeLocal (renderer cannot require main).
  // Always 24h clock for the native datetime-local value; spoken/list labels use cfg.timeFormat.


  textInput(build, value, placeholder, max = 60) {
    return widgetTextInput(this, build, value, placeholder, max);
  }




  rerender() {
    if (this.open && this.lastState) this.render(this.lastState);
  }

  // Wake word sensitivity: a % of how sure she must be it was the active phrase. Saved on release,
  // and the sidecar takes it right away.

  // Push to talk: the combo, and a way to change it (the next combo you press; Esc cancels).

  // Ajustes › Atajos: one editable combo each, same capture flow as Tecla para hablar.

  // Cerebro: three cards always visible — free key, on this PC, own key.

  providerLabel(model, fallback) {
    return (model.providers || []).find((p) => p.id === model.provider)?.label || fallback;
  }

  async saveShare(patch) {
    return saveShareModel(this, patch);
  }

  async saveShortcut(id, keys) {
    return saveShortcutKeys(this, id, keys);
  }

  // Corregir lo último: what she heard last, two fields (what she heard, what you meant), and the
  // fixes she already has, each with a way to drop it.

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
    return pickRenderBubble(this, id, state);
  }

  // Patch lastState so toggles/selectors flip before menuAction + getMenu round-trip.
  optimisticAct(id, value) {
    if (!this.lastState?.cfg) return false;
    const cfg = this.lastState.cfg;
    switch (id) {
      case 'mic': cfg.mic = Boolean(value); return true;
      case 'mic-device': cfg.micDevice = value; return true;
      case 'reply-mode': cfg.replyMode = value; return true;
      case 'theme': cfg.theme = value; return true;
      case 'drag-lock': cfg.locked = value === 'locked' || value === true; return true;
      case 'startup': this.lastState.login = Boolean(value); return true;
      case 'desktop-shortcut': this.lastState.deskShortcut = Boolean(value); return true;
      case 'drone-mode': cfg.gaming = { ...(cfg.gaming || {}), drone: Boolean(value) }; return true;
      case 'gaming-play': {
        const next = value === 'comment' ? 'comment' : 'quiet';
        cfg.gaming = { ...(cfg.gaming || {}), mode: next, lastMode: next };
        return true;
      }
      case 'comments': cfg.comments = { ...(cfg.comments || {}), enabled: Boolean(value) }; return true;
      case 'greetings': cfg.behavior = { ...(cfg.behavior || {}), greetings: Boolean(value) }; return true;
      case 'unlock-greeting': cfg.behavior = { ...(cfg.behavior || {}), unlockGreeting: Boolean(value) }; return true;
      case 'caresses': cfg.behavior = { ...(cfg.behavior || {}), caresses: Boolean(value) }; return true;
      case 'music-dance': cfg.behavior = { ...(cfg.behavior || {}), musicDance: Boolean(value) }; return true;
      case 'app-fx': cfg.fx = { ...(cfg.fx || {}), apps: Boolean(value) }; return true;
      case 'scanlines': cfg.fx = { ...(cfg.fx || {}), scanlines: Boolean(value) }; return true;
      case 'time-zone': cfg.timeZone = value; return true;
      case 'time-format': cfg.timeFormat = value === '12h' ? '12h' : '24h'; return true;
      case 'weather-place': cfg.weatherPlace = value; return true;
      case 'music-player': cfg.music = { ...(cfg.music || {}), player: value }; return true;
      default: return false;
    }
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
      || id === 'startup' || id === 'gaming-mode' || id === 'gaming-play' || id === 'drone-mode' || id === 'comments' || id === 'comments-range'
      || id === 'desktop-shortcut'
      || id === 'greetings' || id === 'unlock-greeting' || id === 'caresses' || id === 'music-dance'
      || id === 'app-fx' || id === 'scanlines' || id === 'game-list'
      || id === 'time-zone' || id === 'time-format' || id === 'weather-place' || id === 'reminder-update' || id === 'reminder-delete';
    if (keep && this.open && this.optimisticAct(id, value)) {
      this.render(this.lastState);
    }
    const result = await this.host.menuAction({ id, value });
    if (id === 'game-list' && result?.message) this.gameNote = result.message;
    if (id === 'gaming-play' && result?.warning) this.gamePlayNote = result.warning;
    if ((id === 'reminder-update' || id === 'reminder-delete') && result?.message) {
      this.reminderNote = result.message;
    }
    if (id === 'weather-place') {
      if (result?.label) this.placeNote = result.label;
      else if (result?.notFound) this.placeNote = 'No encontré esa ciudad';
      else if (result?.offline) { /* keep quiet: no spam when offline */ }
      else if (!value) this.placeNote = '';
    }
    if (!keep) {
      this.hide();
      return result;
    }
    if (this.open) {
      const state = await this.host.getMenu({ folded: this.folded(), light: !this.settingsMode });
      this.render(state);
    }
    return result;
  }
}
