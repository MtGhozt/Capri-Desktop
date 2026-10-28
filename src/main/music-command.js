'use strict';

const { normalizeCommandText } = require('./command-text');

const EXACT = new Map([
  ['pausa', 'pause'], ['pausa la musica', 'pause'],
  ['sigue', 'play'], ['reanuda', 'play'], ['dale play', 'play'],
  ['siguiente', 'next'], ['la siguiente', 'next'], ['pasa la cancion', 'next'],
  ['anterior', 'previous'], ['la de antes', 'previous'],
  ['sube el volumen', 'volumeUp'], ['baja el volumen', 'volumeDown'],
  ['silencio', 'mute'], ['mutea', 'mute'],
  ['pon musica', 'start'],
  ['que esta sonando', 'nowPlaying'],
]);

function parseMusicCommand(text) {
  const value = normalizeCommandText(text);
  if (EXACT.has(value)) return { action: EXACT.get(value) };
  const spotify = /^pon\s+(.+?)\s+en\s+spotify$/.exec(value);
  if (spotify) return { action: 'query', query: spotify[1], player: 'spotify' };
  const query = /^pon\s+(.+)$/.exec(value);
  if (query && query[1] !== 'musica') return { action: 'query', query: query[1] };
  return null;
}

module.exports = { parseMusicCommand };
