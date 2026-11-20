import { TIME_ZONE_OPTIONS, validTimeZone, resolvedTimeZone } from './widgets.js';
import { textInput } from './widgets.js';

export function render(menu, state, ctx) {
  const { cfg } = state;
  const { section, action, toggle, selector, body, build } = ctx;

  // CLIPS (lives under Comportamiento: no separate sidebar tab)
  section('CLIPS', 'behavior');
  const clipNvidia = state.clips?.nvidia !== false;
  action('Guardar clip', {
    setting: 'behavior',
    hotkey: state.clips?.hotkey || (clipNvidia ? 'Alt+F10' : 'Win+Alt+G'),
    value: clipNvidia ? '' : 'Xbox Game Bar (grabación en segundo plano en Windows)',
    help: 'clip',
    onClick: () => menu.act('clip-save'),
  });
  action('Abrir carpeta de clips', {
    setting: 'behavior',
    value: state.clips.folder,
    onClick: () => menu.act('clips-dir'),
  });

  // COMPORTAMIENTO
  section('COMPORTAMIENTO', 'behavior');
  const nameRow = build('div', 'appmenu__row appmenu__name-row');
  nameRow.dataset.setting = 'behavior';
  nameRow.append(build('span', 'appmenu__label', 'Tu nombre'));
  const nameInput = textInput(menu, build, cfg.userName || '', 'cómo te llamo', 24);
  nameInput.addEventListener('change', () => menu.act('user-name', nameInput.value.trim()));
  nameRow.append(nameInput);
  body.append(nameRow);
  const zone = resolvedTimeZone(cfg.timeZone);
  const hour12 = String(cfg.timeFormat || '24h') === '12h';
  selector('País / zona horaria', {
    setting: 'behavior',
    options: TIME_ZONE_OPTIONS,
    current: validTimeZone(cfg.timeZone),
    onChange: (id) => menu.act('time-zone', id),
  });
  selector('Formato de hora', {
    setting: 'behavior',
    options: [
      { id: '24h', label: '24 H' },
      { id: '12h', label: '12 H' },
    ],
    current: hour12 ? '12h' : '24h',
    onChange: (id) => menu.act('time-format', id),
  });
  const zoneNow = build('div', 'appmenu__hint', `${new Intl.DateTimeFormat('es', {
    timeZone: zone, weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12,
  }).format(new Date())} · ${zone}`);
  zoneNow.dataset.setting = 'behavior';
  body.append(zoneNow);
  const placeRow = build('div', 'appmenu__row appmenu__name-row');
  placeRow.dataset.setting = 'behavior';
  placeRow.append(build('span', 'appmenu__label', 'Ciudad / país (clima)'));
  const placeInput = textInput(menu, build, cfg.weatherPlace || '', 'Ej.: Madrid, España', 80);
  placeInput.addEventListener('change', () => menu.act('weather-place', placeInput.value.trim()));
  placeRow.append(placeInput);
  body.append(placeRow);
  const placeHint = build('div', 'appmenu__hint', menu.placeNote
    || 'Vacío = sin clima ni feriados.');
  placeHint.dataset.setting = 'behavior';
  if (menu.placeNote) placeHint.classList.add('is-place-resolved');
  body.append(placeHint);
  toggle('Iniciar con Windows', {
    setting: 'behavior',
    on: Boolean(state.login),
    labels: ['NO', 'SÍ'],
    onChange: (on) => menu.act('startup', on),
  });
  toggle('Acceso directo en Escritorio', {
    setting: 'behavior',
    on: Boolean(state.deskShortcut),
    labels: ['NO', 'SÍ'],
    onChange: (on) => menu.act('desktop-shortcut', on),
  });
  const playMode = cfg.gaming?.mode === 'comment' ? 'comment' : 'quiet';
  selector('En juegos', {
    setting: 'behavior',
    help: 'gaming',
    options: [
      { id: 'quiet', label: 'No molestar' },
      { id: 'comment', label: 'Comentar de vez en cuando' },
    ],
    current: playMode,
    onChange: (id) => menu.act('gaming-play', id),
  });
  if (menu.gamePlayNote) {
    const warn = build('div', 'appmenu__hint', menu.gamePlayNote);
    warn.dataset.setting = 'behavior';
    body.append(warn);
  }
}

export function renderTail(menu, state, ctx) {
  const { cfg } = state;
  const { toggle, action, body, build } = ctx;

  toggle('Comentarios', {
    setting: 'behavior',
    on: cfg.comments?.enabled !== false,
    labels: ['NO', 'SÍ'],
    onChange: (on) => menu.act('comments', on),
  });
  const commentFrequency = build('div', 'appmenu__row appmenu__comment-frequency');
  commentFrequency.dataset.setting = 'behavior';
  commentFrequency.append(build('span', 'appmenu__label', 'Frecuencia (min–máx)'));
  for (const [key, fallback] of [['minMinutes', 20], ['maxMinutes', 40]]) {
    const input = build('input', 'appmenu__input');
    input.type = 'number';
    input.min = '1';
    input.max = '1440';
    input.value = String(cfg.comments?.[key] ?? fallback);
    input.title = key === 'minMinutes' ? 'Mínimo en minutos' : 'Máximo en minutos';
    input.addEventListener('change', () => menu.act('comments-range', {
      [key]: Math.max(1, Math.min(1440, Number(input.value) || fallback)),
    }));
    commentFrequency.append(input);
  }
  body.append(commentFrequency);
  toggle('Saludos', {
    setting: 'behavior',
    on: cfg.behavior?.greetings !== false,
    labels: ['NO', 'SÍ'],
    onChange: (on) => menu.act('greetings', on),
  });
  toggle('Saludo al desbloquear', {
    setting: 'behavior',
    on: cfg.behavior?.unlockGreeting !== false,
    labels: ['NO', 'SÍ'],
    onChange: (on) => menu.act('unlock-greeting', on),
  });
  toggle('Caricias', {
    setting: 'behavior',
    on: cfg.behavior?.caresses !== false,
    labels: ['NO', 'SÍ'],
    onChange: (on) => menu.act('caresses', on),
  });
  toggle('Bailar con música', {
    setting: 'behavior',
    on: cfg.behavior?.musicDance !== false,
    labels: ['NO', 'SÍ'],
    onChange: (on) => menu.act('music-dance', on),
  });
  action('Recomendar perfil para mi PC', {
    setting: 'behavior',
    onClick: () => menu.act('recommend-profile'),
  });
}