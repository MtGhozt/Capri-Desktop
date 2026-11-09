'use strict';

// Timers and reminders that survive a restart. A direct "timer 10 minutos" never reaches the
// model; dates like "mañana a las 8" come from her hidden [remind:<ISO>|<text>] tag. Both land in
// reminders.json next to config.json, checked every few seconds (never one huge setTimeout).

const fs = require('node:fs');
const path = require('node:path');
const { normalizeCommandText } = require('./command-text');
const { resolveTimeZone } = require('./llm');

const CHECK_MS = 15000;
const DEFAULT_NOTICE_MIN = 60; // events: warn 1 h before unless the tag says otherwise
const NUMBERS = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30,
};
const DURATION = /(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|media)\s*(minutos?|mins?|min|horas?|hs?|h)\b/g;
const CLOCK = /\b(?:a\s+las?\s+|las?\s+)?(\d{1,2})(?:[:.](\d{2}))?\b/;
const WORD_HOUR = {
  una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12,
};

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

// Third part of [remind:ISO|text|60] / "|2h" / "|1h": minutes before the event. 0 = fire at ISO.
function parseNoticeMinutes(raw, { fallback = 0 } = {}) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return fallback;
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum >= 0) return Math.round(asNum);
  const m = /^(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media)\s*(h|hs|horas?|m|min|mins|minutos?)?$/.exec(s);
  if (!m) return fallback;
  const n = m[1] === 'media' ? 0.5 : (NUMBERS[m[1]] ?? Number(String(m[1]).replace(',', '.')));
  if (!Number.isFinite(n)) return fallback;
  const unit = m[2] || 'm';
  return Math.round(/^h/.test(unit) ? n * 60 : n);
}

function resolveFireAt(eventAt, noticeMin = 0) {
  const at = Number(eventAt);
  const notice = Math.max(0, Number(noticeMin) || 0);
  if (!Number.isFinite(at)) return null;
  return { eventAt: at, noticeMin: notice, at: at - notice * 60000 };
}

function zonedParts(ms, timeZone) {
  const zone = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    zone,
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

// Build a UTC instant that shows as Y-M-D H:M in the given zone (DST-safe via probe).
function atZoneLocal({ year, month, day, hour, minute }, timeZone) {
  const zone = resolveTimeZone(timeZone);
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const got = zonedParts(guess, zone);
    const want = Date.UTC(year, month - 1, day, hour, minute);
    const have = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
    const delta = want - have;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
}

function parseClockToken(said) {
  const word = /\b(?:a\s+las?\s+|las?\s+)(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/.exec(said);
  if (word) return { hour: WORD_HOUR[word[1]], minute: 0 };
  const m = CLOCK.exec(said);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] != null ? Number(m[2]) : 0;
  if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) return null;
  return { hour, minute };
}

function parseMoveTarget(said, { now = Date.now(), timeZone = '', baseAt = null } = {}) {
  const base = Number.isFinite(baseAt) ? zonedParts(baseAt, timeZone) : zonedParts(now, timeZone);
  let day = base.day;
  let month = base.month;
  let year = base.year;
  let hour = base.hour;
  let minute = base.minute;
  let touched = false;

  if (/\bpasado\s+manana\b/.test(said)) {
    const t = new Date(atZoneLocal({ year, month, day, hour: 12, minute: 0 }, timeZone) + 2 * 86400000);
    const p = zonedParts(t.getTime(), timeZone);
    year = p.year; month = p.month; day = p.day;
    touched = true;
  } else if (/\bmanana\b/.test(said)) {
    const t = new Date(atZoneLocal({ year, month, day, hour: 12, minute: 0 }, timeZone) + 86400000);
    const p = zonedParts(t.getTime(), timeZone);
    year = p.year; month = p.month; day = p.day;
    touched = true;
  } else if (/\bhoy\b/.test(said)) {
    const p = zonedParts(now, timeZone);
    year = p.year; month = p.month; day = p.day;
    touched = true;
  }

  const clock = parseClockToken(said);
  if (clock) {
    hour = clock.hour;
    minute = clock.minute;
    touched = true;
  }
  if (!touched) return null;
  return atZoneLocal({ year, month, day, hour, minute }, timeZone);
}

function matchFromPart(fromPart) {
  return String(fromPart || '')
    .replace(/\b(?:el|la|los|las|mi|mis|un|una)?\s*(?:recordatorios?|temporizadores?|timers?|avisos?|alarmas?)\b/, '')
    .replace(/^\s*(?:el|la|los|las|de|del|para|que)\b\s*/g, '')
    .replace(/\bde\b\s*/g, '')
    .trim();
}

function findMatches(items, match, { now = Date.now(), timeZone = '' } = {}) {
  const fold = (text) => String(text || '')
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const needle = fold(match).trim();
  const pending = items.slice().sort((a, b) => a.at - b.at);
  if (!needle) return pending.slice(0, 1);
  const clock = parseClockToken(needle) || (
    /^\d{1,2}(?::\d{2})?$/.test(needle) ? parseClockToken(`a las ${needle}`) : null
  );
  if (clock) {
    return pending.filter((item) => {
      const p = zonedParts(item.at, timeZone);
      return p.hour === clock.hour && p.minute === clock.minute;
    });
  }
  const byText = pending.filter((item) => fold(item.text).includes(needle));
  if (byText.length) return byText;
  // "el de las 8" after stripping may leave "las 8" already handled; also try hour-only words
  const hourWord = WORD_HOUR[needle];
  if (hourWord != null) {
    return pending.filter((item) => zonedParts(item.at, timeZone).hour === hourWord);
  }
  return [];
}

// The direct orders: "timer 10 minutos", "avisame en media hora", "recordame en 2 horas",
// "cancelá el recordatorio", "qué recordatorios tengo", "pasá el de las 8 a las 9".
// Anything with a real date create ("mañana a las 8") is left for the model and its [remind:...] tag.
function parseReminderCommand(text, { now = Date.now(), timeZone = '' } = {}) {
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
  const move = /^(?:pasa|pasar|pasame|move|mover|mov[eé]|corre|correr|cambia|cambiar|reprograma|reprogramar)\b(.+?)\s+a\s+(.+)$/.exec(said);
  if (move) {
    const destSaid = move[2].trim();
    const dest = parseMoveTarget(destSaid, { now, timeZone })
      || parseMoveTarget(`a ${destSaid}`, { now, timeZone });
    if (!dest) return null;
    return { action: 'move', match: matchFromPart(move[1]), at: dest, destSaid };
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

// The direct parser above needs the reminder word first ("recordame en 3 minutos"). Phrasings
// like "en 3 minutos recordame X" reach the model; this notices them so a reply cannot promise a
// reminder that was never tagged, without adding a second LLM round.
function readsAsReminderRequest(text) {
  const said = normalizeCommandText(text);
  if (!said) return false;
  if (!/\b(?:recordatorios?|recordame|recorda|avisame|avisa|timer|temporizador|alarma)\b/.test(said)) return false;
  return /\b(?:en|dentro de|a las|manana|hoy)\b|\b(?:minutos?|mins?|horas?)\b/.test(said);
}

function promisesReminder(text) {
  return /\b(?:listo|hecho|agend\w*|program\w*|te aviso|avisar[eé]|te recuerdo|recordar[eé]|qued[oó])/i
    .test(String(text || ''));
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
    const item = { id: String(raw?.id || `r${at}-${++seq}`), at, text };
    const eventAt = Number(raw?.eventAt);
    const noticeMin = Number(raw?.noticeMin);
    if (Number.isFinite(eventAt) && eventAt > at) item.eventAt = eventAt;
    if (Number.isFinite(noticeMin) && noticeMin > 0) item.noticeMin = noticeMin;
    return item;
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

  function add({ at, text, eventAt, noticeMin }) {
    const item = clean({ id: `r${now()}-${++seq}`, at, text, eventAt, noticeMin });
    if (!item) return null;
    items = [...items, item];
    save();
    return item;
  }

  function update(id, patch = {}) {
    const target = items.find((item) => item.id === String(id || ''));
    if (!target) return null;
    const next = clean({
      ...target,
      at: patch.at != null ? patch.at : target.at,
      text: patch.text != null ? patch.text : target.text,
      eventAt: patch.eventAt != null ? patch.eventAt : target.eventAt,
      noticeMin: patch.noticeMin != null ? patch.noticeMin : target.noticeMin,
    });
    if (!next) return null;
    next.id = target.id;
    items = items.map((item) => (item.id === target.id ? next : item));
    save();
    return next;
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

  function remove(id) {
    const target = items.find((item) => item.id === String(id || ''));
    if (!target) return null;
    items = items.filter((item) => item.id !== target.id);
    save();
    return target;
  }

  function matches(match, opts = {}) {
    return findMatches(list(), match, { now: now(), ...opts });
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

  return {
    start, stop, add, update, remove, list, cancelAll, cancelOne, matches, missedCount, tick, read,
  };
}

module.exports = {
  CHECK_MS, DEFAULT_NOTICE_MIN, parseReminderCommand, parseNoticeMinutes, resolveFireAt,
  parseMoveTarget, findMatches, formatWhen, deliverReminder, createReminders,
  readsAsReminderRequest, promisesReminder, durationText,
};
