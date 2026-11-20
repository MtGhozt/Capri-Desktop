import { CLOSE_OPTIONS } from './widgets.js';
import { textInput } from './widgets.js';

export function renderView(menu, state, ctx) {
  const { body, build, section, action, selector } = ctx;
    const list = state.apps || [];
    action('◀ Volver al menú', {
      onClick: () => {
        menu.view = 'main';
        menu.resetApps();
        menu.render(state);
      },
    });

    section('APPS', 'apps');
    const items = build('div', 'appmenu__apps-list');
    if (!list.length) items.append(build('span', 'appmenu__meta', 'SIN APPS TODAVÍA'));
    for (const app of list) {
      const open = menu.appOpen === app.name;
      const row = build('button', 'appmenu__row appmenu__row--action appmenu__app');
      row.type = 'button';
      row.append(build('span', 'appmenu__label', app.name), build('span', 'appmenu__meta', app.typeLabel.toUpperCase()));
      const mark = build('span', 'appmenu__chevron', '›');
      if (open) mark.classList.add('is-open');
      row.append(mark);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.appOpen = open ? null : app.name;
        menu.appDelete = null;
        menu.appNote = '';
        menu.rerender();
      });
      items.append(row);
      items.append(build('div', 'appmenu__hint appmenu__app-aliases', app.aliases.length ? `alias: ${app.aliases.join(', ')}` : 'sin alias'));
      if (open) items.append(appEditor(menu, app, ctx));
    }
    body.append(items);

    section('AÑADIR', 'apps-add');
    action('Buscar programa…', {
      value: 'PROGRAMA / ACCESO DIRECTO',
      onClick: async () => {
        const res = await menu.host.menuAction({ id: 'apps-pick-program' }).catch(() => ({ ok: false, message: 'No se pudo.' }));
        menu.appNote = res?.ok ? `AÑADIDA: ${res.name}` : res?.message || '';
        await menu.refresh();
      },
    });
    action('Agregar carpeta o archivo', {
      value: 'CARPETA / ARCHIVO',
      onClick: async () => {
        const res = await menu.host.menuAction({ id: 'apps-pick-folder-file' }).catch(() => ({ ok: false, message: 'No se pudo.' }));
        menu.appNote = res?.ok ? `AÑADIDA: ${res.name}` : res?.message || '';
        await menu.refresh();
      },
    });
    action('Añadir enlace', {
      value: 'LINK',
      chevron: 'link',
      onClick: () => {
        menu.linkForm = !menu.linkForm;
        menu.appNote = '';
        menu.rerender();
      },
    });
    if (menu.linkForm) body.append(linkEditor(menu, build));
    if (menu.appNote) body.append(build('div', 'appmenu__hint appmenu__app-note', menu.appNote));

    foundView(menu, state, ctx);

    section('PROBAR COMANDO', 'apps-test');
    const test = build('div', 'appmenu__fix appmenu__apps-test');
    const input = textInput(menu, build, menu.testText, 'abre Discord y YouTube', 80);
    const result = build('div', 'appmenu__hint', menu.testResult || 'Escribe una orden: te digo qué haría, sin hacerlo.');
    let timer = null;
    const check = async () => {
      menu.testText = input.value;
      const res = await menu.host.menuAction({ id: 'apps-test', value: input.value }).catch(() => null);
      menu.testResult = res?.text || '';
      result.textContent = menu.testResult || 'Escribe una orden: te digo qué haría, sin hacerlo.';
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

export function foundView(menu, state, ctx) {
  const { body, build, section, action } = ctx;
    const found = state.found || { items: [] };
    const items = found.items || [];
    section('ENCONTRADO EN ESTA PC', 'apps-found');
    const busy = menu.scanning || found.scanning;
    action('Volver a escanear', {
      value: busy ? 'ESCANEANDO…' : found.at ? `HACE ${since(found.at)}` : 'NUNCA',
      onClick: async () => {
        if (menu.scanning) return;
        menu.scanning = true;
        menu.foundNote = '';
        menu.rerender();
        const res = await menu.host.menuAction({ id: 'apps-rescan' }).catch(() => ({ ok: false, message: 'No se pudo escanear.' }));
        menu.scanning = false;
        const c = res?.counts;
        menu.foundNote = res?.ok && c ? `STEAM ${c.steam} · EPIC ${c.epic} · GOG ${c.gog} · INICIO ${c.start}` : res?.message || '';
        await menu.refresh();
      },
    });
    if (menu.foundNote) body.append(build('div', 'appmenu__hint appmenu__app-note', menu.foundNote));
    if (!items.length) {
      body.append(build('div', 'appmenu__hint', busy ? 'Buscando juegos y programas…' : 'Nada todavía: escanea para ver tus juegos y programas.'));
      return;
    }
    const wrap = build('div', 'appmenu__fix appmenu__found');
    const input = textInput(menu, build, menu.foundFilter, `Filtrar ${items.length}…`, 40);
    const list = build('div', 'appmenu__apps-list appmenu__found-list');
    const show = () => {
      const q = menu.foundFilter.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
      const hits = items.filter((it) => !q || `${it.name} ${it.sourceLabel}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(q));
      const rows = [];
      for (const it of hits.slice(0, 80)) {
        const open = menu.foundOpen === it.name;
        const row = build('button', 'appmenu__row appmenu__row--action appmenu__app');
        row.type = 'button';
        row.append(build('span', 'appmenu__label', it.name), build('span', `appmenu__meta appmenu__tag appmenu__tag--${it.source}`, `[${it.sourceLabel}]`));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.foundOpen = open ? null : it.name;
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
            const res = await menu.host.menuAction({ id: 'apps-promote', value: it.name }).catch(() => ({ ok: false, message: 'No se pudo.' }));
            menu.appNote = res?.ok ? `AÑADIDA: ${res.name}` : res?.message || 'No se pudo.';
            menu.foundOpen = null;
            await menu.refresh();
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
      menu.foundFilter = input.value;
      show();
    });
    show();
    wrap.append(input, list);
    body.append(wrap);
  }

  // "5 MIN", "3 H", "2 DÍAS"

export function since(at) {
    const min = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (min < 60) return `${min} MIN`;
    const h = Math.round(min / 60);
    return h < 48 ? `${h} H` : `${Math.round(h / 24)} DÍAS`;
  }

  // Mirrors reminders.formatDateTimeLocal / parseDateTimeLocal (renderer cannot require main).
  // Always 24h clock for the native datetime-local value; spoken/list labels use cfg.timeFormat.

export function appEditor(menu, app, ctx) {
  const { build, selector } = ctx;
    const panel = build('div', 'appmenu__fix appmenu__app-edit');
    panel.append(build('div', 'appmenu__hint appmenu__app-target', app.target));
    const field = build('label', 'appmenu__fix-field');
    const aliases = textInput(menu, build, app.aliases.join(', '), 'otros nombres, separados por comas', 200);
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
          saveApp(menu, app, aliases.value, close);
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
    const del = build('button', 'appmenu__toggle-btn appmenu__app-delete', menu.appDelete === app.name ? 'CONFIRMAR' : 'BORRAR');
    del.type = 'button';
    if (menu.appDelete === app.name) del.classList.add('is-danger');
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (menu.appDelete !== app.name) {
        menu.appDelete = app.name;
        menu.rerender();
        return;
      }
      await menu.host.menuAction({ id: 'apps-remove', value: app.name });
      menu.appOpen = null;
      menu.appDelete = null;
      menu.appNote = `BORRADA: ${app.name}`;
      await menu.refresh();
    });
    const save = build('button', 'appmenu__toggle-btn appmenu__fix-save is-active', 'GUARDAR');
    save.type = 'button';
    save.dataset.state = 'on';
    save.addEventListener('click', (e) => {
      e.stopPropagation();
      saveApp(menu, app, aliases.value, close);
    });
    aliases.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveApp(menu, app, aliases.value, close);
      }
    });
    actions.append(del, save);
    panel.append(actions);
    return panel;
  }


export async function saveApp(menu, app, aliases, close) {
    const res = await menu.host.menuAction({ id: 'apps-update', value: { name: app.name, aliases, close } })
      .catch(() => ({ ok: false, message: 'No se pudo guardar.' }));
    menu.appNote = res?.ok ? `GUARDADA: ${app.name}` : res?.message || 'No se pudo guardar.';
    await menu.refresh();
  }


export function linkEditor(menu, build) {
    const panel = build('div', 'appmenu__fix');
    const field = (label, placeholder) => {
      const wrap = build('label', 'appmenu__fix-field');
      const input = textInput(menu, build, '', placeholder, label === 'URL' ? 300 : 40);
      wrap.append(build('span', 'appmenu__fix-label', label), input);
      panel.append(wrap);
      return input;
    };
    const name = field('Nombre', 'Twitch');
    const url = field('URL', 'https://www.twitch.tv');
    const save = async () => {
      if (!name.value.trim()) return name.focus();
      if (!url.value.trim()) return url.focus();
      const res = await menu.host.menuAction({ id: 'apps-add-link', value: { name: name.value, url: url.value } })
        .catch(() => ({ ok: false, message: 'No se pudo.' }));
      menu.appNote = res?.ok ? `AÑADIDA: ${res.name}` : res?.message || 'No se pudo.';
      if (res?.ok) menu.linkForm = false;
      return menu.refresh();
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


export function renderAppsEntry(menu, state, ctx) {
  const { section, action } = ctx;
      // APPS: what "abre X" / "cierra X" reach, in a panel of its own
      section('APPS', 'apps', 'apps');
      action('Mis apps', {
        value: `${(state.apps || []).length} APPS`,
        chevron: 'apps',
        onClick: () => {
          menu.view = 'apps';
          menu.resetApps();
          menu.render(state);
        },
      });

}
