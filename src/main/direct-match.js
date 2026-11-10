'use strict';

// Shared read-only ladder for "is this a direct command?" (multi-command splitter) and
// classify() for tests. Order must match directCommand() in main.js.

const { parseFixCommand } = require('./fix-command');
const { parseNameCommand } = require('./name-command');
const { isWhatsNewCommand } = require('./whats-new');
const { parseSystemCommand } = require('./system-command');
const { isStopTtsCommand } = require('./stop-tts-command');
const { parseReminderCommand } = require('./reminders');
const { parsePcCommand } = require('./pc-actions');
const { parseMusicCommand } = require('./music-command');
const { isSleepCommand } = require('./sleep-command');
const { isQuitCommand } = require('./quit-command');
const { isClipCommand } = require('./clip-command');
const { isMuteCommand, isUnmuteCommand } = require('./mic-command');
const { isForgetCommand } = require('./forget-command');
const { isWakeCommand } = require('./wake-command');
const { parseAppCommand, planAppCommand } = require('./app-command');
const { isLookCommand } = require('./screen-look');

/** First matching direct kind, or null (look is not direct — see classify). */
function matchDirect(text, { apps = [], herSong, timeZone } = {}) {
  if (parseFixCommand(text)) return 'fix';
  if (parseNameCommand(text)) return 'name';
  if (isWhatsNewCommand(text)) return 'whatsNew';
  if (parseSystemCommand(text)) return 'system';
  if (isStopTtsCommand(text)) return 'stopTts';
  if (parseReminderCommand(text, { timeZone })) return 'reminder';
  const pc = parsePcCommand(text, { apps });
  if (pc) {
    if (pc.kind === 'snip') return 'snip';
    if (pc.kind === 'window') return 'window';
    if (pc.kind === 'files') return 'files';
    return 'pc';
  }
  if (parseMusicCommand(text, { herSong, apps })) return 'music';
  if (isSleepCommand(text)) return 'sleep';
  if (isQuitCommand(text)) return 'quit';
  if (isClipCommand(text)) return 'clip';
  if (isMuteCommand(text)) return 'micMute';
  if (isUnmuteCommand(text)) return 'micUnmute';
  if (isForgetCommand(text)) return 'forget';
  if (isWakeCommand(text)) return 'wake';
  if (planAppCommand(parseAppCommand(text, apps))) return 'app';
  return null;
}

function isDirectCommand(text, apps = []) {
  return Boolean(matchDirect(text, { apps }));
}

/** Destination for a phrase: ladder kind, 'look', or 'llm'. */
function classify(text, opts = {}) {
  const hit = matchDirect(text, opts);
  if (hit) return hit;
  if (isLookCommand(text)) return 'look';
  return 'llm';
}

module.exports = { isDirectCommand, classify, matchDirect };
