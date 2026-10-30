'use strict';

// Renderer crash / hang: reload once, then stop looping and tell the tray.
// Keeps the main process (and tray quit paths) alive.

function createRendererRecover({
  reload = () => {},
  notice = () => {},
  log = () => {},
  setClickThrough = () => {},
  maxReloads = 1,
} = {}) {
  let reloads = 0;

  function handle(kind, detail = '') {
    const why = detail ? `${kind}: ${detail}` : kind;
    log(`[capri] renderer ${why}`);
    try { setClickThrough(true); } catch { /* window may be gone */ }
    if (reloads < maxReloads) {
      reloads += 1;
      log(`[capri] renderer recover: reload ${reloads}/${maxReloads}`);
      try { reload(); } catch (err) {
        log(`[capri] renderer reload failed: ${err.message}`);
      }
      return 'reload';
    }
    notice(
      'Capri se trabó. Ctrl+Alt+Shift+Q cierra al instante, o Salir dos veces en la bandeja (10 s).',
    );
    return 'notice';
  }

  return {
    gone: (reason) => handle('gone', reason),
    unresponsive: () => handle('unresponsive'),
    get reloads() { return reloads; },
    reset() { reloads = 0; },
  };
}

module.exports = { createRendererRecover };
