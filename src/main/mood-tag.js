'use strict';

// Hidden leading reply tags: a mood picks the TTS ref, an action opens an app, plays music or
// runs one of her own closed-list actions. [calm] is kept as an alias for [seria].

const MOODS = ['burla', 'emocion', 'aburrida', 'seria'];
const ALIAS = { calm: 'seria' };
const TAG = /^\s*\[(burla|emocion|aburrida|seria|calm)\]\s*/i;
// The whole closed list of things a reply may do. A bare tag takes no value; mic and music take
// one from their own list. Anything else is text and never runs.
const ACTION_KINDS = [
  'open', 'play', 'sleep', 'wake', 'minimize', 'lock', 'mic', 'forget', 'clip', 'quit', 'music', 'remind',
];
const PLAIN_ACTIONS = new Set(['sleep', 'wake', 'minimize', 'lock', 'forget', 'clip', 'quit']);
const MIC_VALUES = ['on', 'off'];
const MUSIC_VALUES = ['pause', 'play', 'next', 'previous', 'up', 'down', 'mute', 'unmute', 'nowplaying', 'open', 'start'];
const TAG_NAMES = [...new Set([...MOODS, ...Object.keys(ALIAS), ...ACTION_KINDS])];

// Told to her in the system prompt: the same closed list the parser accepts, built here so the
// two can't drift.
const ACTION_TAG_HELP = [
  'Tus únicas acciones sobre la PC son etiquetas ocultas al inicio de tu respuesta (nunca las menciones):',
  '[sleep], [wake], [minimize], [lock], [mic:on], [mic:off], [forget], [clip], [quit],',
  '[open:<app>], [play:<canción>] o [play:hersong],',
  `[music:${MUSIC_VALUES.join('|')}].`,
  'Para un recordatorio o una alarma usá [remind:<fecha y hora ISO 8601 en la zona local que te dije>|<texto corto>],',
  'por ejemplo [remind:2026-11-08T07:00:00-06:00|tengo un evento]. Las horas relativas ("en media hora",',
  '"mañana a las 8") calculalas desde la hora local de arriba. Al confirmar, repetí siempre la hora local resuelta.',
  'Solo esas se ejecutan; cualquier otra cosa es texto normal.',
  'Nunca digas que ponés, abrís, cerrás o hacés algo si no incluiste la etiqueta correspondiente: sin etiqueta no pasó nada. Si no podés emitirla, no lo prometas.',
].join(' ');

function normalizeMood(name) {
  const key = String(name || '').toLowerCase();
  if (ALIAS[key]) return ALIAS[key];
  return MOODS.includes(key) ? key : null;
}

function stripMoodTag(text) {
  const raw = String(text || '');
  const m = TAG.exec(raw);
  if (!m) return { text: raw, mood: null };
  return { text: raw.slice(m[0].length), mood: normalizeMood(m[1]) };
}

function parseAction(name, value) {
  const kind = String(name || '').toLowerCase();
  const text = String(value || '').trim();
  if (!ACTION_KINDS.includes(kind)) return null;
  if (kind === 'open' || kind === 'play') {
    if (!text) return null;
    if (kind === 'play' && text.toLowerCase() === 'hersong') return { kind, value: 'hersong', herSong: true };
    return { kind, value: text };
  }
  if (PLAIN_ACTIONS.has(kind)) return text ? null : { kind, value: '' };
  if (kind === 'remind') {
    const bar = text.indexOf('|');
    if (bar < 0) return null;
    const at = Date.parse(text.slice(0, bar).trim());
    const what = text.slice(bar + 1).trim().slice(0, 200);
    return Number.isFinite(at) && what ? { kind, value: what, at: new Date(at).toISOString() } : null;
  }
  const allowed = kind === 'mic' ? MIC_VALUES : MUSIC_VALUES;
  const picked = text.toLowerCase();
  return allowed.includes(picked) ? { kind, value: picked } : null;
}

// [burla] / [open:Discord] / [play:some song] / [sleep] / [music:next]
function parseTag(inner) {
  const raw = String(inner || '');
  const colon = raw.indexOf(':');
  if (colon < 0) {
    const mood = normalizeMood(raw.trim());
    if (mood) return { mood };
    const action = parseAction(raw.trim(), '');
    return action ? { action } : null;
  }
  const action = parseAction(raw.slice(0, colon), raw.slice(colon + 1));
  return action ? { action } : null;
}

function stripReplyTags(text) {
  let out = String(text || '');
  let mood = null;
  let action = null;
  for (;;) {
    const m = /^\s*\[([^\]]*)\]\s*/.exec(out);
    if (!m) break;
    const tag = parseTag(m[1]);
    if (!tag) break;
    if (tag.mood && !mood) mood = tag.mood;
    if (tag.action && !action) action = tag.action;
    out = out.slice(m[0].length);
  }
  return { text: out, mood, action };
}

function couldBeTag(inner) {
  const raw = String(inner || '');
  const colon = raw.indexOf(':');
  if (colon >= 0) return ACTION_KINDS.includes(raw.slice(0, colon).trim().toLowerCase());
  const partial = raw.trim().toLowerCase();
  return TAG_NAMES.some((name) => name.startsWith(partial));
}

/** Stream filter: hold the first bytes until we know whether a mood/action tag is there. */
function createMoodStripper({ onText, onMood, onAction } = {}) {
  let buf = '';
  let decided = false;
  let stripped = false;
  let mood = null;
  let action = null;
  let moodTold = false;
  let actionTold = false;

  function tell() {
    if (mood && !moodTold) {
      moodTold = true;
      onMood?.(mood);
    }
    if (action && !actionTold) {
      actionTold = true;
      onAction?.(action);
    }
  }

  function release(piece) {
    tell();
    if (piece) onText?.(piece);
  }

  return {
    get mood() { return mood; },
    get action() { return action; },
    // back-compat for callers that still check .calm
    get calm() { return mood === 'seria'; },
    push(piece) {
      if (decided) {
        release(piece);
        return;
      }
      buf += piece || '';
      for (;;) {
        const lead = buf.match(/^\s*/)?.[0] || '';
        const body = buf.slice(lead.length);
        if (!body) return;
        if (body[0] !== '[') {
          decided = true;
          release(stripped ? body : buf);
          buf = '';
          return;
        }
        const close = body.indexOf(']');
        if (close < 0) {
          if (body.length > 200 || !couldBeTag(body.slice(1))) {
            decided = true;
            release(stripped ? body : buf);
            buf = '';
          }
          return;
        }
        const tag = parseTag(body.slice(1, close));
        if (!tag) {
          decided = true;
          release(stripped ? body : buf);
          buf = '';
          return;
        }
        if (tag.mood && !mood) mood = tag.mood;
        if (tag.action) action = tag.action;
        stripped = true;
        buf = body.slice(close + 1);
      }
    },
    flush() {
      if (!decided && buf) release(stripped ? buf.replace(/^\s+/, '') : buf);
      buf = '';
      decided = true;
      tell();
    },
  };
}

module.exports = {
  MOODS, ACTION_KINDS, ACTION_TAG_HELP, normalizeMood, stripMoodTag, stripReplyTags, createMoodStripper,
};
