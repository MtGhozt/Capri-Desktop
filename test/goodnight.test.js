'use strict';

// She says goodnight first, and only then folds (src/main/goodnight.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGoodnight, readMs } = require('../src/main/goodnight');

function setup() {
  const steps = [];
  const timers = new Map();
  let next = 1;
  let now = 0;
  const gn = createGoodnight({
    fold: () => steps.push(`fold@${now}`),
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    startMs: 6000,
    talkMs: 6000,
  });
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  };
  const voice = (type, extra = {}) => { steps.push(type); gn.onVoiceEvent({ type, ...extra }); };
  return { gn, steps, advance, voice };
}

test('spoken: the fold waits for her line to start and end, even past the old 2.2 s', () => {
  const { gn, steps, advance, voice } = setup();
  gn.start({ spoken: true, line: 'Buenas noches, humanito.' });
  advance(2500); // OmniVoice still synthesizing
  assert.deepEqual(steps, []);
  voice('talking');
  advance(1800);
  assert.deepEqual(steps, ['talking']);
  voice('talking_done', { interrupted: false });
  assert.deepEqual(steps, ['talking', 'talking_done', 'fold@4300']);
  assert.equal(gn.pending, false);
  advance(20000);
  assert.equal(steps.filter((s) => s.startsWith('fold')).length, 1);
});

test('a reply cut off by her goodnight does not fold her before she says it', () => {
  const { gn, steps, voice } = setup();
  gn.start({ spoken: true, line: 'Me voy a dormir.' });
  voice('talking_done', { interrupted: true }); // the reply she was saying
  assert.equal(gn.pending, true);
  voice('talking_done', { interrupted: false }); // an older reply finishing on its own
  assert.equal(gn.pending, true);
  voice('talking');
  voice('talking_done', { interrupted: false });
  assert.deepEqual(steps.at(-1), 'fold@0');
});

test('safety: no voice at all folds after 6 s; a line that never ends, 6 s after it starts', () => {
  let s = setup();
  s.gn.start({ spoken: true });
  s.advance(5999);
  assert.deepEqual(s.steps, []);
  s.advance(1);
  assert.deepEqual(s.steps, ['fold@6000']);

  s = setup();
  s.gn.start({ spoken: true });
  s.advance(4000);
  s.voice('talking');
  s.advance(5999);
  assert.deepEqual(s.steps, ['talking']);
  s.advance(1);
  assert.deepEqual(s.steps, ['talking', 'fold@10000']);
});

test('her line dropped by the sidecar, or the sidecar gone: fold right away', () => {
  let s = setup();
  s.gn.start({ spoken: true });
  s.voice('talking_done', { skipped: true });
  assert.deepEqual(s.steps, ['talking_done', 'fold@0']);
  s = setup();
  s.gn.start({ spoken: true });
  s.voice('stopped');
  assert.deepEqual(s.steps, ['stopped', 'fold@0']);
});

test('blips or silent: the fold waits as long as the line takes to read', () => {
  const { gn, steps, advance, voice } = setup();
  const line = 'Me voy a dormir. No hagas ruido, humanito.';
  gn.start({ spoken: false, line });
  voice('talking_done', { skipped: true }); // not hers: she did not speak
  advance(readMs(line) - 1);
  assert.deepEqual(steps, ['talking_done']);
  advance(1);
  assert.equal(steps.at(-1), `fold@${readMs(line)}`);
  assert.ok(readMs('') >= 1500 && readMs('x'.repeat(500)) === 6000);
});

test('woken up before the line is over: no fold', () => {
  const { gn, steps, advance, voice } = setup();
  gn.start({ spoken: true });
  voice('talking');
  gn.cancel();
  voice('talking_done', { interrupted: false });
  advance(20000);
  assert.deepEqual(steps, ['talking', 'talking_done']);
});
