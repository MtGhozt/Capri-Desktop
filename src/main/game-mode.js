'use strict';

// Follows the window feed: a fullscreen game means she gets off the GPU; thirty seconds
// after it is gone (a loading screen or an alt-tab doesn't count) she comes back.
// A manual No molestar off dismisses the current process until it changes; on always works.

const { gameOnScreen } = require('./game-detect');

const EXIT_DELAY_MS = 30_000;
// What the app waits after focus is lost: long enough that a popup or a quick alt-tab over the
// game never brings her up mid-flicker (main passes it as exitDelayMs).
const FOCUS_LOSS_DEBOUNCE_MS = 10_000;

function exeKey(windows) {
  const exe = String(windows?.fgExe || '').replace(/\//g, '\\').toLowerCase();
  return exe.split('\\').pop() || '';
}

function createGameMode({
  enabled = () => true,
  apps = () => [],
  onEnter = () => {},
  onExit = () => {},
  onUnlock = () => {}, // focus lost: clicks/chat back while VRAM grace still runs
  onRelock = () => {}, // focus back on the game before grace ends
  setWakeMuted = () => {},
  onDecision = () => {},
  exitDelayMs = EXIT_DELAY_MS,
  timers = global,
} = {}) {
  let active = false;
  let pendingExit = null;
  let suppressKey = null; // manual off: stay out until this exe basename changes
  let lastKey = '';

  const cancelExit = () => {
    if (pendingExit !== null) {
      timers.clearTimeout(pendingExit);
      pendingExit = null;
    }
  };

  // Click-through / chat lock only while the game actually owns the foreground.
  const locking = () => active && pendingExit === null;

  const leave = () => {
    cancelExit();
    if (!active) return;
    active = false;
    try { setWakeMuted(false); } catch { /* voice gone */ }
    onExit();
  };

  function dismiss(windows) {
    const key = exeKey(windows) || lastKey;
    if (key) suppressKey = key;
    leave();
  }

  function clearSuppress() {
    suppressKey = null;
  }

  function update(windows) {
    const key = exeKey(windows);
    if (key && suppressKey && key !== suppressKey) suppressKey = null;
    if (key) lastKey = key;

    if (!enabled()) {
      leave(); // switched to OFF while she was away
      return;
    }
    if (gameOnScreen(windows, apps())) {
      if (suppressKey && key === suppressKey) {
        onDecision({
          reason: 'suppressed', rule: 'manual-off', exe: windows?.fgExe, full: Boolean(windows?.fgFull),
        });
        leave();
        return;
      }
      onDecision({ reason: 'enter', rule: 'fullscreen-game', exe: windows?.fgExe, full: Boolean(windows?.fgFull) });
      const wasPending = pendingExit !== null;
      cancelExit();
      if (!active) {
        active = true;
        // Wake muted while the game is fullscreen; PTT still works (sidecar keeps the mic).
        try { setWakeMuted(true); } catch { /* voice gone */ }
        onEnter(windows);
      } else if (wasPending) {
        try { onRelock(windows); } catch { /* overlay gone */ }
      }
      return;
    }
    onDecision({ reason: active ? 'focus-lost' : 'ignored', rule: 'not-fullscreen-game', exe: windows?.fgExe, full: Boolean(windows?.fgFull) });
    if (!active || pendingExit !== null) return;
    pendingExit = timers.setTimeout(() => {
      pendingExit = null;
      leave();
    }, exitDelayMs);
    try { onUnlock(); } catch { /* overlay gone */ }
  }

  return {
    update,
    dismiss,
    clearSuppress,
    stop: () => {
      cancelExit();
      if (active) {
        try { setWakeMuted(false); } catch { /* voice gone */ }
      }
      active = false;
    },
    active: () => active,
    locking,
  };
}

module.exports = { createGameMode, EXIT_DELAY_MS, FOCUS_LOSS_DEBOUNCE_MS };
