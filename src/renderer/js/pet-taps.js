// Head-pet counter: 3 strokes inside the window → annoyed; otherwise a normal pet.

export function createPetTaps({ windowMs = 1200, limit = 3 } = {}) {
  let taps = [];
  return {
    tap(now = Date.now()) {
      taps = taps.filter((t) => now - t <= windowMs);
      taps.push(now);
      if (taps.length >= limit) {
        taps = [];
        return 'annoyed';
      }
      return 'pet';
    },
    reset() {
      taps = [];
    },
  };
}

export function shouldPlayPetPurr({ muted = false, replyMode = 'blips' } = {}) {
  if (muted) return false;
  if (String(replyMode || 'blips').toLowerCase() === 'silent') return false;
  return true;
}
