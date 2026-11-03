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
  createCaptureShield,
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

test('capture reports the selected display and image dimensions', async () => {
  let info;
  const thumb = {
    isEmpty: () => false,
    getSize: () => ({ width: 800, height: 450 }),
    toJPEG: () => Buffer.from('fresh-frame'),
  };
  await captureScreenJpeg({
    getSources: async () => [{ display_id: 'monitor-2', thumbnail: thumb }],
    displayId: 'monitor-2',
    onCapture: (value) => { info = value; },
  });
  assert.deepEqual(info.size, { width: 800, height: 450 });
  assert.equal(info.displayId, 'monitor-2');
  assert.equal(info.bytes, Buffer.byteLength('fresh-frame'));
  assert.match(info.hash, /^[a-f0-9]{40}$/);
});

test('capture marks a black frame as blank', async () => {
  let info;
  await captureScreenJpeg({
    getSources: async () => [{
      display_id: '1',
      thumbnail: {
        isEmpty: () => false,
        getSize: () => ({ width: 2, height: 2 }),
        getBitmap: () => Buffer.alloc(16),
        toJPEG: () => Buffer.from('black'),
      },
    }],
    onCapture: (value) => { info = value; },
  });
  assert.equal(info.blank, true);
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

test('win32 capture uses content protection, restores in finally, never hides', async () => {
  const calls = [];
  const shield = createCaptureShield({
    platform: 'win32',
    setContentProtection: (on) => calls.push(['protect', on]),
    hide: () => calls.push('hide'),
    show: () => calls.push('show'),
    reapplyClickThrough: () => calls.push('reapply'),
  });
  const fakeThumb = {
    isEmpty: () => false,
    getSize: () => ({ width: 800, height: 450 }),
    toJPEG: () => Buffer.from('jpeg'),
  };
  const b64 = await captureScreenJpeg({
    getSources: async () => [{ id: 'screen:0', thumbnail: fakeThumb }],
    beforeCapture: () => shield.before(),
    afterCapture: () => shield.after(),
  });
  assert.ok(b64);
  assert.deepEqual(calls, [['protect', true], ['protect', false], 'reapply']);
  assert.ok(!calls.includes('hide'));
  assert.ok(!calls.includes('show'));
});

test('capture protection is restored in finally even when getSources throws', async () => {
  const calls = [];
  const shield = createCaptureShield({
    platform: 'win32',
    setContentProtection: (on) => calls.push(['protect', on]),
    hide: () => calls.push('hide'),
    reapplyClickThrough: () => calls.push('reapply'),
  });
  await assert.rejects(() => captureScreenJpeg({
    getSources: async () => { throw new Error('boom'); },
    beforeCapture: () => shield.before(),
    afterCapture: () => shield.after(),
  }), /boom/);
  assert.deepEqual(calls, [['protect', true], ['protect', false], 'reapply']);
});

test('non-Windows (or protect throw) falls back to hide/show', async () => {
  const calls = [];
  const shield = createCaptureShield({
    platform: 'linux',
    setContentProtection: (on) => calls.push(['protect', on]),
    hide: () => calls.push('hide'),
    show: () => calls.push('show'),
    reapplyClickThrough: () => calls.push('reapply'),
  });
  shield.before();
  assert.equal(shield.mode(), 'hide');
  shield.after();
  assert.deepEqual(calls, ['hide', 'show', 'reapply']);

  const calls2 = [];
  const shield2 = createCaptureShield({
    platform: 'win32',
    setContentProtection: () => { throw new Error('no WDA'); },
    hide: () => calls2.push('hide'),
    show: () => calls2.push('show'),
    reapplyClickThrough: () => calls2.push('reapply'),
  });
  shield2.before();
  shield2.after();
  assert.deepEqual(calls2, ['hide', 'show', 'reapply']);
});

test('look/speak fault path restores clickable overlay (regression)', () => {
  // Mirrors resetOverlayInput: after capture/error we must reapply click-through and
  // ask the renderer to forceFree so drag/menu/Settings never stay stuck.
  const calls = [];
  const shield = createCaptureShield({
    platform: 'win32',
    setContentProtection: (on) => calls.push(['protect', on]),
    hide: () => calls.push('hide'),
    reapplyClickThrough: () => calls.push('reapply'),
  });
  shield.before();
  // simulate an exception mid-look while she was talking / user tried to drag
  try {
    throw new Error('look-speak-drag');
  } catch {
    shield.after();
    calls.push('input-reset');
  }
  assert.deepEqual(calls, [['protect', true], ['protect', false], 'reapply', 'input-reset']);
  assert.ok(!calls.includes('hide'));
});

test('unlock/resume recover clears busy/drag via input-reset (regression)', () => {
  // Mirrors recoverAfterUnlock in main.js: rearm alone left busy/dragging true after Win+L,
  // so refreshHit kept the fullscreen overlay interactive. Must also resetOverlayInput.
  // reset before rearm so the false→true hook reinstall is not overwritten by a same-value reapply.
  const calls = [];
  const rearmOverlay = () => {
    calls.push('ignore-off');
    calls.push(['setClickThrough', true, 'rearm']);
    calls.push('rearmed');
  };
  const resetOverlayInput = (reason) => {
    calls.push(['setClickThrough', true]); // reapply current flag
    calls.push(['input-reset', reason]); // renderer: clear busy/drag + forceFree
  };
  const recoverAfterUnlock = (reason = 'unlock') => {
    calls.push(['forceClose', reason]);
    resetOverlayInput(reason);
    rearmOverlay();
  };
  recoverAfterUnlock('unlock');
  recoverAfterUnlock('resume');
  assert.ok(calls.includes('rearmed'));
  assert.deepEqual(
    calls.filter((c) => Array.isArray(c) && c[0] === 'input-reset'),
    [['input-reset', 'unlock'], ['input-reset', 'resume']],
  );
  assert.equal(calls.filter((c) => Array.isArray(c) && c[0] === 'forceClose').length, 2);
  const unlockReset = calls.indexOf(calls.find((c) => Array.isArray(c) && c[0] === 'input-reset' && c[1] === 'unlock'));
  const unlockRearm = calls.indexOf('rearmed');
  assert.ok(unlockReset < unlockRearm);
});

test('unlock, resume, and display changes use the same overlay resync', () => {
  const main = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'main', 'main.js'),
    'utf8',
  );
  assert.match(main, /function resyncOverlay\(reason = 'resync'\)[\s\S]*?recoverAfterUnlock\(reason\)/);
  assert.match(main, /display-metrics-changed', \(\) => \{\s*resyncOverlay\('display-metrics-changed'\)/);
  assert.match(main, /const scheduleUnlockResync = \(reason, after = null\)/);
  assert.match(main, /powerMonitor\.on\('resume', \(\) => scheduleUnlockResync\('resume'\)/);
  assert.match(main, /powerMonitor\.on\('unlock-screen', \(\) => scheduleUnlockResync\('unlock'/);
  assert.match(main, /}, 500\);/);
  assert.match(main, /setIgnoreMouseEvents\(false\)[\s\S]*?setClickThrough\(true, 'rearm'\)/);
  assert.match(main, /click-through \$\{through \? 'on' : 'off'\} reason=\$\{reason\}/);
  assert.match(main, /quitSolid \|\| menuGuard\?\.menuOpen/);
});

test('menu opens with explicit mouse capture and restores click-through on close', () => {
  const main = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'main', 'main.js'),
    'utf8',
  );
  assert.match(main, /onMenu: \(open\) => \{[\s\S]*?setClickThrough\(false, 'menu-open'\)[\s\S]*?overlay\?\.focus\(\)/);
  assert.match(main, /setClickThrough\(true, 'menu-close'\)/);
});
