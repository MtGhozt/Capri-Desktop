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

function withTurn(msg, turnId) {
  const turn = Math.round(Number(turnId));
  if (turn > 0) msg.turn = turn;
  return msg;
}

function createSpeakQueue({ send }) {
  let buf = '';
  let live = 0;
  let nextId = 0;
  let held = '';
  let mood = null;
  let turn = 0;

  function emit(text) {
    const line = String(text || '').trim();
    if (!line || !live) return;
    if (line.length < SHORT) {
      held = held ? `${held} ${line}` : line;
      return;
    }
    const out = held ? `${held} ${line}` : line;
    held = '';
    send(withTurn({ type: 'speak', text: out, id: live, mood: mood || undefined }, turn));
  }

  function feed(piece) {
    if (!live) return;
    buf += piece || '';
    const { sentences, rest } = pullSentences(buf);
    buf = rest;
    for (const sentence of sentences) emit(sentence);
  }

  function start(turnId) {
    nextId += 1;
    live = nextId;
    buf = '';
    held = '';
    mood = null;
    turn = Math.round(Number(turnId)) || 0;
    send(withTurn({ type: 'speak_start', id: live }, turn));
    return live;
  }

  function setMood(name) {
    mood = name || null;
  }

  function flush(id) {
    const target = Number(id) || live;
    const msgTurn = turn;
    if (live && (!target || live === target)) {
      const rest = buf.trim();
      buf = '';
      const out = [held, rest].filter(Boolean).join(' ');
      held = '';
      if (out) send(withTurn({ type: 'speak', text: out, id: target, mood: mood || undefined }, msgTurn));
      live = 0;
      turn = 0;
    }
    send(withTurn({ type: 'speak_flush', id: target || 0 }, msgTurn));
  }

  function stop(id) {
    const target = Number(id) || live;
    const msgTurn = turn;
    if (live && (!target || live === target)) {
      live = 0;
      buf = '';
      held = '';
      mood = null;
      turn = 0;
    }
    send(withTurn({ type: 'stop_speak', id: target || 0 }, msgTurn));
  }

  return { start, feed, flush, stop, setMood };
}

module.exports = { createSpeakQueue, pullSentences, packPhrases, SHORT };
