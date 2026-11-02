'use strict';

// Xbox / PlayStation pads via the Gamepad API: configurable button combo = push-to-talk.
// Default [6, 7] is LB+RB on Xbox (L1+R1 on DualShock). Matcher mirrors src/main/gamepad-ptt.js.

function buttonsHeld(pad, indexes) {
  if (!pad || !Array.isArray(indexes) || !indexes.length) return false;
  return indexes.every((i) => Boolean(pad.buttons?.[i]?.pressed));
}

function anyPadCombo(indexes) {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads
    ? navigator.getGamepads()
    : [];
  for (const pad of pads) {
    if (buttonsHeld(pad, indexes)) return true;
  }
  return false;
}

function startGamepadPtt({
  getCombo = () => [6, 7],
  onStart = () => {},
  onStop = () => {},
  intervalMs = 50,
  timers = globalThis,
} = {}) {
  let held = false;
  const tick = () => {
    const combo = (getCombo() || []).map(Number).filter(Number.isFinite);
    const down = anyPadCombo(combo);
    if (down && !held) {
      held = true;
      onStart();
    } else if (!down && held) {
      held = false;
      onStop();
    }
  };
  const id = timers.setInterval(tick, intervalMs);
  return {
    stop: () => timers.clearInterval(id),
    held: () => held,
    tick,
  };
}

export { startGamepadPtt, buttonsHeld, anyPadCombo };
