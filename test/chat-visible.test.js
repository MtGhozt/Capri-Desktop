'use strict';

// Ctrl+Alt+T flips what is on screen: the bubble reports its real state, so an auto-open
// (wake word, agent, greeting) no longer leaves the toggle thinking the chat is closed, and an
// auto-hide (idle fold, sleep, Esc) no longer leaves it thinking the chat is open.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChatVisible } = require('../src/main/chat-visible');

function setup() {
  const lines = [];
  const chat = createChatVisible({ log: (line) => lines.push(line) });
  // main's toggleChat: one press flips whatever is really visible
  const press = () => {
    if (chat.get()) chat.set(false, 'shortcut');
    else chat.set(true, 'shortcut');
  };
  return { chat, lines, press };
}

test('auto-open, then one press closes it', () => {
  const { chat, lines, press } = setup();
  chat.set(true, 'wake'); // the bubble opened by itself after "Hey Capri"
  assert.equal(chat.get(), true);
  press();
  assert.equal(chat.get(), false); // the first press closed it, not a no-op "open"
  assert.deepEqual(lines, [
    'chat toggle visible=false->true source=wake',
    'chat toggle visible=true->false source=shortcut',
  ]);
});

test('auto-hide (idle fold / sleep), then one press opens it', () => {
  const { chat, lines, press } = setup();
  chat.set(true, 'wake');
  chat.set(false, 'fold'); // she folded and the bubble went with her
  press();
  assert.equal(chat.get(), true);
  assert.equal(lines.at(-1), 'chat toggle visible=false->true source=shortcut');
});

test('a repeated state is not logged twice', () => {
  const { chat, lines } = setup();
  chat.set(false, 'overlay');
  chat.set(true, 'wake');
  chat.set(true, 'wake'); // the renderer's report after main already opened it
  assert.deepEqual(lines, ['chat toggle visible=false->true source=wake']);
});
