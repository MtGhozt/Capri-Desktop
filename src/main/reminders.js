'use strict';

// Timers and reminders that survive a restart. A direct "timer 10 minutos" never reaches the
// model; dates like "mañana a las 8" come from her hidden [remind:<ISO>|<text>] tag. Both land in
// reminders.json next to config.json, checked every few seconds (never one huge setTimeout).

const fs = require('node:fs');
const path = require('node:path');
const { normalizeCommandText } = require('./command-text');
const { resolveTimeZone } = require('./llm');

const CHECK_MS = 15000;
const NUMBERS = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30,
};
const DURATION = /(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|media)\s*(minutos?|mins?|min|horas?|hs?|h)\b/g;

function parseMinutes(text) {
  const s = String(text || '').toLowerCase();
  let minutes = 0;
  let lastEnd = 0;
  DURATION.lastIndex = 0;
  let m;
  while ((m = DURATION.exec(s))) {
    const raw = m[1];
    const n = raw === 'media' ? 0.5 : (NUMBERS[raw] ?? Number(raw.replace(',', '.')));
    if (!Number.isFinite(n)) continue;
    const unit = m[2];
    minutes += /^h/.test(unit) ? n * 60 : n;
    lastEnd = m.index + m[0].length;
  }
  // "una hora y media": the extra half hour has no unit of its own
  if (/\bhora\s+y\s+media\b/.test(s)) minutes += 30;
  if (!(minutes > 0)) return null;
  const tail = String(text).slice(lastEnd).replace(/^[\s,;]+(?:para|de|que)?[\s,;]+/i, '').trim();
  return { minutes: Math.round(minutes), note: tail };
}

function durationText(minutes) {
  if (minutes % 60 === 0 && minutes >= 60) {
    const h = minutes / 60;
    return `${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}

// The direct orders: "timer 10 minutos", "avisame en media hora", "recordame en 2 horas",
// "cancelá el recordatorio", "qué recordatorios tengo". Anything with a real date ("mañana a
// las 8") is left for the model and its [remind:...] tag.
function parseReminderCommand(text, { now = Date.now() } = {}) {
  const said = normalizeCommandText(text);
  if (!said) return null;
  if (/^(?:que|cuales)\s+.*\b(?:recordatorios?|temporizadores?|timers?|avisos?|alarmas?)\b/.test(said)) {
    return { action: 'list' };
  }
  if (/^(?:cancela|cancelar|borra|borrar|elimina|eliminar|quita|quitar)\b.*\b(?:recordatorios?|temporizadores?|timers?|avisos?|alarmas?)\b/.test(said)) {
    const all = /todos|todas/.test(said);
    const match = all ? '' : said
      .replace(/^(?:cancela|cancelar|borra|borrar|elimina|eliminar|quita|quitar)\b/, '')
      .replace(/\b(?:el|la|los|las|mi|mis|un|una)?\s*(?:recordatorios?|temporizadores?|timers?|avisos?|alarmas?)\b/, '')
      .replace(/^\s*(?:de|del|para|que)\b\s*/, '')
      .trim();
    return { action: 'cancel', all, match };
  }
  const m = /^(?:pon(?:e|me)?\s+|poner\s+|inicia\s+)?(?:un\s+|una\s+)?(?:temporizador|timer|alarma|aviso|recordatorio|recordame|avisame)\b\s*(?:de\s+|en\s+|para\s+)?(.+)$/.exec(said);
  if (!m) return null;
  const parsed = parseMinutes(m[1]);
  if (!parsed) return null;
  return {
    action: 'create',
    at: now + parsed.minutes * 60000,
    text: parsed.note || `el timer de ${durationText(parsed.minutes)}`,
    minutes: parsed.minutes,
  };
}

// "hoy a las 14:30", "mañana a las 07:00", "el miércoles 12 de noviembre a las 08:00", in the
// zone she is using ('' = this PC's).
function formatWhen(at, { now = new Date(), timeZone = '' } = {}) {
  const zone = resolveTimeZone(timeZone);
  const day = (date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const time = new Intl.DateTimeFormat('es-CR', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(at));
  const today = day(now);
  if (day(new Date(at)) === today) return `hoy a las ${time}`;
  if (day(new Date(at)) === day(new Date(now.getTime() + 86400000))) return `mañana a las ${time}`;
  const date = new Intl.DateTimeFormat('es-CR', {
    timeZone: zone, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(at));
  return `${date} a las ${time}`;
}

// Bubble always; voice unless No molestar (a game owns the screen). A dead TTS never eats the bubble.
function deliverReminder({ line, noMolestar = false, speak, show } = {}) {
  const text = String(line || '').trim();
  if (!text) return { spoken: false };
  let spoken = false;
  if (!noMolestar) {
    try {
      spoken = Boolean(speak?.(text));
    } catch { /* the bubble still has to land */ }
  }
  show?.(text);
  return { spoken };
}

function createReminders({
  file, now = () => Date.now(), fire, intervalMs = CHECK_MS,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
} = {}) {
  let items = [];
  let timer = null;
  let seq = 0;
  let missedAtBoot = 0;

  const fold = (text) => String(text || '')
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  const clean = (raw) => {
    const at = Number(raw?.at);
    const text = String(raw?.text || '').trim().slice(0, 200);
    if (!Number.isFinite(at) || !text) return null;
    return { id: String(raw?.id || `r${at}-${++seq}`), at, text };
  };

  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      items = (Array.isArray(data) ? data : []).map(clean).filter(Boolean);
    } catch {
      items = [];
    }
    return items;
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(items, null, 2));
    } catch { /* a reminder that cannot be saved is still scheduled for this run */ }
  }

  function list() {
    return items.slice().sort((a, b) => a.at - b.at);
  }

  function add({ at, text }) {
    const item = clean({ id: `r${now()}-${++seq}`, at, text });
    if (!item) return null;
    items = [...items, item];
    save();
    return item;
  }

  function cancelAll() {
    const count = items.length;
    items = [];
    save();
    return count;
  }

  // The next pending one, or the first whose text mentions what he said.
  function cancelOne(match = '') {
    const needle = fold(match).trim();
    const target = needle
      ? list().find((item) => fold(item.text).includes(needle))
      : list()[0];
    if (!target) return null;
    items = items.filter((item) => item.id !== target.id);
    save();
    return target;
  }

  // Startup greeting needs this before start() runs too, so read the file when nothing is cached.
  function missedCount() {
    if (missedAtBoot) return missedAtBoot;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return (Array.isArray(data) ? data : []).filter((item) => Number(item?.at) <= now()).length;
    } catch {
      return 0;
    }
  }

  function tick() {
    const t = now();
    const due = items.filter((item) => item.at <= t);
    if (!due.length) return [];
    items = items.filter((item) => item.at > t);
    save();
    const item = due.length === 1
      ? due[0]
      : { id: 'due', at: due[0].at, text: due.map((one) => one.text).join(' · '), count: due.length };
    try { fire?.(item, { missed: false }); } catch { /* keep the scheduler alive */ }
    return due;
  }

  // Startup: pending ones stay scheduled; anything that passed while she was closed is told once,
  // grouped into a single line, and dropped.
  function start() {
    read();
    const t = now();
    const missed = items.filter((item) => item.at <= t);
    items = items.filter((item) => item.at > t);
    if (missed.length) {
      missedAtBoot = missed.length;
      save();
      const item = missed.length === 1
        ? missed[0]
        : { id: 'missed', at: missed[0].at, text: missed.map((one) => one.text).join(' · '), count: missed.length };
      try { fire?.(item, { missed: true }); } catch { /* keep the scheduler alive */ }
    }
    if (!timer && intervalMs > 0) timer = setIntervalFn(tick, intervalMs);
    return { missed: missed.length, pending: items.length };
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  return { start, stop, add, list, cancelAll, cancelOne, missedCount, tick, read };
}

module.exports = {
  CHECK_MS, parseReminderCommand, formatWhen, deliverReminder, createReminders,
};
