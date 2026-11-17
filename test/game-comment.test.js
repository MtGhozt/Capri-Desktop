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
  canGameComment,
  gameCommentKind,
} = require('../src/main/game-comment.js');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
const menu = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
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
  // Voice only: speakLine, no sendCommand('line') inside maybeGameComment.
  const from = main.indexOf('function maybeGameComment');
  assert.ok(from > 0, 'maybeGameComment exists');
  const body = main.slice(from, main.indexOf('async function gameLeave', from));
  assert.match(body, /speakLine\(line\)/);
  assert.doesNotMatch(body, /sendCommand\(/);
  // Quiet gates stay tied to gameMode.active for both modes.
  assert.match(main, /createGameQuiet\(\{ isActive: \(\) => Boolean\(gameMode\?\.active\(\)\) \}\)/);
  assert.match(main, /setClickThrough\(true, 'game'\)/);
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
