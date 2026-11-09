'use strict';

// Direct commands that wipe her memory of the conversation, without the LLM: the same as the
// "Olvidar conversación" row in her menu.

const { normalizeCommandText } = require('./command-text');

// "memoria" alone / "memoria RAM" goes to the LLM; only "tu memoria" or conversación/charla/chat/todo
const FORGET_RE = new RegExp(
  [
    '^(?:olvida|borra|limpia)(?:me)? (?:la |el )?(?:conversacion|charla|chat|todo)$',
    '^(?:olvida|borra|limpia)(?:me)? tu memoria$',
    '^olvidate de (?:todo|la conversacion|la charla|el chat)$',
  ].join('|'),
);

const isForgetCommand = (text) => FORGET_RE.test(normalizeCommandText(text).replace(/\s+por favor$/, '').trim());

module.exports = { isForgetCommand };
