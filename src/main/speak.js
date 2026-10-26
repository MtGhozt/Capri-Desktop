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
  let live = false;

  function emit(text) {
    const line = String(text || '').trim();
    if (!line) return;
    send({ type: 'speak', text: line });
  }

  function feed(piece) {
    if (!live) return;
    buf += piece || '';
    const { sentences, rest } = pullSentences(buf);
    buf = rest;
    for (const sentence of sentences) emit(sentence);
  }

  function start() {
    live = true;
    buf = '';
    send({ type: 'speak_start' });
  }

  function flush() {
    if (!live) {
      send({ type: 'speak_flush' });
      return;
    }
    const rest = buf.trim();
    buf = '';
    live = false;
    if (rest) emit(rest);
    send({ type: 'speak_flush' });
  }

  function stop() {
    live = false;
    buf = '';
    send({ type: 'stop_speak' });
  }

  return { start, feed, flush, stop };
}

module.exports = { createSpeakQueue, pullSentences };
