'use strict';

// "¿Qué sabés hacer?": a short spoken summary, no model. Each line is kept only while the
// command behind it still parses, so the list cannot drift from what she actually does.

const { normalizeCommandText } = require('./command-text');
const { parseReminderCommand } = require('./reminders');
const { parseMusicCommand } = require('./music-command');
const { parsePcCommand } = require('./pc-actions');
const { parseQuickSearch } = require('./quick-search');

const ABILITIES_RE = /^(?:(?:que sabes|que podes) hacer(?: .*)?|en que me ayudas|ayuda)$/;

const CAPABILITIES = [
  ['Anoto recordatorios y los paso a Google Calendar.', () => Boolean(parseReminderCommand('recordame en 5 minutos'))],
  ['Controlo la música en Spotify, YouTube Music y Namida.', () => parseMusicCommand('pon música')?.action === 'start'],
  ['Hago cosas en la PC: volumen, tema, ventanas, archivos y apps.', () => parsePcCommand('subí el volumen')?.kind === 'volume'],
  ['Te busco en Google o Spotify: «buscame X en Google».', () => Boolean(parseQuickSearch('buscame pizza en google'))],
  ['En juegos me pongo en No molestar.', () => typeof require('./game-mode').createGameMode === 'function'],
];

const isAbilitiesCommand = (text) => ABILITIES_RE.test(normalizeCommandText(text));

function abilitiesLines() {
  return CAPABILITIES.filter(([, works]) => works()).map(([line]) => line);
}

module.exports = { isAbilitiesCommand, abilitiesLines };
