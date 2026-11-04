'use strict';

// What is really on screen. The bubble reports every open and close (wake word, agent, greeting,
// idle fold, Esc), so Ctrl+Alt+T flips what you see instead of a flag auto-open left behind.

function createChatVisible({ log = () => {} } = {}) {
  let visible = false;
  return {
    get: () => visible,
    set: (on, source = 'overlay') => {
      on = Boolean(on);
      if (on === visible) return visible;
      const before = visible;
      visible = on;
      log(`chat toggle visible=${before}->${on} source=${source}`);
      return visible;
    },
  };
}

module.exports = { createChatVisible };
