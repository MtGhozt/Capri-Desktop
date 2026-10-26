'use strict';

const BREAK = /(?<!\d)[.!?…]+(?:["»”')\]]+)?(?:\s+|$)|[\n\r]+/g;
const LONG = 180;
const SHORT = 20;

function pullSentences(buf) {
  const sentences = [];
  let last = 0;
  BREAK.lastIndex = 0;
  let match;
  while ((match = BREAK.exec(buf))) {
    const end = match.index + match[0].length;
    const piece = buf.slice(last, end).trim();
    if (piece) sentences.push(piece);
    last = end;
  }
  let rest = buf.slice(last);
  if (rest.length >= LONG) {
    const cut = Math.max(rest.lastIndexOf(', '), rest.lastIndexOf(' '), rest.lastIndexOf(' '));
    if (cut >= 40) {
      sentences.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1);
    }
  }
  return { sentences, rest };
}

function packPhrases(lines, flush = false) {
  const out = [];
  let hold = '';
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    if (line.length < SHORT) {
      hold = hold ? `${hold} ${line}` : line;
      continue;
    }
    out.push(hold ? `${hold} ${line}` : line);
    hold = '';
  }
  if (flush && hold) out.push(hold);
  else if (!flush) out.hold = hold;
  return out;
}

function createSpeakQueue({ send }) {
  let buf = '';
  let live = 0;
  let nextId = 0;
  let held = '';

  function emit(text) {
    const line = String(text || '').trim();
    if (!line || !live) return;
    if (line.length < SHORT) {
      held = held ? `${held} ${line}` : line;
      return;
    }
    const out = held ? `${held} ${line}` : line;
    held = '';
    send({ type: 'speak', text: out, id: live });
  }

  function feed(piece) {
    if (!live) return;
    buf += piece || '';
    const { sentences, rest } = pullSentences(buf);
    buf = rest;
    for (const sentence of sentences) emit(sentence);
  }

  function start() {
    nextId += 1;
    live = nextId;
    buf = '';
    held = '';
    send({ type: 'speak_start', id: live });
    return live;
  }

  function flush(id) {
    const target = Number(id) || live;
    if (live && (!target || live === target)) {
      const rest = buf.trim();
      buf = '';
      const out = [held, rest].filter(Boolean).join(' ');
      held = '';
      if (out) send({ type: 'speak', text: out, id: target });
      live = 0;
    }
    send({ type: 'speak_flush', id: target || 0 });
  }

  function stop(id) {
    const target = Number(id) || live;
    if (live && (!target || live === target)) {
      live = 0;
      buf = '';
      held = '';
    }
    send({ type: 'stop_speak', id: target || 0 });
  }

  return { start, feed, flush, stop };
}

module.exports = { createSpeakQueue, pullSentences, packPhrases, SHORT };
