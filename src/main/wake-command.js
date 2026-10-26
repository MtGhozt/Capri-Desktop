'use strict';

// Direct wake commands, without the LLM: the wake word and a click on her widget already bring
// her back; this is for waking her from the chat box ("despierta", "¿estás ahí?").

const { normalizeCommandText } = require('./command-text');

const WAKE_RE = /^(?:hey\s+)?(?:despierta|despertate|desperta|estas\s+ahi|estas\s+despierta|volviste)(?:\s+ya)?$/;

const isWakeCommand = (text) => WAKE_RE.test(normalizeCommandText(text));

module.exports = { isWakeCommand };
