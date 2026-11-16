'use strict';

// While a fullscreen game owns the screen she never steals focus or clicks: nothing brings the
// window up (show / focus / moveTop), hover can't take click-through away, and leaving only puts
// the window back the way a quiet overlay needs it — the chat is never opened by any of this.

function createGameQuiet({ isActive = () => false } = {}) {
  const active = () => Boolean(isActive());

  return {
    active,
    // The game is over: visible without focus, clicks passing through again, chat untouched.
    restore: (win) => {
      if (!win || win.isDestroyed()) return;
      win.showInactive();
      win.setIgnoreMouseEvents(true, { forward: true });
    },
  };
}

module.exports = { createGameQuiet };
