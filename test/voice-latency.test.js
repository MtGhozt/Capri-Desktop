'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('a reply with her voice loaded skips the VRAM probe (it stalls 3-8 s with LM Studio off)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'voice', 'server.py'), 'utf8');
  const body = src.slice(src.indexOf('def _bind_session_tts'), src.indexOf('def _warn_low_vram'));
  const early = body.indexOf('if reason == "omnivoice":');
  assert.ok(early > 0);
  assert.ok(early < body.indexOf('self._vram_budget()'));
  assert.match(body.slice(early, body.indexOf('self._vram_budget()')), /return\n/);
});
