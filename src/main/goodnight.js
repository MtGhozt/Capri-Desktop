'use strict';

// Her goodnight: she says her sleep line first and only then goes to her corner and folds.
//
// With her voice on, the fold waits for the line to be played: the sidecar's `talking` (her line
// started) and then `talking_done`. Whatever was still talking before her line (a reply cut off
// by it) doesn't count. If her line never starts, or never ends, the fold goes anyway after
// `startMs` / `talkMs`. With blips or silent, it waits about as long as the line takes to read.

const START_MS = 6000;
const TALK_MS = 6000;

// Blips/silent: time to read the line in the bubble.
function readMs(line) {
  const chars = String(line || '').length;
  return Math.min(6000, Math.max(1500, 900 + chars * 45));
}

function createGoodnight({
  fold,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  startMs = START_MS,
  talkMs = TALK_MS,
} = {}) {
  let pending = false;
  let spoken = false;
  let talking = false;
  let timer = null;

  const stopTimer = () => {
    if (timer) clearTimer(timer);
    timer = null;
  };
  const arm = (ms) => {
    stopTimer();
    timer = setTimer(done, ms);
  };
  function done() {
    if (!pending) return;
    stopTimer();
    pending = false;
    fold();
  }

  return {
    get pending() { return pending; },
    // Her sleep line is out: `spoken` when it went to her voice, else it is only in the bubble.
    start({ spoken: aloud = false, line = '' } = {}) {
      pending = true;
      spoken = Boolean(aloud);
      talking = false;
      arm(spoken ? startMs : readMs(line));
    },
    // Every sidecar event goes through here.
    onVoiceEvent(event) {
      if (!pending || !spoken || !event) return;
      if (event.type === 'talking') {
        talking = true;
        arm(talkMs);
      } else if (event.type === 'talking_done') {
        if (talking) done(); // her line is over (or cut off: she was told to sleep anyway)
        else if (event.skipped) done(); // her line was dropped: nothing to wait for
      } else if (event.type === 'stopped') {
        done(); // no voice anymore
      }
    },
    // Woken up, or folded some other way (game mode) before the line was over.
    cancel() {
      pending = false;
      stopTimer();
    },
    // Fold now (the old way), if one is waiting.
    now: () => done(),
  };
}

module.exports = { createGoodnight, readMs, START_MS, TALK_MS };
