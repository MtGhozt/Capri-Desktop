'use strict';

const { normalizeCommandText } = require('./command-text');

// What Whisper and the chat box actually write. normalizeCommandText drops accents and
// punctuation, and Whisper often spells "despausa" as "despauza".
const SONG = '(?: (?:la |el )?(?:musica|cancion|tema|rola|pista))?';
const PATTERNS = [
  ['pause', new RegExp(`^(?:pausa|pausala|pausar|para|deten|stop)${SONG}$`)],
  ['play', new RegExp(`^(?:sigue|seguir|continua|reanuda|resume|despausa|despauza|despausala|despauzala|quita (?:la )?pausa|dale play|play)${SONG}$`)],
  ['next', new RegExp(`^(?:(?:pasa|pon|cambia|salta)(?: a)? (?:la |el )?(?:siguiente|otra|proxima)${SONG}|(?:la |el )?(?:siguiente|proxima)${SONG}|(?:pasa|cambia|salta)${SONG}|otra (?:cancion|rola)|skip)$`)],
  ['previous', new RegExp(`^(?:(?:pon|regresa|vuelve)(?: a)? (?:la |el )?(?:anterior|de antes)${SONG}|(?:la |el )?anterior${SONG}|la de antes)$`)],
  ['volumeUp', /^(?:sube(?: el)? volumen|mas volumen)$/],
  ['volumeDown', /^(?:baja(?: el)? volumen|menos volumen)$/],
  ['mute', /^(?:silencio|mutea|mute)$/],
  ['start', /^(?:pon|ponme|pone|reproduce|reproduceme|toca|quiero|inicia)(?: algo de| un poco de)? musica(?: en namida)?$/],
  ['nowPlaying', /^(?:que (?:esta sonando|suena)|que cancion (?:es esta|es|suena))$/],
];

function parseMusicCommand(text) {
  const value = normalizeCommandText(text).replace(/\s+por favor$/, '').trim();
  if (!value) return null;
  for (const [action, re] of PATTERNS) if (re.test(value)) return { action };
  const spotify = /^(?:pon|ponme|reproduce|toca) (.+?) en spotify$/.exec(value);
  if (spotify) return { action: 'query', query: spotify[1], player: 'spotify' };
  const query = /^(?:pon|ponme|reproduce|reproduceme|toca) (?!un |una |el timer|la alarma)(.+)$/.exec(value);
  if (query) return { action: 'query', query: query[1] };
  return null;
}

module.exports = { parseMusicCommand };
