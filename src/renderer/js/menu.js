// Overlay context menu, laid out like the Cyberpunk 2077 settings plate: coral labels,
// toggles as OFF|ON blocks, selectors as ◀ value ▶, and microtext on the rails.

import { clamp } from './util.js';
import { HELP_STEPS } from './help-steps.js';
import {
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
import { renderQuick as renderQuickMenu } from './menu/quick.js';
import {
  placeHelpPanel,
  placeSubmenu as placeSubmenuPanel,
  helpButton as makeHelpButton,
  helpPanel as makeHelpPanel,
} from './menu/help.js';
import { act as runAct, optimisticAct as runOptimisticAct } from './menu/actions.js';

export { placeHelpPanel };

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
    return renderQuickMenu(this, state);
  }

  placeSubmenu() {
    return placeSubmenuPanel(this);
  }

  helpButton(helpId) {
    return makeHelpButton(this, helpId);
  }

  helpPanel(helpId, build) {
    return makeHelpPanel(this, helpId, build);
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

  // program or a link, and "Probar comando" (what she would do, done nothing).




  textInput(build, value, placeholder, max = 60) {
    return widgetTextInput(this, build, value, placeholder, max);
  }




  rerender() {
    if (this.open && this.lastState) this.render(this.lastState);
  }





  providerLabel(model, fallback) {
    return (model.providers || []).find((p) => p.id === model.provider)?.label || fallback;
  }

  async saveShare(patch) {
    return saveShareModel(this, patch);
  }

  async saveShortcut(id, keys) {
    return saveShortcutKeys(this, id, keys);
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

  pickRender(id, state) {
    return pickRenderBubble(this, id, state);
  }

  optimisticAct(id, value) {
    return runOptimisticAct(this, id, value);
  }

  async act(id, value) {
    return runAct(this, id, value);
  }
}
