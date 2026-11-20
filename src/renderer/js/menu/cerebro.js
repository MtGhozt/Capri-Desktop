export async function saveShare(menu, patch) {
  await menu.host.menuAction({ id: 'model-share', value: patch }).catch(() => {});
  await menu.refresh();
}

export function brainPanel(menu, model, { build }) {
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
        const notes = menu.probeNotes || {};
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
        const move = (id, direction) => menu.host.menuAction({ id: 'model-reorder', value: { id, direction } }).then(() => menu.refresh());
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
          toggle.addEventListener('click', (e) => { e.stopPropagation(); menu.act('model-provider', id); });
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
            get.addEventListener('click', (e) => { e.stopPropagation(); menu.host.menuAction({ id: 'open-url', value: link.url }); });
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
            const result = await menu.host.menuAction({
              id: 'model-probe',
              value: {
                provider: id,
                key: key?.input.value,
                model: modelField.input.value.trim(),
                baseUrl: url?.input.value.trim(),
              },
            }).catch(() => ({ ok: false, message: 'No se pudo probar.' }));
            menu.probeNotes = { ...(menu.probeNotes || {}), [id]: result?.message || 'Falló.' };
            await menu.refresh();
          });
          actions.append(probe);
          if (hasKey) {
            const remove = build('button', 'appmenu__toggle-btn appmenu__danger', 'Quitar key');
            remove.type = 'button';
            remove.addEventListener('click', async (e) => {
              e.stopPropagation();
              await menu.host.menuAction({ id: 'model-key', value: { provider: id, key: '' } });
              await menu.refresh();
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
              menu.probeNotes = { ...(menu.probeNotes || {}), [brainId]: 'No encontrado, copiá el comando de al lado.' };
              menu.refresh();
              return;
            }
            menu.agentNote = `${item.label} ${active.has(brainId) ? 'desactivado' : 'activado'}`;
            menu.act('model-provider', brainId);
          });
          row.append(toggle);
          if (!item.installed) {
            const cmdWrap = build('div', 'appmenu__agent-cmd');
            const command = build('input', 'appmenu__input');
            command.value = item.installHow || '';
            command.readOnly = true;
            command.title = 'Seleccioná y copiá el comando';
            const copy = build('button', 'appmenu__toggle-btn', 'Copiar');
            copy.type = 'button';
            copy.addEventListener('click', async (e) => {
              e.stopPropagation();
              try {
                await navigator.clipboard.writeText(command.value);
                copy.textContent = 'Copiado';
                clearTimeout(copy.resetTimer);
                copy.resetTimer = setTimeout(() => { copy.textContent = 'Copiar'; }, 1600);
              } catch { /* no clipboard: the command is still on screen */ }
            });
            cmdWrap.append(command, copy);
            row.append(cmdWrap);
          }
          const hint = item.installed
            ? (item.viaKnownPath ? item.note : 'Instalado · clic para activar/apagar')
            : `No instalado · copiá el comando${item.id === 'cursor-agent' ? ' · El editor Cursor solo no alcanza.' : ''}`;
          row.append(build('span', 'appmenu__hint appmenu__agent-hint',
            menu.agentNote?.startsWith(item.label)
              ? menu.agentNote
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
        const res = await menu.host.menuAction({ id: 'model-probe', value: payload })
          .catch(() => ({ ok: false, message: 'No se pudo probar.' }));
        menu.probeNote = res?.message || (res?.ok ? 'Listo.' : 'Falló.');
        menu.probeOk = Boolean(res?.ok);
        await menu.refresh();
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
          const res = await menu.host.menuAction({ id: 'model-key', value: { provider: id, key: '' } })
            .catch(() => ({ ok: false, message: 'No se pudo quitar.' }));
          menu.probeNote = res?.message || 'Clave borrada.';
          menu.probeOk = Boolean(res?.ok);
          await menu.refresh();
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
        menu.host.menuAction({ id: 'open-url', value: link.url }).catch(() => {});
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
    freeCard.append(pickRow(freeIds, (id) => menu.act('model-provider', id), { recommend: 'gemini' }));
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
    localCard.append(pickRow(localIds, (id) => menu.act('model-provider', id)));
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
        menu.host.menuAction({ id: 'open-url', value: link.url }).catch(() => {});
      });
      ownLinksRow.append(btn);
    }
    ownCard.append(
      ownLinksRow,
      build('div', 'appmenu__hint', 'Anthropic: console.anthropic.com → API keys. Grok: console.x.ai → Create API key. Pegá la key abajo y probá.'),
    );
    ownCard.append(pickRow(ownIds, (id) => menu.act('model-provider', id)));
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
        menu.act('model-provider', id);
      });
      const command = build('input', 'appmenu__input');
      command.type = 'text';
      command.value = a?.installHow || '';
      command.readOnly = true;
      command.title = 'Seleccioná y copiá el comando';
      row.append(button, command);
      agentCard.append(row);
    }
    agentCard.append(pickRow(['agent-auto'], (id) => menu.act('model-provider', id)));
    const refreshAgents = build('button', 'appmenu__toggle-btn', 'REVISAR DE NUEVO');
    refreshAgents.type = 'button';
    refreshAgents.addEventListener('click', async (e) => {
      e.stopPropagation();
      refreshAgents.disabled = true;
      await menu.host.menuAction({ id: 'agents-refresh' }).catch(() => null);
      await menu.refresh();
    });
    agentCard.append(refreshAgents);
    agentCard.append(probeBtn(() => ({
      provider: agentIds.includes(active) ? active : 'agent-auto',
    })));
    wrap.append(agentCard);

    if (menu.probeNote) {
      const status = build(
        'div',
        `appmenu__hint appmenu__brain-status${menu.probeOk ? ' is-ok' : ' is-bad'}`,
        menu.probeNote,
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


export function render(menu, state, ctx) {
  const { section, toggle, body, build } = ctx;
  const model = state.model || {
    providers: [{ id: 'local', label: 'LM Studio' }], provider: 'local', model: '', local: true,
    groups: { free: ['gemini', 'nvidia'], local: ['local', 'ollama'], own: ['openai', 'deepseek', 'gemini', 'openrouter', 'groq', 'mistral'] },
    freeLinks: {},
    hasKeys: {},
    baseUrl: 'http://localhost:1235/v1',
  };
  section('CEREBRO', 'model', 'brain');
  if (menu.modelNote) {
    const welcome = build('div', 'appmenu__hint appmenu__brain-welcome', menu.modelNote);
    welcome.dataset.setting = 'model';
    body.append(welcome);
  }
  body.append(brainPanel(menu, model, { build }));
  toggle('Enviar mi pantalla cuando le pida mirar', {
    setting: 'model',
    on: model.shareScreen,
    labels: ['NO', 'SÍ'],
    onChange: (on) => saveShare(menu, { shareScreen: on }),
  });
  toggle('Mirar sola de vez en cuando', {
    setting: 'model',
    on: model.autoLook,
    labels: ['NO', 'SÍ'],
    onChange: (on) => saveShare(menu, { autoLook: on, ...(on ? { shareScreen: true } : {}) }),
  });
  toggle('Enviar lo que recuerda de mí', {
    setting: 'model',
    on: model.shareMemory,
    labels: ['NO', 'SÍ'],
    onChange: (on) => saveShare(menu, { shareMemory: on }),
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
}
