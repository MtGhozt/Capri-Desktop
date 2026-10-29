'use strict';

// Hidden leading mood tag on an LLM reply: strip before show/speak, pick that TTS ref.
// [calm] is kept as an alias for [seria].

const MOODS = ['burla', 'emocion', 'aburrida', 'seria'];
const ALIAS = { calm: 'seria' };
const TAG = /^\s*\[(burla|emocion|aburrida|seria|calm)\]\s*/i;

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

/** Stream filter: hold the first bytes until we know whether a mood tag is there. */
function createMoodStripper({ onText, onMood } = {}) {
  let buf = '';
  let decided = false;
  let mood = null;
  let moodTold = false;

  function tellMood() {
    if (mood && !moodTold) {
      moodTold = true;
      onMood?.(mood);
    }
  }

  function release(piece) {
    tellMood();
    if (piece) onText?.(piece);
  }

  return {
    get mood() { return mood; },
    // back-compat for callers that still check .calm
    get calm() { return mood === 'seria'; },
    push(piece) {
      if (decided) {
        release(piece);
        return;
      }
      buf += piece || '';
      const lead = buf.match(/^\s*/)?.[0] || '';
      const body = buf.slice(lead.length);
      if (!body) return;
      if (body[0] !== '[') {
        decided = true;
        release(buf);
        buf = '';
        return;
      }
      const close = body.indexOf(']');
      if (close < 0) {
        if (body.length > 12) {
          decided = true;
          release(buf);
          buf = '';
        }
        return;
      }
      const found = normalizeMood(body.slice(1, close));
      if (found) {
        mood = found;
        decided = true;
        const rest = body.slice(close + 1).replace(/^\s+/, '');
        buf = '';
        release(rest);
        return;
      }
      decided = true;
      release(buf);
      buf = '';
    },
    flush() {
      if (!decided && buf) release(buf);
      buf = '';
      decided = true;
      tellMood();
    },
  };
}

module.exports = { MOODS, normalizeMood, stripMoodTag, createMoodStripper };
