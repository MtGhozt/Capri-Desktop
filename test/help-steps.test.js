'use strict';

// Ajustes "?" panels: every button that shows one has steps, and only one panel is open at a time.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HELP_STEPS, toggleHelp } = require('../src/renderer/js/help-steps.js');

test('each help id has a title and steps', () => {
  assert.deepEqual(Object.keys(HELP_STEPS).sort(), ['brain', 'hearing', 'spotify', 'voice']);
  for (const [id, help] of Object.entries(HELP_STEPS)) {
    assert.ok(help.title, id);
    assert.ok(help.section, id); // which Ajustes tab shows it
    assert.ok(Array.isArray(help.steps) && help.steps.length > 0, id);
    for (const step of help.steps) {
      assert.ok(typeof step === 'string' || (step.text && step.command), id);
    }
  }
});

test('opening one help panel closes the other', () => {
  assert.equal(toggleHelp(null, 'spotify'), 'spotify');
  assert.equal(toggleHelp('spotify', 'brain'), 'brain');
  assert.equal(toggleHelp('brain', 'brain'), null); // the same "?" closes it
});
