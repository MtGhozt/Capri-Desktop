'use strict';

// Hidden leading reply tags: a mood picks the TTS ref, an action opens an app or music.
// [calm] is kept as an alias for [seria].

const MOODS = ['burla', 'emocion', 'aburrida', 'seria'];
const ALIAS = { calm: 'seria' };
const TAG = /^\s*\[(burla|emocion|aburrida|seria|calm)\]\s*/i;
const ACTION_KINDS = ['open', 'play'];
const TAG_NAMES = [...new Set([...MOODS, ...Object.keys(ALIAS), ...ACTION_KINDS])];

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
  if (!ACTION_KINDS.includes(kind) || !text) return null;
  if (kind === 'play' && text.toLowerCase() === 'hersong') return { kind, value: 'hersong', herSong: true };
  return { kind, value: text };
}

// [burla] / [open:Discord] / [play:some song]
function parseTag(inner) {
  const raw = String(inner || '');
  const colon = raw.indexOf(':');
  if (colon < 0) {
    const mood = normalizeMood(raw.trim());
    return mood ? { mood } : null;
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

module.exports = { MOODS, normalizeMood, stripMoodTag, stripReplyTags, createMoodStripper };
