'use strict';

// Her own life on the desktop: sporadic lines and one reaction per context change, both
// sharing a cooldown so she never chatters twice in a row.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createComments, DEFAULT_MIN_MS, DEFAULT_MAX_MS } = require('../src/main/comments.js');

function clock() {
  let now = 0;
  let seq = 0;
  const queue = new Map();
  const timers = {
    setTimeout(fn, ms) {
      seq += 1;
      queue.set(seq, { at: now + Math.max(0, Number(ms) || 0), fn });
      return seq;
    },
    clearTimeout(id) {
      queue.delete(id);
    },
  };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let due = null;
      for (const [id, item] of queue) {
        if (item.at <= end && (!due || item.at < due.item.at)) due = { id, item };
      }
      if (!due) break;
      queue.delete(due.id);
      now = Math.max(now, due.item.at);
      due.item.fn();
    }
    now = end;
  }
  return { timers, advance, now: () => now, queued: () => queue.size };
}

// random 0 -> the shortest gap (15 min); random 1 -> the longest (40 min); 0.5 -> 27.5 min
const setup = (options = {}) => {
  const time = clock();
  const lines = [];
  const comments = createComments({
    timers: time.timers,
    now: time.now,
    random: () => 0,
    onLine: (line, kind) => lines.push({ line, kind }),
    ...options,
  });
  return { time, lines, comments };
};

test('a comment arrives after the shortest gap, not before', () => {
  const { time, lines, comments } = setup();
  comments.start();
  time.advance(DEFAULT_MIN_MS - 1);
  assert.equal(lines.length, 0);
  time.advance(1);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'comentar');
  assert.ok(lines[0].line.length > 0);
});

test('the gap follows the configured range', () => {
  const { time, lines, comments } = setup({ random: () => 1 });
  comments.start();
  // random 1 lands one millisecond past the top of the range
  time.advance(DEFAULT_MAX_MS);
  assert.equal(lines.length, 0);
  time.advance(1);
  assert.equal(lines.length, 1);
});

test('one reaction per context change, and only once the cooldown passed', () => {
  const { time, lines, comments } = setup({ random: () => 1 });
  comments.start();
  time.advance(DEFAULT_MIN_MS + 1); // past the cooldown, before the 40 min timer
  comments.observe('musica');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'musica');

  comments.observe('musica');
  comments.observe('juego'); // too soon: the global cooldown is shared
  assert.equal(lines.length, 1);

  time.advance(DEFAULT_MIN_MS);
  comments.observe('juego'); // that change was already used up while she was cooling down
  assert.equal(lines.length, 1);

  comments.observe('video');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].kind, 'video');
});

test('a null context does not count as a change', () => {
  const { time, lines, comments } = setup({ random: () => 1 });
  comments.start();
  time.advance(DEFAULT_MIN_MS + 1);
  comments.observe(null);
  comments.observe(null);
  assert.equal(lines.length, 0);
  comments.observe('video');
  assert.equal(lines.length, 1);
});

test('turned off, she says nothing and arms no timer', () => {
  let on = false;
  const { time, lines, comments } = setup({ enabled: () => on });
  comments.start();
  assert.equal(time.queued(), 0);
  time.advance(DEFAULT_MAX_MS * 3);
  comments.observe('musica');
  assert.equal(lines.length, 0);

  on = true;
  comments.refresh();
  // switched back on hours later: a fresh gap, not a line a second later
  time.advance(DEFAULT_MIN_MS - 1);
  assert.equal(lines.length, 0);
  time.advance(1);
  assert.equal(lines.length, 1);
});

test('turned off while a timer is pending, it is dropped and nothing fires', () => {
  let on = true;
  const { time, lines, comments } = setup({ enabled: () => on });
  comments.start();
  on = false;
  comments.refresh();
  assert.equal(time.queued(), 0);
  time.advance(DEFAULT_MAX_MS * 2);
  assert.equal(lines.length, 0);
});

test('while she cannot talk the timer waits instead of piling up', () => {
  let can = true;
  const { time, lines, comments } = setup({ canSpeak: () => can });
  comments.start();
  can = false;
  time.advance(DEFAULT_MIN_MS);
  assert.equal(lines.length, 0);
  can = true;
  time.advance(DEFAULT_MIN_MS);
  assert.equal(lines.length, 1);
});

test('the range is read from config on every gap', () => {
  let lo = 60_000;
  let hi = 60_000;
  const { time, lines, comments } = setup({ minMs: () => lo, maxMs: () => hi });
  comments.start();
  time.advance(59_999);
  assert.equal(lines.length, 0);
  // the next gap is computed when the line fires: change the range before that
  lo = 120_000;
  hi = 120_000;
  time.advance(1);
  assert.equal(lines.length, 1);

  time.advance(119_999);
  assert.equal(lines.length, 1);
  time.advance(1);
  assert.equal(lines.length, 2);
});

test('stop clears the timer and start sets a fresh cooldown', () => {
  const { time, lines, comments } = setup({ random: () => 1 });
  comments.start();
  comments.observe('musica'); // too soon after start
  assert.equal(lines.length, 0);
  comments.stop();
  time.advance(DEFAULT_MAX_MS * 2);
  assert.equal(lines.length, 0);
  assert.equal(comments.active(), false);

  comments.start();
  time.advance(DEFAULT_MIN_MS + 1);
  comments.observe('juego');
  assert.equal(lines.length, 1);
});

test('active reports whether the switch is on', () => {
  let on = true;
  const { comments } = setup({ enabled: () => on });
  assert.equal(comments.active(), false);
  comments.start();
  assert.equal(comments.active(), true);
  on = false;
  assert.equal(comments.active(), false);
});

test('after two ignored comments she asks for attention once', () => {
  const { lines, comments } = setup({ onIgnored: (line) => lines.push({ line, kind: 'atencion' }) });
  comments.opened();
  comments.missed();
  comments.opened();
  comments.missed();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'atencion');
});

test('comment callback failures are contained and reported', () => {
  const errors = [];
  const { time, comments } = setup({
    pick: () => 'hola',
    onLine: () => { throw new Error('boom'); },
    onError: (err, phase) => errors.push(`${phase}:${err.message}`),
  });
  comments.start();
  time.advance(DEFAULT_MIN_MS);
  assert.deepEqual(errors, ['comment:boom']);
});
