'use strict';

// Her own life on the desktop: a line every 15–40 minutes, and one more when the foreground
// window changes to music, a game, a video or code. A context change gets one chance and
// nothing else until the global cooldown (the 15 minutes) has passed since her last line.

const { pickLine } = require('./lines-es');

const DEFAULT_MIN_MS = 15 * 60_000;
const DEFAULT_MAX_MS = 40 * 60_000;

const ms = (value, fallback) => {
  const raw = typeof value === 'function' ? value() : value;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1000 ? n : fallback;
};

function createComments({
  enabled = () => true,
  canSpeak = () => true,
  pick = (kind) => pickLine(kind),
  onLine = () => {},
  onIgnored = () => {},
  onError = () => {},
  minMs = DEFAULT_MIN_MS,
  maxMs = DEFAULT_MAX_MS,
  random = Math.random,
  timers = global,
  now = () => Date.now(),
} = {}) {
  let timer = null;
  let lastAt = 0;
  let nextAt = 0;
  let context = null;
  let running = false;
  let ignored = 0;
  let waiting = false;

  const gap = () => {
    const lo = ms(minMs, DEFAULT_MIN_MS);
    const hi = Math.max(lo, ms(maxMs, lo));
    return lo + Math.floor(random() * (hi - lo + 1));
  };
  const cooled = () => now() - lastAt >= ms(minMs, DEFAULT_MIN_MS);

  function clear() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  function schedule() {
    clear();
    if (!running || !enabled()) return;
    timer = timers.setTimeout(fire, Math.max(1000, nextAt - now()));
  }

  function say(kind) {
    const line = pick(kind);
    if (!line) return false;
    lastAt = now();
    nextAt = lastAt + gap();
    try { onLine(line, kind); } catch (err) { onError(err, 'comment'); }
    schedule();
    return true;
  }

  function fire() {
    timer = null;
    if (!running) return;
    if (enabled() && canSpeak() && now() >= nextAt) say('comentar');
    else if (!enabled()) return;
    else nextAt = now() + gap(); // folded, chatting or in a game: not now
    schedule();
  }

  /** The foreground context changed: one chance to react, if the cooldown allows it. */
  function observe(next) {
    if (!running) return;
    const prev = context;
    context = next || null;
    if (!context || context === prev) return;
    if (!enabled() || !canSpeak() || !cooled()) return;
    say(context);
  }

  function start() {
    if (running) return;
    running = true;
    lastAt = now();
    nextAt = lastAt + gap();
    schedule();
  }

  /** Config changed (the menu switch): arm or drop the timer without losing the cooldown. */
  function refresh() {
    if (!running) return;
    if (!enabled()) {
      clear();
      return;
    }
    if (timer === null) {
      if (nextAt <= now()) nextAt = now() + gap(); // just switched back on: don't fire at once
      schedule();
    }
  }

  function stop() {
    running = false;
    clear();
  }

  function opened() { waiting = true; }
  function heard() { waiting = false; ignored = 0; }
  function missed() {
    if (!waiting) return;
    waiting = false;
    ignored += 1;
    if (ignored >= 2) {
      ignored = 0;
      try { onIgnored?.(pick('atencion')); } catch (err) { onError(err, 'ignored'); }
    }
  }

  return {
    start,
    stop,
    refresh,
    observe,
    active: () => running && enabled(),
    context: () => context,
    opened,
    heard,
    missed,
  };
}

module.exports = { createComments, DEFAULT_MIN_MS, DEFAULT_MAX_MS };
