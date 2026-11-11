'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatTimingLine, createTurnTiming } = require('../src/main/timing');

test('summary line keeps present stages and drops the ones that did not happen', () => {
  const full = formatTimingLine({
    id: 12,
    src: 'voice',
    stt: 640.4,
    send: 30,
    llmFirst: 820,
    llmFull: 2100,
    ttsFirst: 950,
    engine: 'omnivoice-cuda',
    synth: 1100,
    play: 40,
    total: 4600,
    provider: 'gemini',
    model: 'gemini-flash-lite-latest',
  });
  assert.equal(
    full,
    '[timing] turn=12 src=voice stt=640 send=30 llm_first=820 llm_full=2100 tts_first=950 (omnivoice-cuda) synth=1100 play=40 total=4600 provider=gemini/gemini-flash-lite-latest',
  );

  const direct = formatTimingLine({
    id: 3,
    src: 'text',
    ttsFirst: 100,
    engine: 'kokoro',
    synth: 400,
    play: 15,
    total: 180,
  });
  assert.equal(direct, '[timing] turn=3 src=text tts_first=100 (kokoro) synth=400 play=15 total=180');
  assert.doesNotMatch(direct, /stt=|send=|llm_|provider=/);
});

test('summary line never includes the user text, the reply, or a key', () => {
  const line = formatTimingLine({
    id: 1,
    src: 'text',
    send: 5,
    text: 'hola choom pon música',
    reply: 'listo, ya va',
    user: 'sk-abcdefghijklmnopqrstuvwxyz',
    key: 'AIzaSyD-abcdefghijklmnop',
    token: 'Bearer abcdefghijklmnop',
    engine: 'omnivoice and the user said hola',
    provider: 'gemini flash lite',
    model: 'not a model name',
  });
  assert.equal(line, '[timing] turn=1 src=text send=5');
  assert.doesNotMatch(line, /hola|choom|música|listo|sk-|AIza|Bearer|abcdefgh/);
});

test('collector logs one line when the turn settles and skips stages it never saw', () => {
  let clock = 1000;
  const lines = [];
  const turns = createTurnTiming({
    log: (line) => lines.push(line),
    now: () => clock,
  });
  const id = turns.begin('text');
  clock = 1040;
  turns.noteSend(id);
  turns.expectAudio(id);
  turns.noteLlm(id, {
    llmFirst: 820,
    llmFull: 2100,
    provider: 'gemini',
    model: 'gemini-flash-lite-latest',
    text: 'this reply must not be logged',
  });
  assert.equal(lines.length, 0);
  clock = 5200;
  turns.noteAudio(id, { ttsFirst: 950, engine: 'omnivoice-cuda', play: 40, synth: 400 }, { done: false });
  turns.noteAudio(id, { synth: 1100, text: 'pon música' }, { done: true });
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    '[timing] turn=1 src=text send=40 llm_first=820 llm_full=2100 tts_first=950 (omnivoice-cuda) synth=1100 play=40 total=4200 provider=gemini/gemini-flash-lite-latest',
  );
  assert.doesNotMatch(lines[0], /reply|música|this /);

  const voice = turns.begin('voice', 12);
  turns.expectAudio(voice);
  turns.noteNoLlm(voice);
  assert.equal(lines.length, 1);
  turns.noteAudio(voice, { stt: 640, total: 700 }, { done: true });
  assert.equal(lines[1], '[timing] turn=12 src=voice stt=640 total=700');
  assert.doesNotMatch(lines[1], /llm_|tts_|send=/);
});
