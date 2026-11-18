'use strict';

// The overlay's own channels: hover/click-through, the renderer's log and beat, folding, the
// cursor, which window is in front, and the chat visibility, which the bubble owns.

const { screen } = require('electron');

const { logEvent, voiceLogPath } = require('./log');

function registerOverlayIpc(ipcMain, deps) {

  const {
    state,
    gameQuiet,
    setClickThrough,
    rearmOverlay,
    appFx,
    menuGuard,
    rebuildTray,
    closeChat,
    chatVisible,
    getVoice,
    getLastWindows,
    getOverlay,
    getLastInteractive,
    setLastInteractive,
  } = deps;

    ipcMain.on('overlay:interactive', (_e, on) => {
      if (gameQuiet.active()) return; // hover never takes click-through away during a game
      // Asleep under a fullscreen window: her chip sits over it, clicks keep passing through.
      if (on && state.overlayFolded && getLastWindows()?.fgFull) return;
      if (on === getLastInteractive()) return; // unchanged: the window already agrees
      setLastInteractive(on);
      setClickThrough(!on, on ? 'hover-on' : 'hover-off');
    });
    ipcMain.on('renderer:log', (_e, payload = {}) => {
      const kind = String(payload.kind || 'error').slice(0, 30);
      const message = String(payload.message || '').slice(0, 2000);
      if (message) logEvent(voiceLogPath(), `[renderer:${kind}] ${message}`);
    });
    ipcMain.on('overlay:rearm', () => rearmOverlay()); // the pointer moved over her and she never heard of it
    ipcMain.on('appfx:hit', (_e, id) => appFx.hit(id));
    ipcMain.on('overlay:menu', (_e, open) => menuGuard.menuChanged(Boolean(open)));
    ipcMain.on('overlay:beat', (_e, state) => menuGuard.beat(state && typeof state === 'object' ? state : {}));
    ipcMain.on('overlay:folded', (_e, on) => {
      state.overlayFolded = Boolean(on);
      getVoice()?.setSleeping?.(state.overlayFolded);
      rebuildTray();
    });
    ipcMain.handle('overlay:cursor', () => {
      const p = screen.getCursorScreenPoint();
      const b = getOverlay().getBounds();
      return { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height };
    });

    ipcMain.handle('windows:get', () => getLastWindows());

    ipcMain.on('chat:close', () => closeChat());
    // The bubble is the source of truth: every auto-open (wake, agent, greeting) and every hide
    // (idle fold, Esc, click away) lands here, so Ctrl+Alt+T always flips what is on screen.
    ipcMain.on('chat:visible', (_e, payload) => {
      if (!payload || typeof payload !== 'object') return;
      chatVisible.set(payload.open, String(payload.source || 'overlay'));
    });

}

module.exports = { registerOverlayIpc };
