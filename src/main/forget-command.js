'use strict';

// Direct commands that wipe her memory of the conversation, without the LLM: the same as the
// "Olvidar conversación" row in her menu.

const { normalizeCommandText } = require('./command-text');

const FORGET_RE = new RegExp(
  [
    '\\b(?:olvida|borra|limpia)\\s+(?:la|el|tu)?\\s*(?:conversacion|charla|memoria|chat|todo)\\b',
    '\\bolvidate\\s+de\\s+(?:todo|la\\s+conversacion|la\\s+charla|el\\s+chat)\\b',
  ].join('|'),
);

const isForgetCommand = (text) => FORGET_RE.test(normalizeCommandText(text));

module.exports = { isForgetCommand };
