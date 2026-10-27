'use strict';

// The rects the window watcher prints are physical screen pixels. Everything else in Capri
// (the overlay, the sprite, the hit tests) works in the overlay's own coordinates, so this
// turns one into the other: screen pixels -> DIPs -> her window.

/**
 * `toDip` converts a {x, y, width, height} rect from screen pixels to DIPs (Electron's
 * screenToDipRect); by default the two are the same.
 */
function toOverlayRect(rect, bounds, toDip = (box) => box) {
  if (!rect) return null;
  const numbers = [rect.x, rect.y, rect.w, rect.h];
  if (!numbers.every((n) => Number.isFinite(Number(n)))) return null;
  const dip = toDip({ x: Number(rect.x), y: Number(rect.y), width: Number(rect.w), height: Number(rect.h) });
  if (!dip) return null;
  return {
    x: dip.x - bounds.x,
    y: dip.y - bounds.y,
    w: dip.width,
    h: dip.height,
  };
}

module.exports = { toOverlayRect };
