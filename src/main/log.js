'use strict';

// Capri's log: one line per event, local time, and voice.log rolls over at 5 MB keeping two
// files (voice.log and voice.log.1). The voice sidecar prints; only this process writes the
// file, so a sidecar event can never land twice.

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 5 * 1024 * 1024;

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// An event is one line: the sidecar's own output can arrive in chunks of several.
function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// voice.log + voice.log.1: the older one goes when the live one reaches 5 MB.
function rotate(file, maxBytes = MAX_BYTES) {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return; // no log yet
  }
  if (size < maxBytes) return;
  try { fs.rmSync(`${file}.1`, { force: true }); } catch { /* locked */ }
  try {
    fs.renameSync(file, `${file}.1`);
  } catch {
    try { fs.truncateSync(file, 0); } catch { /* locked */ }
  }
}

/** Writes one timestamped line; returns false when there was nothing to say. */
function logEvent(file, text, { maxBytes = MAX_BYTES, now = new Date() } = {}) {
  const line = oneLine(text);
  if (!line) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotate(file, maxBytes);
    fs.appendFileSync(file, `${stamp(now)} ${line}\n`);
  } catch {
    return false; // disk full / locked: she keeps working without a log
  }
  return true;
}

/** One line per event, for a chunk of sidecar output that may hold several. */
function logLines(file, text, options) {
  let wrote = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    if (raw.trim() && logEvent(file, raw, options)) wrote = true;
  }
  return wrote;
}

function voiceLogPath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'logs', 'voice.log');
}

module.exports = { MAX_BYTES, stamp, oneLine, rotate, logEvent, logLines, voiceLogPath };
