'use strict';

// "Is this whole line a direct command?", with the same detectors the chat:send ladder runs in
// main.js, but only reading: nothing here opens, closes, sleeps or asks. The splitter
// (multi-command.js) needs it to test each part before running any of them.
// "mirá mi pantalla" is left out: the look is tied to the model turn in chat:send.

const { parseFixCommand } = require('./fix-command');
const { parseNameCommand } = require('./name-command');
const { isWhatsNewCommand } = require('./whats-new');
const { parseSystemCommand } = require('./system-command');
const { parseMusicCommand } = require('./music-command');
const { isSleepCommand } = require('./sleep-command');
const { isQuitCommand } = require('./quit-command');
const { isClipCommand } = require('./clip-command');
const { isMuteCommand, isUnmuteCommand } = require('./mic-command');
const { isForgetCommand } = require('./forget-command');
const { isWakeCommand } = require('./wake-command');
const { parseAppCommand, planAppCommand } = require('./app-command');

function isDirectCommand(text, apps = []) {
  return Boolean(
    parseFixCommand(text)
    || parseNameCommand(text)
    || isWhatsNewCommand(text)
    || parseSystemCommand(text)
    || parseMusicCommand(text)
    || isSleepCommand(text)
    || isQuitCommand(text)
    || isClipCommand(text)
    || isMuteCommand(text)
    || isUnmuteCommand(text)
    || isForgetCommand(text)
    || isWakeCommand(text)
    || planAppCommand(parseAppCommand(text, apps)),
  );
}

module.exports = { isDirectCommand };
