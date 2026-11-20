export const REPLY_OPTIONS = [
  { id: 'voice', label: 'VOZ' },
  { id: 'blips', label: 'BLIPS' },
  { id: 'silent', label: 'SILENCIO' },
];

export const CLOSE_OPTIONS = [
  { id: 'graceful', label: 'CON CUIDADO' },
  { id: 'ask', label: 'PREGUNTAR' },
  { id: 'force', label: 'FORZAR' },
];

export const THEME_OPTIONS = [
  { id: 'cyberpunk', label: 'CYBERPUNK' },
  { id: 'capri', label: 'CAPRI' },
];

export const TIME_ZONE_OPTIONS = [
  { id: '', label: 'Automático (Windows)' },
  { id: 'Europe/Madrid', label: 'España' },
  { id: 'America/Mexico_City', label: 'México' },
  { id: 'America/Argentina/Buenos_Aires', label: 'Argentina' },
  { id: 'America/Bogota', label: 'Colombia' },
  { id: 'America/Santiago', label: 'Chile' },
  { id: 'America/Lima', label: 'Perú' },
  { id: 'America/Costa_Rica', label: 'Costa Rica' },
  { id: 'America/Caracas', label: 'Venezuela' },
  { id: 'America/Montevideo', label: 'Uruguay' },
  { id: 'America/New_York', label: 'Estados Unidos (Este)' },
];

export function validTimeZone(zone) {
  const value = String(zone || '').trim();
  if (!value) return '';
  try {
    new Intl.DateTimeFormat('es', { timeZone: value });
    return value;
  } catch {
    return '';
  }
}

export function resolvedTimeZone(zone) {
  return validTimeZone(zone) || validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
}

export function build(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function kbd(text) {
  return build('kbd', 'appmenu__kbd', text);
}

export function createRowHelpers(menu, body, buildFn) {
  const build = buildFn;

  const section = (title, id = title, help = '') => {
    const heading = build('div', 'appmenu__section');
    heading.dataset.section = id;
    heading.append(build('span', 'appmenu__section-title', title));
    if (help) heading.append(menu.helpButton(help));
    body.append(heading);
  };

  // The "?" sits right next to its label, never taking the row's action.
  const labelNode = (text, help = '') => {
    if (!help) return build('span', 'appmenu__label', text);
    const wrap = build('span', 'appmenu__label appmenu__label--help');
    wrap.append(build('span', '', text), menu.helpButton(help));
    return wrap;
  };

  const action = (label, { value = '', hotkey = '', danger = false, sub = false, chevron = '', setting = '', onClick, help = '' } = {}) => {
    const row = build(onClick ? 'button' : 'div', 'appmenu__row appmenu__row--action');
    if (onClick) row.type = 'button';
    if (danger) row.classList.add('is-danger');
    if (sub) row.classList.add('appmenu__row--sub');
    if (setting) row.dataset.setting = setting;
    row.append(labelNode(label, help));
    if (hotkey) row.append(kbd(hotkey));
    else if (value) row.append(build('span', 'appmenu__meta', value));
    if (chevron) {
      const mark = build('span', 'appmenu__chevron', '›');
      if (menu.expanded === chevron) mark.classList.add('is-open');
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
  const toggle = (label, { on, onChange, labels = ['OFF', 'ON'], setting = '' }) => {
    const row = build('div', 'appmenu__row');
    if (setting) row.dataset.setting = setting;
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

  const selector = (label, { options, current, onChange, setting = '', help = '' }, into = body) => {
    const index = Math.max(0, options.findIndex((o) => String(o.id) === String(current)));
    const row = build('div', 'appmenu__row');
    if (setting) row.dataset.setting = setting;
    row.append(labelNode(label, help));
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
    if (placed.hint) into.append(build('div', 'appmenu__hint', placed.hint));
  };

  return { section, labelNode, action, toggle, selector, kbd };
}

// A text field that keeps its keys to itself (Esc still closes the menu).
export function textInput(menu, build, value, placeholder, max = 60) {
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
      menu.onEscape();
    }
  });
  for (const type of ['mousedown', 'click']) input.addEventListener(type, (e) => e.stopPropagation());
  return input;
}