// Overlay context menu, laid out like the Cyberpunk 2077 settings plate: coral labels,
// toggles as OFF|ON blocks, selectors as ◀ value ▶, and microtext on the rails.

import { clamp } from './util.js';

const REPLY_OPTIONS = [
  { id: 'voice', label: 'VOZ' },
  { id: 'blips', label: 'BLIPS' },
  { id: 'silent', label: 'SILENCIO' },
];

const CLOSE_OPTIONS = [
  { id: 'graceful', label: 'CON CUIDADO' },
  { id: 'ask', label: 'PREGUNTAR' },
  { id: 'force', label: 'FORZAR' },
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
      this.expanded = expand === 'apps' ? null : expand;
      this.view = expand === 'apps' ? 'apps' : 'main';
      this.resetApps();
      this.confirmForget = false;
      this.fixNote = '';
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
    this.capturing = false;
    this.talkNote = '';
    this.view = 'main';
    this.resetApps();
    this.useKeyboard(false);
    this.onOpenChange?.(false);
  }

  // The overlay never takes the keyboard by itself: ask for it while the fix fields are open.
  useKeyboard(on) {
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

    const selector = (label, { options, current, onChange }, into = body) => {
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
      into.append(row);
    };

    if (this.view === 'apps') {
      this.appsView(state, { body, build, kbd, section, action, selector });
      plate.append(rail, body, keys);
      this.el.replaceChildren(plate);
      if (this.open && this.at) this.place();
      this.useKeyboard(true); // its text fields
      return;
    }

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

    // OÍDO: what she hears wrong (Paso 4A)
    section('OÍDO');
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
    section('APPS');
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
    this.useKeyboard(this.expanded === 'fixes' || this.capturing);
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

    section('APPS');
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

    section('AÑADIR');
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

    section('PROBAR COMANDO');
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
        this.hide();
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
    if (app.processes.length) {
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
      panel.append(build('div', 'appmenu__hint', `proceso: ${app.processes.join(', ')}`));
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
          this.hide();
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
