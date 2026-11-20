export async function saveShortcut(menu, id, keys) {
  let result;
  try {
    result = await menu.host.menuAction({ id: 'shortcut-set', value: { id, ...keys } });
  } catch {
    result = { ok: false, message: 'No se pudo guardar.' };
  }
  menu.capturingId = null;
  const note = result?.ok ? `GUARDADA: ${result.accel}` : result?.message || 'Esa no sirve.';
  if (id === 'talk') menu.talkNote = note;
  menu.shortcutNote = note;
  await menu.refresh();
}

// Ajustes › Atajos: one editable combo each, same capture flow as Tecla para hablar.
export function shortcutRow(menu, s, build, kbd) {
  const wrap = build('div', 'appmenu__talkkey');
  wrap.dataset.setting = 'shortcuts';
  const row = build('button', 'appmenu__row appmenu__row--action appmenu__shortcut-row');
  row.type = 'button';
  row.append(build('span', 'appmenu__label', s.label));
  const capturing = menu.capturingId === s.id;
  if (capturing) row.append(build('span', 'appmenu__meta appmenu__capture', 'PULSA LA COMBINACIÓN…'));
  else if (s.accel) row.append(kbd(s.accel));
  else row.append(build('kbd', 'appmenu__kbd appmenu__kbd--empty', '—'));
  row.append(build('span', 'appmenu__meta appmenu__shortcut-action', capturing ? 'ESC' : 'CAMBIAR'));
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.capturingId = capturing ? null : s.id;
    menu.shortcutNote = '';
    menu.rerender();
  });
  wrap.append(row);
  if (capturing) wrap.append(build('div', 'appmenu__hint', 'Ctrl, Alt o Win más una tecla. Esc cancela.'));
  else if (!s.active) wrap.append(build('div', 'appmenu__hint', 'No se pudo registrar: elige otra combinación.'));
  return wrap;
}

export function render(menu, state, ctx) {
  const { section, action, body, build, kbd } = ctx;

  section('ATAJOS', 'shortcuts');
  for (const s of state.shortcuts || []) body.append(shortcutRow(menu, s, build, kbd));
  if (menu.shortcutNote) {
    const note = build('div', 'appmenu__hint', menu.shortcutNote);
    note.dataset.setting = 'shortcuts';
    body.append(note);
  }
  action('Abrir config.json', {
    setting: 'shortcuts',
    value: 'EDITAR',
    sub: true,
    onClick: () => menu.act('shortcuts-file'),
  });
}