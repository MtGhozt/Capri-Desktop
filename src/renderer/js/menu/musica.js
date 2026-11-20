export function render(menu, state, ctx) {
  const { cfg } = state;
  const { section, selector, body, build } = ctx;

  section('MÚSICA', 'music', 'spotify');
  selector('Reproductor', {
    options: [
      { id: 'namida', label: 'NAMIDA' },
      { id: 'spotify', label: 'SPOTIFY' },
      { id: 'youtube', label: 'YOUTUBE MUSIC' },
      { id: 'none', label: 'NINGUNO' },
    ],
    current: cfg.musicPlayer || 'namida',
    onChange: (id) => menu.act('music-player', id),
    help: 'namida',
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
    menu.host.menuAction({
      id: state.music?.connected ? 'spotify-disconnect' : 'spotify-connect',
      value: client.value.trim(),
    }).then(() => menu.refresh()).catch(() => {});
  });
  spotify.append(build('label', 'appmenu__fix-field', 'Client ID'), client, saveClient,
    build('div', 'appmenu__hint', state.music?.connected ? 'CONECTADO' : 'SIN CONEXIÓN'));
  body.append(spotify);
}