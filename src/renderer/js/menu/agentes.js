export function render(menu, state, ctx) {
  const { section, action, body, build } = ctx;

  section('AGENTES', 'agents', 'agents');
  const agents = state.agents || [];
  for (const agent of agents) {
    const stateLabel = !agent.found ? 'NO ENCONTRADO' : agent.installed ? 'INSTALADO' : 'NO INSTALADO';
    action(agent.name, {
      setting: 'agents',
      value: agent.installed ? 'QUITAR' : 'INSTALAR',
      onClick: async () => {
        const res = await menu.host.menuAction({
          id: agent.installed ? 'agent-remove' : 'agent-install',
          value: agent.id,
        }).catch(() => ({ ok: false, message: 'No se pudo.' }));
        menu.agentNote = res?.ok
          ? (agent.installed ? `${agent.name}: hooks quitados.` : `${agent.name}: hooks instalados. Reiniciá el agente.`)
          : res?.message || `No se pudo con ${agent.name}.`;
        await menu.refresh();
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
  if (menu.agentNote) {
    const note = build('div', 'appmenu__hint', menu.agentNote);
    note.dataset.setting = 'agents';
    body.append(note);
  }
  const agentsHint = build('div', 'appmenu__hint', 'Codex pide confiar en los hooks con /hooks. Los demás los cargan al reiniciar.');
  agentsHint.dataset.setting = 'agents';
  body.append(agentsHint);
}