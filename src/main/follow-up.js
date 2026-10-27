'use strict';

// Follow-up listening (Paso 4B): when her answer to something you SAID ends with a question,
// the mic opens for a few seconds without the wake word, once her voice is done.
//
//   heard(transcript)  you said something (from a follow-up window or not)
//   reply(text, opts)  her answer to it is complete (model reply or direct-command line)
//   onVoiceEvent(evt)  every sidecar event: talking / talking_done / listening
//
// She waits for her line to be played (talking → talking_done) plus `gapMs`, so she doesn't
// hear herself; with blips or silent there is no audio: she waits as long as the line takes to
// read. At most `maxChain` windows in a row; a wake word or the hotkey starts a new chain.

const GAP_MS = 250;
const MAX_CHAIN = 3;
const START_MS = 8000;  // her voice never started: no window
const TALK_MS = 45_000; // her voice never ended: no window
const TURN_MS = 120_000; // a reply this long after what you said is not an answer to it

// The last sentence of her line is a question: it ends with "?" (closing quotes, emoji,
// "…" and the like after it don't count).
function endsWithQuestion(text) {
  const t = String(text || '')
    .replace(/[\s"'»”’)\]*_~…\p{Extended_Pictographic}\u{FE0F}\u{200D}]+$/u, '')
    .trimEnd();
  return t.endsWith('?');
}

function readMs(line) {
  const chars = String(line || '').length;
  return Math.min(6000, Math.max(1200, 700 + chars * 40));
}

function createFollowUp({
  seconds,          // () => window length in seconds (0 = off)
  canListen,        // () => false while muted, DORMANT, game mode...
  open,             // (seconds) => ask the sidecar to listen
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  gapMs = GAP_MS,
  maxChain = MAX_CHAIN,
  startMs = START_MS,
  talkMs = TALK_MS,
  turnMs = TURN_MS,
} = {}) {
  let chain = 0;        // windows opened since your last wake word / hotkey turn
  let turnAt = null;    // when you last said something we are waiting to answer
  let pending = null;   // { spoken, talking } her question, waiting for her voice to end
  let timer = null;

  const stopTimer = () => {
    if (timer) clearTimer(timer);
    timer = null;
  };
  const arm = (ms, fn) => {
    stopTimer();
    timer = setTimer(fn, ms);
  };
  const cancel = () => {
    pending = null;
    stopTimer();
  };
  const fire = () => {
    stopTimer();
    pending = null;
    const secs = Number(seconds?.()) || 0;
    if (secs <= 0 || !canListen?.()) return false;
    if (chain >= maxChain) return false;
    chain += 1;
    open(secs);
    return true;
  };

  return {
    get pending() { return Boolean(pending); },
    get chain() { return chain; },
    heard({ followUp = false } = {}) {
      cancel();
      if (!followUp) chain = 0;
      turnAt = now();
    },
    // `spoken`: her line went to her voice (talking / talking_done will follow).
    reply(text, { spoken = false } = {}) {
      const answering = turnAt != null && now() - turnAt <= turnMs;
      turnAt = null;
      cancel();
      if (!answering || !endsWithQuestion(text)) return false;
      if ((Number(seconds?.()) || 0) <= 0 || chain >= maxChain) return false;
      pending = { spoken: Boolean(spoken), talking: false };
      if (spoken) arm(startMs, cancel);
      else arm(readMs(text) + gapMs, fire);
      return true;
    },
    onVoiceEvent(event) {
      const type = event?.type;
      if (type === 'listening' && !event.followUp) {
        cancel(); // you already called her: no window on top of that
        return;
      }
      if (!pending || !pending.spoken) return;
      if (type === 'talking') {
        pending.talking = true;
        arm(talkMs, cancel);
      } else if (type === 'talking_done') {
        if (event.interrupted) cancel();
        else if (pending.talking || event.skipped) arm(gapMs, fire);
      }
    },
    cancel,
  };
}

module.exports = { createFollowUp, endsWithQuestion, readMs, GAP_MS, MAX_CHAIN };
