'use strict';

// Several orders in one breath: "minimiza todo y ve a dormir". The line is split on the
// connectors Whisper and the chat box write, and it only counts when EVERY part is already a
// direct command: half an order is not an order, so a mixed line goes to the model whole
// (no partial execution). Sleeping always runs last, even when it was said first.

const { isSleepCommand } = require('./sleep-command');

// "y", "e", "luego", "después" (and "y luego"), commas and semicolons; "then" from English.
const CONNECTOR = /\s*[,;]+\s*|\s+(?:y\s+(?:luego|despues|después)|luego|despues|después|y|e|then)\s+/i;
const MAX_PARTS = 4;

/** The pieces between connectors, trimmed: "a y b, luego c" -> [a, b, c]. */
function splitCommands(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parts = raw.split(CONNECTOR).map((p) => p.trim()).filter(Boolean);
  // past a few parts it's a sentence, not a list of orders
  return parts.length >= 2 && parts.length <= MAX_PARTS ? parts : [raw];
}

/** The parts with every sleep order moved to the end, keeping their order otherwise. */
function sleepLast(parts) {
  return [...parts.filter((p) => !isSleepCommand(p)), ...parts.filter((p) => isSleepCommand(p))];
}

/** The parts to run in order, or null when the line is not a pure multi-command. */
function planMultiCommand(text, isDirect) {
  const parts = splitCommands(text);
  if (parts.length < 2 || !parts.every((part) => isDirect(part))) return null;
  return sleepLast(parts);
}

/**
 * Collapse consecutive window snaps into one run so combineWindowResults speaks once.
 * `getAction(segment)` → parsePcCommand result (or null). Non-window parts stay as `{ segment }`.
 */
function coalesceWindowRuns(segments, getAction) {
  const out = [];
  let i = 0;
  const parts = Array.isArray(segments) ? segments : [];
  while (i < parts.length) {
    const action = typeof getAction === 'function' ? getAction(parts[i]) : null;
    if (action?.kind === 'window') {
      const snaps = [];
      while (i < parts.length) {
        const w = getAction(parts[i]);
        if (w?.kind !== 'window') break;
        if (Array.isArray(w.snaps) && w.snaps.length) {
          for (const s of w.snaps) if (s) snaps.push(s);
        } else {
          snaps.push(w);
        }
        i += 1;
      }
      out.push({
        kind: 'window',
        snaps,
        value: snaps.map((s) => `${s.app || ''}|${s.position || ''}`).join('+'),
      });
      continue;
    }
    out.push({ kind: 'segment', text: parts[i] });
    i += 1;
  }
  return out;
}

module.exports = { splitCommands, sleepLast, planMultiCommand, coalesceWindowRuns };
