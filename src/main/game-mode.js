'use strict';

// Follows the window feed: a fullscreen game means she gets off the GPU; thirty seconds
// after it is gone (a loading screen or an alt-tab doesn't count) she comes back.

const { gameOnScreen } = require('./game-detect');

const EXIT_DELAY_MS = 30_000;

function createGameMode({
  enabled = () => true,
  apps = () => [],
  onEnter = () => {},
  onExit = () => {},
  setWakeMuted = () => {},
  onDecision = () => {},
  exitDelayMs = EXIT_DELAY_MS,
  timers = global,
} = {}) {
  let active = false;
  let pendingExit = null;

  const cancelExit = () => {
    if (pendingExit !== null) {
      timers.clearTimeout(pendingExit);
      pendingExit = null;
    }
  };

  const leave = () => {
    cancelExit();
    if (!active) return;
    active = false;
    try { setWakeMuted(false); } catch { /* voice gone */ }
    onExit();
  };

  function update(windows) {
    if (!enabled()) {
      leave(); // switched to OFF while she was away
      return;
    }
    if (gameOnScreen(windows, apps())) {
      onDecision({ reason: 'enter', rule: 'fullscreen-game', exe: windows?.fgExe, full: Boolean(windows?.fgFull) });
      cancelExit();
      if (!active) {
        active = true;
        // Wake muted while the game is fullscreen; PTT still works (sidecar keeps the mic).
        try { setWakeMuted(true); } catch { /* voice gone */ }
        onEnter(windows);
      }
      return;
    }
    onDecision({ reason: active ? 'focus-lost' : 'ignored', rule: 'not-fullscreen-game', exe: windows?.fgExe, full: Boolean(windows?.fgFull) });
    if (!active || pendingExit !== null) return;
    pendingExit = timers.setTimeout(() => {
      pendingExit = null;
      leave();
    }, exitDelayMs);
  }

  return {
    update,
    stop: () => {
      cancelExit();
      if (active) {
        try { setWakeMuted(false); } catch { /* voice gone */ }
      }
      active = false;
    },
    active: () => active,
  };
}

module.exports = { createGameMode, EXIT_DELAY_MS };
