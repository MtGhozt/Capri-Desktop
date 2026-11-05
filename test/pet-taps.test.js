'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('pet taps: 3 within 1.2s → annoyed, then resets', async () => {
  const { createPetTaps, shouldPlayPetPurr } = await import('../src/renderer/js/pet-taps.js');
  const taps = createPetTaps({ windowMs: 1200, limit: 3 });
  const t0 = 1_000_000;
  assert.equal(taps.tap(t0), 'pet');
  assert.equal(taps.tap(t0 + 400), 'pet');
  assert.equal(taps.tap(t0 + 800), 'annoyed');
  assert.equal(taps.tap(t0 + 900), 'pet'); // counter reset
  assert.equal(taps.tap(t0 + 2500), 'pet'); // old taps aged out
  assert.equal(taps.tap(t0 + 2600), 'pet');
  assert.equal(taps.tap(t0 + 2700), 'annoyed');
  assert.equal(shouldPlayPetPurr({ muted: true, replyMode: 'blips' }), false);
  assert.equal(shouldPlayPetPurr({ muted: false, replyMode: 'silent' }), false);
  assert.equal(shouldPlayPetPurr({ muted: false, replyMode: 'blips' }), true);
});

test('onCaress plays purr through the existing voice path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');
  assert.match(source, /shouldPlayPetPurr/);
  assert.match(source, /voice\.play\('purr'\)/);
  assert.match(source, /petTaps\.tap\(\)/);
  const voice = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'voice.js'), 'utf8');
  assert.match(voice, /purr:\s*\(\)\s*=>\s*this\.purr\(\)/);
});
