'use strict';

// "callate", "dejá de hablar": stop speaking without touching master mute or the mic.

const { normalizeCommandText } = require('./command-text');

function isStopTtsCommand(text) {
  const said = normalizeCommandText(text).replace(/\s+por favor$/, '').trim();
  if (!said) return false;
  return /^(?:callate(?: capri)?|calla|deja de hablar|para de hablar)$/.test(said);
}

module.exports = { isStopTtsCommand };
