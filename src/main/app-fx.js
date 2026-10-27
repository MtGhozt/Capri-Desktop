'use strict';

// Her effects for opening and closing apps (Paso 4E): a zap at the window she's about to close,
// a spark where the one she opened comes up. main.js sends them to the overlay; the close waits
// for the zap to hit, but never more than `capMs`, and not at all when they're off (her menu's
// "Animaciones de apps") or a game is up.
//
//   send(payload)   to the overlay: { kind: 'zap' | 'spark', id, rect, name }
//   enabled()       effects on right now
//   toOverlay(rect) a physical-pixel screen rect -> her coordinates (null when off her screen)

const CAP_MS = 1200;

function createAppFx({ send, enabled = () => true, toOverlay = (r) => r, capMs = CAP_MS }) {
  let next = 1;
  const waiting = new Map(); // id -> resolve

  function on() {
    try { return Boolean(enabled()); } catch { return false; }
  }

  function place(rect) {
    if (!rect) return null;
    try { return toOverlay(rect) || null; } catch { return null; }
  }

  // resolves true when it hit, false when it didn't play (off, or no answer in time)
  function zap(rect) {
    if (!on()) return Promise.resolve(false);
    const id = next++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        resolve(false);
      }, capMs);
      waiting.set(id, () => {
        clearTimeout(timer);
        waiting.delete(id);
        resolve(true);
      });
      try {
        send({ kind: 'zap', id, rect: place(rect) });
      } catch {
        waiting.get(id)?.();
      }
    });
  }

  function spark(app) {
    if (!on()) return false;
    try {
      send({ kind: 'spark', id: next++, rect: null, name: String(app?.name || '') });
      return true;
    } catch {
      return false;
    }
  }

  // the overlay's word that the zap hit (or that it won't play: reduced motion, hidden)
  function hit(id) {
    waiting.get(Number(id))?.();
  }

  return { zap, spark, hit, pending: () => waiting.size };
}

module.exports = { createAppFx, CAP_MS };
