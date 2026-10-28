'use strict';

// Her menu can never hold the screen. The overlay tells main when the menu opens and closes and,
// every couple of seconds, how it stands (a heartbeat). From that main:
//  - keeps the window's click-through in line with what she last asked for (a dropped or missed
//    message can't leave the whole screen taking clicks);
//  - gives the clicks back to the other windows when she stops answering;
//  - closes the menu on demand (tray "Cerrar menú", Ctrl+Alt+M, Esc while it's open), and if she
//    doesn't answer that, reloads her page.

const SILENT_MS = 6000;   // no heartbeat for this long: she's stalled
const FORCE_WAIT_MS = 2500; // after a forced close, the time she has to answer before a reload

function createMenuGuard({
  now = () => Date.now(),
  clickThrough,      // () => bool, the window's current state
  setClickThrough,   // (on) => void
  sendCommand,       // (name, payload) => void
  keyboardOff = () => {},
  reload = () => {},
  onMenu = () => {}, // (open) => void: Esc taken while it's open
  log = () => {},
} = {}) {
  let menuOpen = false;
  let lastBeat = now();
  let forcedAt = 0;
  let silent = false;

  function menuChanged(open) {
    open = Boolean(open);
    if (open === menuOpen) return;
    menuOpen = open;
    log(`[capri] menu ${open ? 'open' : 'closed'}`);
    onMenu(open);
  }

  function beat(state = {}) {
    lastBeat = now();
    if (silent) {
      silent = false;
      log('[capri] overlay answering again');
    }
    if (forcedAt) forcedAt = 0;
    menuChanged(Boolean(state.menu));
    if (state.shown && !state.menu) log('[capri] menu drawn while closed: hidden again');
    const wantThrough = !state.interactive;
    if (typeof state.interactive === 'boolean' && wantThrough !== clickThrough()) {
      log(`[capri] click-through was ${clickThrough() ? 'on' : 'off'}, she wants it ${wantThrough ? 'on' : 'off'} (menu=${Boolean(state.menu)} folding=${Boolean(state.folding)} dragging=${Boolean(state.dragging)})`);
      setClickThrough(wantThrough);
    }
  }

  function forceClose(reason = 'shortcut') {
    log(`[capri] menu force-closed (${reason})`);
    keyboardOff();
    sendCommand('menu-close', { force: true });
    setClickThrough(true);
    menuChanged(false);
    forcedAt = now();
  }

  function tick() {
    const t = now();
    if (forcedAt && t - forcedAt >= FORCE_WAIT_MS) {
      forcedAt = 0;
      log('[capri] overlay did not answer the forced close: reloading it');
      setClickThrough(true);
      reload();
      return;
    }
    if (t - lastBeat >= SILENT_MS && !silent) {
      silent = true;
      log(`[capri] overlay silent for ${Math.round((t - lastBeat) / 1000)}s: click-through on`);
      // Lock/sleep freezes her page: close the menu in the renderer too (not only click-through),
      // or after unlock the overlay stays interactive over Ajustes. No forcedAt — a long lock
      // must not reload her every few seconds.
      keyboardOff();
      sendCommand('menu-close', { force: true });
      setClickThrough(true);
      menuChanged(false);
    }
  }

  return { beat, forceClose, tick, menuChanged, get menuOpen() { return menuOpen; } };
}

module.exports = { createMenuGuard, SILENT_MS, FORCE_WAIT_MS };
