'use strict';

// One [timing] line per user turn. Stages are milliseconds on a monotonic clock.
// Missing stages are omitted. The line is names and numbers only.

const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');

const turnAls = new AsyncLocalStorage();

const STAGE = [
  ['stt', 'stt'],
  ['send', 'send'],
  ['llmFirst', 'llm_first'],
  ['llmFull', 'llm_full'],
  ['ttsFirst', 'tts_first'],
  ['synth', 'synth'],
  ['play', 'play'],
  ['total', 'total'],
];

function ms(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

// provider / model / engine names. Anything with spaces or other characters is dropped
// so a sentence or a pasted secret cannot ride along in the summary.
function safeToken(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 80) return '';
  if (!/^[A-Za-z0-9._:/-]+$/.test(name)) return '';
  return name;
}

function formatTimingLine(turn = {}) {
  const id = ms(turn.id ?? turn.turn);
  const src = turn.src === 'voice' || turn.src === 'text' ? turn.src : '';
  if (id == null || !src) return '';
  const parts = ['[timing]', `turn=${id}`, `src=${src}`];
  for (const [key, label] of STAGE) {
    const value = ms(turn[key]);
    if (value == null) continue;
    if (key === 'ttsFirst') {
      const engine = safeToken(turn.engine);
      parts.push(engine ? `tts_first=${value} (${engine})` : `tts_first=${value}`);
    } else {
      parts.push(`${label}=${value}`);
    }
  }
  const provider = safeToken(turn.provider);
  const model = safeToken(turn.model);
  if (provider && model) parts.push(`provider=${provider}/${model}`);
  else if (provider) parts.push(`provider=${provider}`);
  else if (model) parts.push(`provider=${model}`);
  return parts.join(' ');
}

function currentTurn() {
  const id = turnAls.getStore();
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function enterTurn(id) {
  const turn = Math.round(Number(id));
  if (turn > 0) turnAls.enterWith(turn);
}

function createTurnTiming({ log, now = () => performance.now() } = {}) {
  let seq = 0;
  const rows = new Map();
  const voiceClock = new Map();

  function allocText() {
    // Voice turns use even ids from the sidecar. Text turns stay odd, so the two
    // counters cannot land on the same id.
    seq += seq % 2 === 0 ? 1 : 2;
    return seq;
  }

  function rowOf(id) {
    const turn = Math.round(Number(id));
    if (!(turn > 0)) return null;
    const row = rows.get(turn);
    return row && !row.logged ? row : null;
  }

  function stashVoice(id, stt) {
    const turn = Math.round(Number(id));
    if (!(turn > 0)) return;
    const at = now();
    for (const [key, value] of voiceClock) {
      if (at - value.at > 120000) voiceClock.delete(key);
    }
    const n = Number(stt);
    voiceClock.set(turn, { at, stt: Number.isFinite(n) && n >= 0 ? n : null });
  }

  function begin(src, id, stt) {
    const requested = Math.round(Number(id));
    const voice = src === 'voice' && requested > 0;
    const clock = voice ? voiceClock.get(requested) : null;
    if (voice) voiceClock.delete(requested);
    const turn = voice ? requested : allocText();
    if (turn > seq) seq = turn;
    const row = {
      id: turn,
      src: voice ? 'voice' : 'text',
      t0: clock?.at ?? now(),
      llmSettled: false,
      audioSettled: true,
      logged: false,
    };
    if (clock?.stt != null) row.stt = ms(clock.stt);
    if (row.stt == null) {
      const heard = ms(stt);
      if (heard != null) row.stt = heard;
    }
    rows.set(turn, row);
    return turn;
  }

  function put(row, key, value) {
    if (value == null || value === '') return;
    if (key === 'engine' || key === 'provider' || key === 'model') {
      const token = safeToken(value);
      if (token && row[key] == null) row[key] = token;
      return;
    }
    const n = ms(value);
    if (n == null) return;
    if (key !== 'synth' && row[key] != null) return;
    row[key] = n;
  }

  function maybeLog(row) {
    if (!row || row.logged || !row.llmSettled || !row.audioSettled) return;
    row.logged = true;
    const line = formatTimingLine(row);
    rows.delete(row.id);
    if (line) log?.(line);
  }

  function noteSend(id) {
    const row = rowOf(id);
    if (!row) return;
    put(row, 'send', now() - row.t0);
  }

  function noteLlm(id, outcome = {}) {
    const row = rowOf(id);
    if (!row) return;
    put(row, 'llmFirst', outcome.llmFirst);
    put(row, 'llmFull', outcome.llmFull);
    put(row, 'provider', outcome.provider);
    put(row, 'model', outcome.model);
    row.llmSettled = true;
    maybeLog(row);
  }

  function noteNoLlm(id) {
    const row = rowOf(id);
    if (!row) return;
    row.llmSettled = true;
    maybeLog(row);
  }

  function expectAudio(id) {
    const row = rowOf(id);
    if (!row) return;
    row.audioSettled = false;
  }

  function settleAudio(id) {
    const row = rowOf(id);
    if (!row) return;
    row.audioSettled = true;
    maybeLog(row);
  }

  function noteAudio(id, fields = {}, { done = false } = {}) {
    const row = rowOf(id);
    if (!row) return;
    const next = { ...fields };
    if (row.src !== 'voice' && row.total == null && (ms(next.play) != null || ms(next.ttsFirst) != null)) {
      next.total = now() - row.t0;
    }
    for (const key of ['stt', 'ttsFirst', 'synth', 'play', 'total', 'engine']) {
      put(row, key, next[key]);
    }
    if (done) {
      row.audioSettled = true;
      maybeLog(row);
    }
  }

  function cancel(id) {
    const row = rowOf(id);
    if (!row) return;
    row.llmSettled = true;
    row.audioSettled = true;
    maybeLog(row);
  }

  function cancelAll() {
    for (const row of [...rows.values()]) {
      if (row.logged) continue;
      row.llmSettled = true;
      row.audioSettled = true;
      maybeLog(row);
    }
  }

  return {
    begin, stashVoice, noteSend, noteLlm, noteNoLlm, expectAudio, settleAudio, noteAudio, cancel, cancelAll,
  };
}

function fromSidecar(payload = {}) {
  return {
    stt: payload.stt,
    ttsFirst: payload.tts_first,
    synth: payload.synth,
    play: payload.play,
    total: payload.total,
    engine: payload.engine,
  };
}

module.exports = {
  formatTimingLine, createTurnTiming, currentTurn, enterTurn, fromSidecar,
};
