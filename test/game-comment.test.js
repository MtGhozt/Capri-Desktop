'use strict';

// 0.3.0 — En juegos: quiet (today) vs comment (voice-only, quiet gates, ~8 min).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  GAME_COMMENT_MS,
  COMMENT_WARN,
  normalizeGamingMode,
  gameCommentVoiceReady,
  canGameComment,
  gameCommentKind,
} = require('../src/main/game-comment.js');

const main = require('./main-source');
const menu = require('./menu-source');
const configSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'config.js'), 'utf8');

test('quiet is the default play mode (legacy auto maps to quiet)', () => {
  assert.equal(normalizeGamingMode('quiet'), 'quiet');
  assert.equal(normalizeGamingMode('auto'), 'quiet');
  assert.equal(normalizeGamingMode(undefined), 'quiet');
  assert.equal(normalizeGamingMode('comment'), 'comment');
  assert.equal(normalizeGamingMode('off'), 'off');
  assert.match(configSrc, /mode:\s*'quiet'/);
  assert.match(configSrc, /mode === 'auto'/);
});

test('quiet mode: canGameComment never fires', () => {
  assert.equal(canGameComment({
    mode: 'quiet', gameActive: true, lastAt: 0, now: GAME_COMMENT_MS, voiceOn: true, busy: false,
  }), false);
  assert.equal(canGameComment({
    mode: 'auto', gameActive: true, lastAt: 0, now: GAME_COMMENT_MS, voiceOn: true, busy: false,
  }), false);
});

test('comment mode respects the ~8 min interval', () => {
  assert.equal(GAME_COMMENT_MS, 8 * 60_000);
  assert.equal(canGameComment({
    mode: 'comment', gameActive: true, lastAt: 0, now: GAME_COMMENT_MS - 1, voiceOn: true, busy: false,
  }), false);
  assert.equal(canGameComment({
    mode: 'comment', gameActive: true, lastAt: 0, now: GAME_COMMENT_MS, voiceOn: true, busy: false,
  }), true);
  assert.equal(canGameComment({
    mode: 'comment', gameActive: true, lastAt: 1000, now: 1000 + GAME_COMMENT_MS - 1, voiceOn: true, busy: false,
  }), false);
});

test('comment mode never runs without an active game, voice, or when busy', () => {
  const base = { mode: 'comment', lastAt: 0, now: GAME_COMMENT_MS, voiceOn: true, busy: false };
  assert.equal(canGameComment({ ...base, gameActive: false }), false);
  assert.equal(canGameComment({ ...base, gameActive: true, voiceOn: false }), false);
  assert.equal(canGameComment({ ...base, gameActive: true, busy: true }), false);
});

test('manual off wins over comment (and quiet)', () => {
  assert.equal(canGameComment({
    mode: 'off', gameActive: true, lastAt: 0, now: GAME_COMMENT_MS, voiceOn: true, busy: false,
  }), false);
  // Main: enabled() is false when mode is off; dismiss keeps gameMode inactive.
  assert.match(main, /normalizeGamingMode\(config\.load\(\)\.gaming\?\.mode\) !== 'off'/);
  assert.match(main, /case 'gaming-mode':[\s\S]*?mode: 'off'[\s\S]*?dismiss/);
  assert.match(main, /case 'gaming-play':[\s\S]*?clearSuppress/);
});

test('comment mode reuses quiet gates and never sends a bubble line', () => {
  const from = main.indexOf('function maybeGameComment');
  assert.ok(from > 0, 'maybeGameComment exists');
  const body = main.slice(from, main.indexOf('async function gameLeave', from));
  assert.match(body, /speakQueue\.(?:start|feed|flush)/);
  assert.doesNotMatch(body, /sendCommand\(/);
  assert.doesNotMatch(body, /speakLine\(/); // must not use replyMode-gated speakLine
  // Quiet gates stay tied to gameMode.locking (foreground) for both modes.
  assert.match(main, /createGameQuiet\(\{ isActive: \(\) => Boolean\(gameMode\?\.locking\?\.\(\)\) \}\)/);
  assert.match(main, /setClickThrough\(true, 'game'\)/);
});

test('Comentar speaks when voice is connected even if replyMode is off', () => {
  // Opt-in is gaming.mode=comment, not Respuesta=VOZ.
  assert.equal(gameCommentVoiceReady({ muted: false, connected: true, tts: 'kokoro' }), true);
  assert.equal(gameCommentVoiceReady({ muted: false, connected: true, tts: 'omnivoice' }), true);
  assert.equal(canGameComment({
    mode: 'comment', gameActive: true, lastAt: 0, now: GAME_COMMENT_MS,
    voiceOn: gameCommentVoiceReady({ muted: false, connected: true, tts: 'kokoro' }),
    busy: false,
  }), true);
  const from = main.indexOf('function maybeGameComment');
  const body = main.slice(from, main.indexOf('async function gameLeave', from));
  assert.match(body, /gameCommentVoiceReady/);
  assert.doesNotMatch(body, /voiceReplyOn\(/);
  assert.match(body, /speakQueue\.start/);
});

test('Comentar shows nothing when voice is not available (no bubble)', () => {
  assert.equal(gameCommentVoiceReady({ muted: false, connected: false, tts: 'kokoro' }), false);
  assert.equal(gameCommentVoiceReady({ muted: true, connected: true, tts: 'kokoro' }), false);
  assert.equal(gameCommentVoiceReady({ muted: false, connected: true, tts: 'off' }), false);
  assert.equal(canGameComment({
    mode: 'comment', gameActive: true, lastAt: 0, now: GAME_COMMENT_MS,
    voiceOn: false, busy: false,
  }), false);
  const from = main.indexOf('function maybeGameComment');
  const body = main.slice(from, main.indexOf('async function gameLeave', from));
  // No voice → early return; never a bubble over the game.
  assert.match(body, /if \(!speakQueue\) return/);
  assert.doesNotMatch(body, /sendCommand\(/);
});

test('screen-based kind only when shareScreen is on; otherwise generic', () => {
  assert.equal(gameCommentKind({ shareScreen: false, context: 'juego' }), 'comentar');
  assert.equal(gameCommentKind({ shareScreen: true, context: 'juego' }), 'juego');
  assert.equal(gameCommentKind({ shareScreen: true, context: null }), 'comentar');
});

test('first comment pick shows the anti-cheat warning once', () => {
  assert.match(COMMENT_WARN, /anti-cheat/i);
  assert.match(COMMENT_WARN, /nunca controla/i);
  assert.match(main, /commentWarned/);
  assert.match(main, /warning: COMMENT_WARN/);
  assert.match(menu, /result\?\.warning/);
  assert.match(menu, /gamePlayNote/);
  assert.match(menu, /En juegos/);
  assert.match(menu, /Comentar de vez en cuando/);
  assert.match(menu, /gaming-play/);
});

test('comment mode + game → visible and click-through, not folded', () => {
  const enter = main.slice(
    main.indexOf('async function gameEnter'),
    main.indexOf('function maybeGameComment'),
  );
  const apply = main.slice(
    main.indexOf('function applyGamePlayVisual'),
    main.indexOf('async function gameEnter'),
  );
  // Comment: pin (visible + ignore mouse + screen-saver), optional silent wake — never sleep.
  assert.match(apply, /play === 'comment'/);
  assert.match(apply, /gameQuiet\.pin\(getOverlay\(\)\)/);
  assert.match(apply, /gameHidHer = false/);
  assert.doesNotMatch(apply.split("play === 'comment'")[1].split('gameHidHer = true')[0], /sendCommand\('sleep'\)/);
  assert.match(enter, /applyGamePlayVisual\('comment'\)/);
  // Re-assert on focus / window ticks while comment + game.
  assert.match(main, /gameQuiet\.pin\(getOverlay\(\)\)/);
  assert.match(main, /mode\) === 'comment'\) gameQuiet\.pin\(overlay\)/);
  // Quiet gates still block focus / hover / bubbles — only while the game owns foreground.
  assert.match(main, /createGameQuiet\(\{ isActive: \(\) => Boolean\(gameMode\?\.locking\?\.\(\)\) \}\)/);
  assert.match(main, /onUnlock:\s*\(\)\s*=>\s*gameWindow\.unlock\(\)/);
  assert.match(main, /setClickThrough\(false,\s*'game-focus-lost'\)/);
  assert.match(main, /gameMode\?\.locking\?\.\(\)\s*&&\s*normalizeGamingMode/);
});

test('quiet mode + game → hidden (sleep), same as today', () => {
  const apply = main.slice(
    main.indexOf('function applyGamePlayVisual'),
    main.indexOf('async function gameEnter'),
  );
  const enter = main.slice(
    main.indexOf('async function gameEnter'),
    main.indexOf('function maybeGameComment'),
  );
  assert.match(apply, /gameHidHer = true/);
  assert.match(apply, /sendCommand\('sleep'\)/);
  assert.match(enter, /applyGamePlayVisual\('quiet'\)/);
  assert.match(enter, /juegoEntrar/);
  // Mid-game switch to quiet (manual No molestar) also hides.
  assert.match(main, /case 'gaming-play':[\s\S]*?gameMode\?\.active\(\)\) gameWindow\?\.visual\(next\)/);
});
