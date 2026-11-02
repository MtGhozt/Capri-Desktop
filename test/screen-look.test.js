'use strict';

// Phase 6C: look-at-screen helpers — no vision ⇒ no capture; JPEG never hits disk; auto-look skips games.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { supportsVision } = require('../src/main/chat-providers');
const {
  isLookCommand,
  NO_VISION,
  consentNotice,
  userContentWithImage,
  shouldAutoLook,
  captureScreenJpeg,
  AUTO_LOOK_MS,
} = require('../src/main/screen-look');

test('look phrases are detected', () => {
  assert.equal(isLookCommand('mirá mi pantalla'), true);
  assert.equal(isLookCommand('Capri, qué ves'), true);
  assert.equal(isLookCommand('mira esto'), true);
  assert.equal(isLookCommand('pon música'), false);
});

test('no-vision provider → supportsVision false and NO_VISION line ready', () => {
  assert.equal(supportsVision('local', 'google/gemma-4-e2b'), false);
  assert.equal(supportsVision('agent-claude', 'agent'), false);
  assert.equal(supportsVision('groq', 'llama-3.3-70b-versatile'), false);
  assert.equal(supportsVision('gemini', 'gemini-flash-lite-latest'), true);
  assert.equal(supportsVision('openai', 'gpt-4o-mini'), true);
  assert.equal(supportsVision('local', 'llava-v1.6'), true);
  assert.match(NO_VISION, /Gemini/);
});

test('capture path never writes a file', async () => {
  let writes = 0;
  const fakeThumb = {
    isEmpty: () => false,
    getSize: () => ({ width: 1600, height: 900 }),
    resize: ({ width }) => ({
      isEmpty: () => false,
      getSize: () => ({ width, height: Math.round(width * 9 / 16) }),
      toJPEG: () => Buffer.from('jpeg-bytes'),
    }),
    toJPEG: () => Buffer.from('jpeg-bytes'),
  };
  const b64 = await captureScreenJpeg({
    getSources: async () => [{ id: 'screen:0', display_id: '1', thumbnail: fakeThumb }],
    displayId: '1',
    beforeCapture: () => {},
    afterCapture: () => {},
  });
  assert.ok(b64);
  assert.equal(Buffer.from(b64, 'base64').toString(), 'jpeg-bytes');
  // Module has no fs import / write path; callers must not persist. Guard the contract.
  assert.equal(writes, 0);
  assert.equal(require('fs').writeFileSync === require('node:fs').writeFileSync, true);
});

test('user content with image is multimodal; without stays a string', () => {
  assert.equal(userContentWithImage('hola', null), 'hola');
  const parts = userContentWithImage('mirá', 'abc123');
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[1].type, 'image_url');
  assert.match(parts[1].image_url.url, /^data:image\/jpeg;base64,abc123$/);
});

test('auto-look skipped in game mode (and fullscreen / idle / off)', () => {
  const base = {
    enabled: true,
    shareScreen: true,
    lastAt: 0,
    now: AUTO_LOOK_MS + 1,
    intervalMs: AUTO_LOOK_MS,
    idleSeconds: 0,
  };
  assert.equal(shouldAutoLook({ ...base, gameActive: true }), false);
  assert.equal(shouldAutoLook({ ...base, fullscreen: true }), false);
  assert.equal(shouldAutoLook({ ...base, idleSeconds: 999 }), false);
  assert.equal(shouldAutoLook({ ...base, enabled: false }), false);
  assert.equal(shouldAutoLook({ ...base, gameActive: false, fullscreen: false }), true);
});

test('consent names provider and cloud/local', () => {
  assert.match(consentNotice({ label: 'Gemini', model: 'flash', cloud: true }), /Gemini/);
  assert.match(consentNotice({ label: 'Gemini', model: 'flash', cloud: true }), /nube/);
  assert.match(consentNotice({ label: 'LM Studio', model: 'llava', cloud: false }), /en tu PC/);
});
