export function aboutPanel(menu, state, { build }) {
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
        await menu.host.menuAction({ id: 'open-url', value: item.url }).catch(() => {});
        return;
      }
      if (item.action === 'check-updates') {
        const res = await menu.host.menuAction({ id: 'check-updates' }).catch(() => null);
        if (res?.message) menu.probeNote = res.message;
        await menu.refresh();
        return;
      }
      if (item.action === 'share-logs') {
        const res = await menu.host.menuAction({ id: 'share-logs' }).catch(() => null);
        if (res?.message) menu.probeNote = res.message;
        await menu.refresh();
        return;
      }
      if (item.action === 'open-log') {
        const res = await menu.host.menuAction({ id: 'open-log' }).catch(() => null);
        if (res?.message) menu.probeNote = res.message;
        await menu.refresh();
        return;
      }
      if (item.action === 'diagnose') {
        const res = await menu.host.menuAction({ id: 'diagnose' }).catch(() => null);
        menu.diag = res?.ok ? { lines: res.lines || [], text: res.text || '' } : null;
        menu.probeNote = res?.ok ? '' : 'No se pudo revisar.';
        await menu.refresh();
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

  if (menu.diag) {
    const card = build('div', 'appmenu__brain-card');
    card.append(build('div', 'appmenu__brain-card-title', 'Diagnóstico'));
    for (const line of menu.diag.lines) card.append(build('div', 'appmenu__hint', line));
    const copy = build('button', 'appmenu__toggle-btn', 'Copiar reporte');
    copy.type = 'button';
    copy.addEventListener('mousedown', (e) => e.preventDefault());
    copy.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const res = await menu.host.menuAction({ id: 'diagnose-copy' }).catch(() => null);
      menu.probeNote = res?.message || 'No se pudo copiar.';
      await menu.refresh();
    });
    card.append(copy);
    wrap.append(card);
  }

  const upd = build('div', 'appmenu__brain-card');
  upd.append(build('div', 'appmenu__brain-card-title', 'Actualizaciones'));
  const toggle = build('button', `appmenu__toggle-btn${updates.enabled !== false ? ' is-active' : ''}`,
    updates.enabled !== false ? 'Buscar al abrir: SÍ' : 'Buscar al abrir: NO');
  toggle.type = 'button';
  if (updates.enabled !== false) toggle.dataset.state = 'on';
  toggle.addEventListener('click', async (e) => {
    e.stopPropagation();
    await menu.host.menuAction({ id: 'updates-enabled', value: updates.enabled === false });
    await menu.refresh();
  });
  upd.append(toggle);
  upd.append(build('div', 'appmenu__hint', 'Como máximo una vez cada 24 h. Si hay release nuevo, te pregunta; Sí abre la página (no instala sola).'));
  wrap.append(upd);

  if (menu.probeNote) {
    wrap.append(build('div', 'appmenu__hint appmenu__brain-status', menu.probeNote));
  }
  return wrap;
}

export function render(menu, state, ctx) {
  const { section, body, build } = ctx;
  section('ACERCA DE', 'about');
  body.append(aboutPanel(menu, state, { build }));
}