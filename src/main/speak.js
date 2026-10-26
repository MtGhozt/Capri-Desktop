'use strict';

const BREAK = /(?<!\d)[.!?…]+(?:["»”')\]]+)?(?:\s+|$)|[\n\r]+/g;
const LONG = 180;

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

function createSpeakQueue({ send }) {
  let buf = '';
  let live = 0;
  let nextId = 0;

  function emit(text) {
    const line = String(text || '').trim();
    if (!line || !live) return;
    send({ type: 'speak', text: line, id: live });
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
    send({ type: 'speak_start', id: live });
    return live;
  }

  function flush(id) {
    const target = Number(id) || live;
    if (live && (!target || live === target)) {
      const rest = buf.trim();
      buf = '';
      live = 0;
      if (rest) send({ type: 'speak', text: rest, id: target });
    }
    send({ type: 'speak_flush', id: target || 0 });
  }

  function stop(id) {
    const target = Number(id) || live;
    if (live && (!target || live === target)) {
      live = 0;
      buf = '';
    }
    send({ type: 'stop_speak', id: target || 0 });
  }

  return { start, feed, flush, stop };
}

module.exports = { createSpeakQueue, pullSentences };
