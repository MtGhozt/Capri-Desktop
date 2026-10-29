'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, migratePublicReply } = require('../src/main/config');

test('fresh defaults are blips with TTS off', () => {
  assert.equal(DEFAULTS.voice.replyMode, 'blips');
  assert.equal(DEFAULTS.voice.tts, 'off');
});

test('old baked-in voice+auto without a clone migrates to blips', () => {
  const { voice, changed } = migratePublicReply({ replyMode: 'voice', tts: 'auto' });
  assert.equal(changed, true);
  assert.equal(voice.replyMode, 'blips');
  assert.equal(voice.tts, 'off');
  assert.equal(voice.publicReplyMigrated, true);
});

test('explicit clone setup (ttsRef or dir) is left on voice', () => {
  const withRef = migratePublicReply({
    replyMode: 'voice', tts: 'auto', ttsRef: 'ref/capri_ref3.wav',
  });
  assert.equal(withRef.voice.replyMode, 'voice');
  assert.equal(withRef.voice.tts, 'auto');
  assert.equal(withRef.voice.publicReplyMigrated, true);

  const withDir = migratePublicReply({
    replyMode: 'voice', tts: 'auto', dir: 'C:\\somewhere\\voice',
  });
  assert.equal(withDir.voice.replyMode, 'voice');
});

test('already-migrated or intentional blips/silent are not rewritten', () => {
  const again = migratePublicReply({
    replyMode: 'voice', tts: 'auto', publicReplyMigrated: true,
  });
  assert.equal(again.changed, false);
  assert.equal(again.voice.replyMode, 'voice');

  const blips = migratePublicReply({ replyMode: 'blips', tts: 'off' });
  assert.equal(blips.voice.replyMode, 'blips');
  assert.equal(blips.changed, true); // flag stamped once
});
