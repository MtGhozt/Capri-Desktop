'use strict';

// Direct commands for her microphone, without the LLM: the same as her Micrófono switch.

const { normalizeCommandText } = require('./command-text');

const MUTE_RE = new RegExp(
  [
    '\\b(?:apaga|mutea|silencia|corta)\\s+(?:el|tu)\\s+(?:microfono|micro|mic)\\b',
    '\\bmuteate\\b',
    '\\bdeja\\s+de\\s+escucharme\\b',
    '\\bno\\s+me\\s+escuches\\b',
  ].join('|'),
);

const UNMUTE_RE = new RegExp(
  [
    '\\b(?:prende|activa|enciende|abre|abri|conecta)\\s+(?:el|tu)\\s+(?:microfono|micro|mic)\\b',
    '\\b(?:volve|empeza)\\s+a\\s+escucharme\\b',
  ].join('|'),
);

const isMuteCommand = (text) => MUTE_RE.test(normalizeCommandText(text));
const isUnmuteCommand = (text) => UNMUTE_RE.test(normalizeCommandText(text));

module.exports = { isMuteCommand, isUnmuteCommand };
