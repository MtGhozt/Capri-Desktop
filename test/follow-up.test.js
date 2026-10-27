'use strict';

// Follow-up listening (src/main/follow-up.js, Paso 4B).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFollowUp, endsWithQuestion, readMs } = require('../src/main/follow-up');

test('her line ends with a question', () => {
  for (const line of [
    '¿Y eso a mí qué, humanito?',
    'Ya lo guardé. ¿Algo más?',
    '¿Seguro? 😏',
    '«¿De verdad?»',
    'Bueno, ¿sí?',
    'Lo abro ya, ¿no?',
    'Vale... ¿qué quieres oír?  ',
    'What now?',
  ]) assert.equal(endsWithQuestion(line), true, line);
  for (const line of [
    'Listo, humanito.',
    '¿Sí? Pues no.',
    '¿Para qué? Ya está guardado.',
    'Me preguntaste "¿por qué?" y no sé.',
    '',
    null,
    '¿',
    'Buenas noches.',
  ]) assert.equal(endsWithQuestion(line), false, String(line));
});

function setup({ secs = 8, can = true, ...opts } = {}) {
  const opened = [];
  const timers = new Map();
  let next = 1;
  let clock = 0;
  const state = { secs, can };
  const fu = createFollowUp({
    seconds: () => state.secs,
    canListen: () => state.can,
    open: (s) => opened.push({ s, at: clock }),
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, at: clock + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    now: () => clock,
    ...opts,
  });
  const advance = (ms) => {
    const until = clock + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].fn();
    }
    clock = until;
  };
  const voice = (type, extra = {}) => fu.onVoiceEvent({ type, ...extra });
  // you say something, she answers aloud, her voice plays for `talk` ms
  const turn = (answer, { followUp = false, talk = 1500 } = {}) => {
    fu.heard({ followUp });
    fu.reply(answer, { spoken: true });
    voice('talking');
    advance(talk);
    voice('talking_done', { interrupted: false });
    advance(300); // the gap: her window opens (or not)
  };
  return { fu, opened, advance, voice, turn, state };
}

test('opens only after her voice is done, plus a short gap', () => {
  const { fu, opened, advance, voice } = setup();
  fu.heard();
  assert.equal(fu.reply('¿Qué quieres, humanito?', { spoken: true }), true);
  advance(3000); // still synthesizing
  voice('talking');
  advance(2000);
  assert.deepEqual(opened, []);
  voice('talking_done', { interrupted: false });
  advance(249);
  assert.deepEqual(opened, []);
  advance(1);
  assert.deepEqual(opened, [{ s: 8, at: 5250 }]);
});

test('no question, no window; nor for lines you did not ask for', () => {
  const s = setup();
  s.turn('Listo.');
  s.advance(10_000);
  assert.deepEqual(s.opened, []);
  // a line with no voice turn before it (menu, tray, her own comments)
  s.fu.reply('¿Me extrañaste?', { spoken: true });
  s.voice('talking');
  s.voice('talking_done', { interrupted: false });
  s.advance(1000);
  assert.deepEqual(s.opened, []);
});

test('interrupted, or her voice never starts: no window', () => {
  let s = setup();
  s.fu.heard();
  s.fu.reply('¿Y bien?', { spoken: true });
  s.voice('talking');
  s.voice('talking_done', { interrupted: true });
  s.advance(10_000);
  assert.deepEqual(s.opened, []);
  s = setup();
  s.fu.heard();
  s.fu.reply('¿Y bien?', { spoken: true });
  s.advance(9000);
  s.voice('talking_done', { interrupted: false }); // too late, and never talked
  s.advance(1000);
  assert.deepEqual(s.opened, []);
});

test('you call her yourself before the window: no window on top', () => {
  const s = setup();
  s.fu.heard();
  s.fu.reply('¿Y bien?', { spoken: true });
  s.voice('talking');
  s.voice('listening', { followUp: false }); // wake word / hotkey
  s.voice('talking_done', { interrupted: true });
  s.advance(1000);
  assert.deepEqual(s.opened, []);
});

test('blips or silent: opens once the line has had time to be read', () => {
  const s = setup();
  const line = '¿Lo guardo o no?';
  s.fu.heard();
  s.fu.reply(line, { spoken: false });
  s.advance(readMs(line) + 249);
  assert.deepEqual(s.opened, []);
  s.advance(1);
  assert.equal(s.opened.length, 1);
});

test('at most 3 windows in a row; your wake word starts a new chain', () => {
  const s = setup();
  s.turn('¿Uno?');
  s.turn('¿Dos?', { followUp: true });
  s.turn('¿Tres?', { followUp: true });
  s.advance(300);
  assert.equal(s.opened.length, 3);
  s.turn('¿Cuatro?', { followUp: true });
  s.advance(1000);
  assert.equal(s.opened.length, 3);
  s.turn('¿Otra vez?'); // wake word again
  s.advance(300);
  assert.equal(s.opened.length, 4);
});

test('never while muted, DORMANT, in a game (canListen) or with followUpSec 0', () => {
  let s = setup({ can: false });
  s.turn('¿Qué?');
  s.advance(1000);
  assert.deepEqual(s.opened, []);
  s = setup({ secs: 0 });
  s.turn('¿Qué?');
  s.advance(1000);
  assert.deepEqual(s.opened, []);
  // muted / folded between her question and the end of her voice
  s = setup();
  s.fu.heard();
  s.fu.reply('¿Qué?', { spoken: true });
  s.voice('talking');
  s.state.can = false;
  s.voice('talking_done', { interrupted: false });
  s.advance(1000);
  assert.deepEqual(s.opened, []);
});

test('cancel drops a window that was on its way', () => {
  const s = setup();
  s.fu.heard();
  s.fu.reply('¿Qué?', { spoken: true });
  s.voice('talking');
  s.voice('talking_done', { interrupted: false });
  s.fu.cancel();
  s.advance(1000);
  assert.deepEqual(s.opened, []);
});
