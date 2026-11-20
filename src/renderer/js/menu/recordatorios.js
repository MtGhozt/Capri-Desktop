import { resolvedTimeZone } from './widgets.js';

// Mirrors reminders.formatDateTimeLocal / parseDateTimeLocal (renderer cannot require main).
// Always 24h clock for the native datetime-local value; spoken/list labels use cfg.timeFormat.
export function reminderInputValue(at, timeZone = '') {
  const ms = Number(at);
  if (!Number.isFinite(ms)) return '';
  const zone = resolvedTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function reminderInputToIso(value, timeZone = '') {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return '';
  const zone = resolvedTimeZone(timeZone);
  let guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(guess));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
    const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const have = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    const delta = want - have;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}

export function render(menu, state, ctx) {
  const { cfg } = state;
  const { section, body, build } = ctx;

  section('RECORDATORIOS', 'reminders');
  const pending = Array.isArray(cfg.reminders) ? cfg.reminders : [];
  if (!pending.length) {
    const empty = build('div', 'appmenu__hint', 'No hay recordatorios pendientes.');
    empty.dataset.setting = 'reminders';
    body.append(empty);
  } else {
    for (const item of pending) {
      const row = build('div', 'appmenu__row appmenu__reminder-row');
      row.dataset.setting = 'reminders';
      const label = build('span', 'appmenu__label', item.when || '');
      label.title = item.text || '';
      row.append(label);
      const text = build('span', 'appmenu__hint', item.text || '');
      row.append(text);
      const whenInput = build('input', 'appmenu__input');
      whenInput.type = 'datetime-local';
      // Edit the event clock; main recomputes fire time from noticeMin.
      const editAt = item.eventAt || item.at;
      whenInput.value = reminderInputValue(editAt, cfg.timeZone);
      whenInput.title = item.noticeMin
        ? `Hora del evento (aviso ${item.noticeMin} min antes)`
        : 'Editar hora';
      whenInput.addEventListener('change', () => {
        const iso = whenInput.value
          ? reminderInputToIso(whenInput.value, cfg.timeZone)
          : '';
        menu.act('reminder-update', { id: item.id, at: iso });
      });
      row.append(whenInput);
      const del = build('button', 'appmenu__toggle-btn', 'Borrar');
      del.type = 'button';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.act('reminder-delete', { id: item.id });
      });
      row.append(del);
      body.append(row);
    }
  }
  if (menu.reminderNote) {
    const note = build('div', 'appmenu__hint', menu.reminderNote);
    note.dataset.setting = 'reminders';
    body.append(note);
  }
}