'use strict';

// One short bubble the first time she boots after an update, plus "¿qué hay de nuevo?" on demand.
// Add the lines for each release here; a version with no entry says nothing.

const { normalizeCommandText } = require('./command-text');

const NOTES = {
  '0.2.4': [
    'Los atajos ahora se editan desde mi menú, sin tocar archivos.',
    'Con Namida te digo qué está sonando.',
    'Mis apps abre carpetas y archivos, y ahora te pregunto cómo llamarte.',
  ],
};

const WHATS_NEW_RE = /^(?:que\s+hay\s+de\s+nuevo|novedades|que\s+cambio|que\s+trae\s+(?:esta\s+|la\s+)?(?:version|actualizacion))\b/;

/** The lines for `version`, or null when this version has nothing to say. */
function notesFor(version, notes = NOTES) {
  return notes[String(version || '').replace(/^v/i, '').trim()] || null;
}

/** What to show at boot: nothing on a fresh install, on the same version, or with no notes. */
function bootNotes({ version, lastSeenVersion, configExisted = false, notes = NOTES } = {}) {
  const seen = String(lastSeenVersion || '').trim();
  const now = String(version || '').trim();
  if (!now) return null;
  // No lastSeenVersion can also mean an upgrade from before that field existed: an existing
  // config.json proves it, so the notes are shown this one time.
  if (!seen) return configExisted ? notesFor(now, notes) : null;
  if (seen === now) return null;
  return notesFor(now, notes);
}

const isWhatsNewCommand = (text) => WHATS_NEW_RE.test(normalizeCommandText(text));

module.exports = { NOTES, notesFor, bootNotes, isWhatsNewCommand };
