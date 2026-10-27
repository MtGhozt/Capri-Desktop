'use strict';

// Her hello at boot: four lines, picked at random, never the one from last boot.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GREETINGS, pickGreeting } = require('../src/main/greetings.js');

test('the four greetings exist once each', () => {
  assert.equal(GREETINGS.length, 4);
  const ids = GREETINGS.map((item) => item.id);
  assert.deepEqual(ids, ['greet-1', 'greet-2', 'greet-3', 'greet-4']);
  for (const item of GREETINGS) assert.ok(item.text.trim().length > 0);
});

test('the last greeting is never repeated', () => {
  for (const last of GREETINGS.map((item) => item.id)) {
    for (let i = 0; i < 50; i += 1) {
      assert.notEqual(pickGreeting({ last }).id, last);
    }
  }
});

test('an unknown last value leaves every greeting available', () => {
  assert.equal(pickGreeting({ last: null, random: () => 0 }), GREETINGS[0]);
  assert.equal(pickGreeting({ last: 'greet-9', random: () => 0.999 }), GREETINGS[3]);
});

test('random at the edges stays inside the list', () => {
  assert.equal(pickGreeting({ random: () => 0 }).id, 'greet-1');
  assert.equal(pickGreeting({ random: () => 1 }).id, 'greet-4');
  // excluding the last one leaves three: 1 is clamped to the third
  assert.equal(pickGreeting({ last: 'greet-4', random: () => 1 }).id, 'greet-3');
});
