// Where the message box goes on screen: above Capri's head by default, kept inside the view.

export const BOX_MARGIN = 14;

export function clampBox(pos, view, size, margin = BOX_MARGIN) {
  const maxLeft = Math.max(margin, view.w - size.w - margin);
  const maxTop = Math.max(margin, view.h - size.h - margin);
  return {
    left: Math.round(Math.min(Math.max(pos.left, margin), maxLeft)),
    top: Math.round(Math.min(Math.max(pos.top, margin), maxTop)),
  };
}

// Centred over her, just above the tips of her mane; under her if there's no room above.
export function boxAbove(anchor, view, size, margin = BOX_MARGIN) {
  const { x = view.w / 2, y = view.h / 2 } = anchor || {};
  const crown = anchor?.top ?? y - 80;
  let top = crown - size.h - 8;
  if (top < margin) top = y + 48;
  return clampBox({ left: x - size.w / 2, top }, view, size, margin);
}
