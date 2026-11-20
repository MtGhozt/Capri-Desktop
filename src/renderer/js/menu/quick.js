// Overlay quick menu (compact plate + one floating submenu).

import { REPLY_OPTIONS, THEME_OPTIONS } from './widgets.js';

export function renderQuick(app, state) {
  app.lastState = state;
  const { cfg, model = {}, hearing = {} } = state;
  app.setTheme(cfg.theme);
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
    app.quickOpen = app.quickOpen === id ? null : id;
    app.quickOptions = { id, options, current, action };
    app.quickAnchor = anchor;
    renderQuick(app, app.lastState);
    requestAnimationFrame(() => app.placeSubmenu());
  };
  row('Micrófono', cfg.mic ? 'ACTIVO' : 'MUTEADO', 'mic', () => app.act('mic', !cfg.mic));
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
    () => { app.hide(); app.host.openSettings('hearing'); });
  const clipNvidia = state.clips?.nvidia !== false;
  row(
    'Guardar clip',
    clipNvidia ? (state.clips?.hotkey || 'ALT+F10') : 'Win+Alt+G · Game Bar',
    'clip-save',
    () => app.act('clip-save'),
  );
  row('Hacer algo', '', 'do-something', () => app.act('do-something'));
  row('Comportamiento', cfg.locked ? 'FIJO' : 'NORMAL', 'behavior',
    (anchor) => openSubmenu('behavior', [{ id: 'normal', label: 'NORMAL' }, { id: 'locked', label: 'FIJO' }], cfg.locked ? 'locked' : 'normal', 'drag-lock', anchor));
  row('No molestar', cfg.gaming?.fgKey || 'SIN APP ACTIVA', 'game-list',
    (anchor) => openSubmenu('game-list', [
      { id: 'allow', label: 'SILENCIAR EN ESTA APP' },
      { id: 'ignore', label: 'NO SILENCIAR NUNCA' },
      { id: 'remove', label: 'SACAR DE LA LISTA' },
    ], null, 'game-list', anchor));
  if (app.gameNote) body.append(build('div', 'appmenu__hint', app.gameNote));
  row('Tema', cfg.theme === 'capri' ? 'CAPRI' : 'CYBERPUNK', 'theme',
    (anchor) => openSubmenu('theme', THEME_OPTIONS, cfg.theme, 'theme', anchor));
  const rule = build('div', 'appmenu__quick-rule');
  body.append(rule);
  row('Ajustes…', '', 'settings', () => { app.hide(); app.host.openSettings(); });
  row('Salir', '', 'quit', () => app.act('quit'));
  const foot = build('div', 'appmenu__rail appmenu__quick-foot');
  foot.append(build('span', 'appmenu__kbd', 'ESC'), build('span', 'appmenu__rail-text', 'CERRAR'), build('span', 'appmenu__rail-text', 'CAPRICORN'));
  plate.append(rail, body, foot);
  app.el.replaceChildren(plate);
  // One popout at a time: the help panel takes the submenu's place while it is open.
  if (app.quickOpen && !app.helpOpen) {
    const menu = build('div', 'appmenu__submenu');
    const title = build('div', 'appmenu__submenu-title', app.quickOptions.id === 'game-list' ? 'NO MOLESTAR'
      : app.quickOptions.id === 'model-provider' ? 'PRIORIDAD' : app.quickOptions.id.toUpperCase());
    if (app.quickOptions.id === 'game-list') title.append(app.helpButton('gaming'));
    menu.append(title);
    const providerPriority = app.quickOptions.id === 'model-provider';
    for (const [index, option] of app.quickOptions.options.entries()) {
      if (providerPriority && option.id === '__more__') {
        const more = build('button', 'appmenu__submenu-row', option.label);
        more.type = 'button';
        more.addEventListener('click', () => {
          app.quickOpen = null;
          app.hide();
          app.host.openSettings('model');
        });
        menu.append(more);
        continue;
      }
      if (providerPriority && option.reorder) {
        const row = build('div', 'appmenu__submenu-row appmenu__submenu-priority');
        row.classList.toggle('is-selected', String(option.id) === String(app.quickOptions.current));
        row.append(build('span', '', option.label));
        const arrows = build('span', 'appmenu__priority-actions');
        const brains = (app.lastState?.model?.brainChain || []).filter((b) => b.id !== '__more__');
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
              if (app.lastState?.model) app.lastState.model.brainChain = chain;
              app.quickOptions = {
                ...app.quickOptions,
                options: [
                  ...chain.map((brain, i) => ({
                    id: brain.id,
                    label: `${i + 1}. ${brain.label}${i === 0 ? ' · activo' : ''}`,
                    reorder: true,
                  })),
                  { id: '__more__', label: 'Más proveedores…' },
                ],
                current: chain[0]?.id || app.quickOptions.current,
              };
              renderQuick(app, app.lastState);
              requestAnimationFrame(() => app.placeSubmenu());
            }
            await app.host.menuAction({ id: 'model-reorder', value: { id: option.id, direction } });
            const next = await app.host.getMenu({ folded: app.folded(), light: true });
            app.lastState = next;
            const confirmed = next.model?.brainChain || [];
            app.quickOptions = {
              ...app.quickOptions,
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
            renderQuick(app, next);
            requestAnimationFrame(() => app.placeSubmenu());
          });
          arrows.append(btn);
        }
        row.append(arrows);
        menu.append(row);
        continue;
      }
      const button = build('button', 'appmenu__submenu-row', option.label);
      button.type = 'button';
      button.classList.toggle('is-selected', String(option.id) === String(app.quickOptions.current));
      button.addEventListener('click', () => {
        const value = app.quickOptions.action === 'drag-lock' ? option.id === 'locked' : option.id;
        app.quickOpen = null;
        app.act(app.quickOptions.action, value);
      });
      menu.append(button);
    }
    app.el.append(menu);
  }
  if (app.helpOpen) {
    const panel = app.helpPanel(app.helpOpen, build);
    if (panel) app.el.append(panel);
  }
  requestAnimationFrame(() => app.placeSubmenu());
  if (app.open && app.at && !app.settingsMode) app.place();
}

