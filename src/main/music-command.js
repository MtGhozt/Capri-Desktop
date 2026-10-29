'use strict';

const { normalizeCommandText } = require('./command-text');

// What Whisper and the chat box actually write. normalizeCommandText drops accents and
// punctuation, and Whisper often spells "despausa" as "despauza".
const DEFAULT_HER_SONG = "I'm in love with myself";
const HER_SONG = /^(?:(?:pon|ponme|reproduce|reproduceme|toca|play) )?(?:tu cancion(?: favorita)?|your song)$/;
const SONG = '(?: (?:la |el )?(?:musica|cancion|tema|rola|pista))?';
const PATTERNS = [
  ['pause', new RegExp(`^(?:pausa|pausala|pausar|para|deten|stop)${SONG}$`)],
  ['play', new RegExp(`^(?:sigue|seguir|continua|reanuda|resume|despausa|despauza|despausala|despauzala|quita (?:la )?pausa|dale play|play)${SONG}$`)],
  ['next', new RegExp(`^(?:(?:pasa|pon|cambia|salta)(?: a)? (?:la |el )?(?:siguiente|otra|proxima)${SONG}|(?:la |el )?(?:siguiente|proxima)${SONG}|(?:pasa|cambia|salta)${SONG}|otra (?:cancion|rola)|skip)$`)],
  ['previous', new RegExp(`^(?:(?:pon|regresa|vuelve)(?: a)? (?:la |el )?(?:anterior|de antes)${SONG}|(?:la |el )?anterior${SONG}|la de antes)$`)],
  ['volumeUp', /^(?:sube(?: la musica| el volumen)?|subele|mas(?: alto| volumen))$/],
  ['volumeDown', /^(?:baja(?: la musica| el volumen)?|bajale|menos(?: alto| volumen))$/],
  ['mute', /^(?:silencio|silencia(?: la musica)?|mutea(?: la musica)?|mute|quita(?: el )?sonido)$/],
  ['start', /^(?:pon|ponme|pone|reproduce|reproduceme|toca|quiero|inicia)(?: algo de| un poco de)? musica(?: en namida)?$/],
  // before the generic "abre <app>": the player is whatever MÚSICA has chosen, not a fixed app
  ['open', /^(?:abre|abreme|abrime|abrir|open)(?: (?:el|la|the))? (?:reproductor(?: de musica)?|player|musica|music(?: player)?)$/],
  ['nowPlaying', /^(?:que (?:esta sonando|suena)|que cancion (?:es esta|es|suena))$/],
];

function parseMusicCommand(text, { herSong = DEFAULT_HER_SONG } = {}) {
  const raw = String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const parsed = parts.map((part) => parseMusicCommand(part, { herSong }));
    if (parsed.every((item) => item && item.action === parsed[0].action)) return parsed[0];
  }
  const value = normalizeCommandText(text).replace(/\s+por favor$/, '').trim();
  if (!value) return null;
  for (const [action, re] of PATTERNS) if (re.test(value)) return { action };
  // her song: before generic "pon X" / "play X", so "tu canción" is not a search for those words
  if (HER_SONG.test(value)) {
    const query = String(herSong || '').trim() || DEFAULT_HER_SONG;
    return { action: 'query', query, herSong: true };
  }
  const spotify = /^(?:pon|ponme|reproduce|toca|play) (.+?) en spotify$/.exec(value);
  if (spotify) return { action: 'query', query: spotify[1], player: 'spotify' };
  const playEn = /^play (?!music(?:a)?$)(.+)$/.exec(value);
  if (playEn) return { action: 'query', query: playEn[1].replace(/^en\s+/, '') };
  const query = /^(?:pon|ponme|reproduce|reproduceme|toca) (?!un |una |el timer|la alarma)(.+)$/.exec(value);
  if (query) return { action: 'query', query: query[1].replace(/^en\s+/, '') };
  return null;
}

module.exports = { parseMusicCommand, DEFAULT_HER_SONG };
