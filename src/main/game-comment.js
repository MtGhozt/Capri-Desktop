'use strict';

// In-game "Comentar": stay behind the quiet overlay gates, voice a short pool line at most
// every GAME_COMMENT_MS. Never focus, never capture the mouse, never control the game.

const GAME_COMMENT_MS = 8 * 60_000;

const COMMENT_WARN =
  'Bajo tu riesgo: algunos juegos con anti-cheat pueden no llevarse bien con overlays. Capri nunca controla el juego.';

/** @returns {'quiet'|'comment'|'off'} */
function normalizeGamingMode(mode) {
  if (mode === 'comment') return 'comment';
  if (mode === 'off') return 'off';
  return 'quiet'; // 'quiet', legacy 'auto', or anything else
}

function canGameComment({
  mode,
  gameActive = false,
  lastAt = 0,
  now = Date.now(),
  voiceOn = false,
  busy = false,
} = {}) {
  if (normalizeGamingMode(mode) !== 'comment') return false;
  if (!gameActive) return false;
  if (!voiceOn || busy) return false;
  if (now - lastAt < GAME_COMMENT_MS) return false;
  return true;
}

/** Pool kind: screen context only when shareScreen is already on; else generic. */
function gameCommentKind({ shareScreen = false, context = null } = {}) {
  if (!shareScreen) return 'comentar';
  return context || 'comentar';
}

module.exports = {
  GAME_COMMENT_MS,
  COMMENT_WARN,
  normalizeGamingMode,
  canGameComment,
  gameCommentKind,
};
