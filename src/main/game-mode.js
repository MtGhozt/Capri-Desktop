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
    onExit();
  };

  function update(windows) {
    if (!enabled()) {
      leave(); // switched to OFF while she was away
      return;
    }
    if (gameOnScreen(windows, apps())) {
      cancelExit();
      if (!active) {
        active = true;
        onEnter(windows);
      }
      return;
    }
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
      active = false;
    },
    active: () => active,
  };
}

module.exports = { createGameMode, EXIT_DELAY_MS };
