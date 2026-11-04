'use strict';

// Ajustes "?" panels: every button that shows one has steps, and only one panel is open at a time.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HELP_STEPS, toggleHelp, splitHelpText } = require('../src/renderer/js/help-steps.js');

test('each help id has a title and steps', () => {
  assert.deepEqual(Object.keys(HELP_STEPS).sort(), ['brain', 'gaming', 'hearing', 'spotify', 'voice', 'wake']);
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

test('splitHelpText turns http(s) into url parts (clickable in the panel)', () => {
  const parts = splitHelpText('Abrí https://aistudio.google.com/apikey y listo.');
  assert.deepEqual(parts, [
    { type: 'text', value: 'Abrí ' },
    { type: 'url', value: 'https://aistudio.google.com/apikey' },
    { type: 'text', value: ' y listo.' },
  ]);
  assert.deepEqual(splitHelpText('sin links'), [{ type: 'text', value: 'sin links' }]);
  // Trailing punctuation is not part of the URL
  assert.equal(
    splitHelpText('mirá https://discord.gg/wmVfYdjpdA.').find((p) => p.type === 'url').value,
    'https://discord.gg/wmVfYdjpdA',
  );
});

test('manual help covers voice install, clone, config path, Spotify and Gemini', () => {
  const all = Object.values(HELP_STEPS).flatMap((h) => [
    h.note || '',
    ...h.steps.map((s) => (typeof s === 'string' ? s : `${s.text}\n${s.command}`)),
  ]).join('\n');
  assert.match(all, /python\.org\/downloads\/release\/python-3119/);
  assert.match(all, /Add python\.exe to PATH|Add to PATH/i);
  assert.match(all, /powershell/i);
  assert.match(all, /setup\.ps1 -OmniVoice/);
  assert.match(all, /cargando voz/);
  assert.match(all, /Usar mi propia voz/);
  assert.match(all, /ttsMoods/);
  assert.match(all, /%APPDATA%\\capri-desktop/);
  assert.match(all, /#errores-bugs/);
  assert.match(all, /developer\.spotify\.com/);
  assert.match(all, /127\.0\.0\.1:47835\/callback/);
  assert.match(all, /aistudio\.google\.com/);
  assert.match(all, /Microsoft Visual C\+\+ Redistributable \(x64\)/);
  assert.match(all, /vc_redist\.x64\.exe/);
});
