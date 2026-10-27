// Where the taskbar sits in her window: the ledge she rests on when she sits on it.
//
// The bar usually covers the bottom of her window, so its top edge is the ledge. With
// auto-hide it slides almost off the screen; the watcher marks it as not shown then, and she
// keeps resting at the bottom of her window as if there were no bar at all.

export function ledgeY({ floor, bar }) {
  if (!bar?.shown) return floor;
  return Math.min(floor, Math.max(0, bar.y));
}
