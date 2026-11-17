'use strict';

// While a fullscreen game owns the screen she never steals focus or clicks: nothing brings the
// window up (show / focus / moveTop), hover can't take click-through away, and leaving only puts
// the window back the way a quiet overlay needs it — the chat is never opened by any of this.
// Comment mode also pins her above borderless fullscreen (screen-saver level); true exclusive
// fullscreen can still cover any window (Windows limit).

const TOP_LEVEL = 'screen-saver'; // Capri's normal always-on-top level (createOverlay)

function createGameQuiet({ isActive = () => false } = {}) {
  const active = () => Boolean(isActive());

  const apply = (win, { top = true } = {}) => {
    if (!win || win.isDestroyed()) return;
    if (top) win.setAlwaysOnTop(true, TOP_LEVEL);
    win.showInactive();
    win.setIgnoreMouseEvents(true, { forward: true });
  };

  return {
    active,
    // Comment mode: visible, click-through, above the game — re-assert on enter / focus ticks.
    pin: (win) => apply(win, { top: true }),
    // The game is over: Capri's normal top level, visible without focus, clicks passing through.
    restore: (win) => apply(win, { top: true }),
  };
}

module.exports = { createGameQuiet, TOP_LEVEL };
