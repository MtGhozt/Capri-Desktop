'use strict';

const { normalizeCommandText } = require('./command-text');
const { plainKey, appKeys } = require('./apps-config');

// What Whisper and the chat box actually write. normalizeCommandText drops accents and
// punctuation, and Whisper often spells "despausa" as "despauza".
const DEFAULT_HER_SONG = "I'm in love with myself";
const HER_SONG = /^(?:(?:pon|ponme|reproduce|reproduceme|toca|play) )?(?:tu cancion(?: favorita)?|your song)$/;
const SONG = '(?: (?:la |el )?(?:musica|cancion|tema|rola|pista))?';
// Accents are already folded, so poné/ponés/reproducí/tocá arrive as pone/pones/reproduci/toca.
const PLAY_VERB = '(?:pon|ponme|pone|pones|poneme|reproduce|reproduceme|reproduci|toca)';
const GENERIC_PLAY = new RegExp(
  `^(?:${PLAY_VERB}(?: reproducir)? )?`
  + '(?:cualquier (?:cancion|tema|rola|musica)|algo de musica|un poco de musica)$',
);
// Pause before any "pon <query>" search: "pon pausa a la música" is pause, not a song named pausa.
const PAUSE = new RegExp(
  `^(?:`
  + `(?:pausa|pausala|pausar|para|deten|detene|stop)${SONG}`
  + `|(?:pon|ponme|pone) pausa(?: a(?: la)? musica)?`
  + `|(?:pon|ponme|pone)(?: la)? musica en pausa`
  + `|(?:pon|ponme|pone)(?:la|le)? en pausa(?: a(?: la)? musica)?`
  + `|(?:apaga|apague|apago)(?:me)?(?: la)? musica`
  + `)$`,
);
const PATTERNS = [
  ['pause', PAUSE],
  ['play', new RegExp(`^(?:sigue|seguir|continua|reanuda|resume|despausa|despauza|despausala|despauzala|quita (?:la )?pausa|dale play|play)${SONG}$`)],
  // next needs siguiente/otra/próxima or canción/tema/rola — bare pasa/cambia/salta → LLM
  ['next', new RegExp(
    `^(?:`
    + `(?:pasa|pon|cambia|salta)(?: a)? (?:la |el )?(?:siguiente|otra|proxima)${SONG}`
    + `|(?:la |el )?(?:siguiente|proxima)${SONG}`
    + `|(?:pasa|cambia|salta)(?: a)? (?:la |el )?(?:cancion|tema|rola|pista)`
    + `|otra (?:cancion|rola)|skip`
    + `)$`,
  )],
  ['previous', new RegExp(`^(?:(?:pon|regresa|vuelve)(?: a)? (?:la |el )?(?:anterior|de antes)${SONG}|(?:la |el )?anterior${SONG}|la de antes)$`)],
  // system master volume is pc-actions; music session only when she names the music
  ['volumeUp', /^(?:(?:sube|subi)(?:le)?(?: (?:el )?volumen)?(?: de)? la musica|mas(?: alto| volumen)(?: de)? la musica)$/],
  ['volumeDown', /^(?:(?:baja|baje)(?:le)?(?: (?:el )?volumen)?(?: de)? la musica|menos(?: alto| volumen)(?: de)? la musica)$/],
  // system mute/unmute ("silencio", "mute") is pc-actions; music only when she names the music
  ['mute', /^(?:(?:silencio|silencia|mutea|mute)(?: de)? la musica|quita(?: el )?sonido(?: de)? la musica)$/],
  ['unmute', /^(?:(?:desmutea|unmute|quita(?: el )?silencio|restaura(?: el )?sonido|activa(?: el )?sonido)(?: de)? la musica)$/],
  ['start', /^(?:pon|ponme|pone|pones|reproduce|reproduceme|toca|quiero|inicia)(?: algo de| un poco de)? musica(?: en namida)?$/],
  ['start', GENERIC_PLAY],
  // before the generic "abre <app>": the player is whatever MÚSICA has chosen, not a fixed app
  ['open', /^(?:abre|abri|abreme|abrime|abrir|open)(?: (?:el|la|the))? (?:reproductor(?: de musica)?|player|musica|music(?: player)?)$/],
  ['nowPlaying', /^(?:que (?:esta sonando|suena)|que cancion (?:es esta|es|suena))$/],
];

function isKnownAppName(query, apps) {
  const key = plainKey(query);
  if (!key || !Array.isArray(apps) || !apps.length) return false;
  return apps.some((app) => appKeys(app).includes(key));
}

function parseMusicCommand(text, { herSong = DEFAULT_HER_SONG, apps = [] } = {}) {
  const raw = String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const parsed = parts.map((part) => parseMusicCommand(part, { herSong, apps }));
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
  const spotify = new RegExp(`^(?:${PLAY_VERB}|play) (?:reproducir )?(.+?) en spotify$`).exec(value);
  if (spotify) return { action: 'query', query: spotify[1], player: 'spotify' };
  const playEn = /^play (?!music(?:a)?$)(.+)$/.exec(value);
  if (playEn) {
    const q = playEn[1].replace(/^en\s+/, '');
    if (isKnownAppName(q, apps)) return null;
    return { action: 'query', query: q };
  }
  // not a song search: timers/reminders, theme/volume/brightness, known Mis apps ("poné Discord")
  const query = new RegExp(
    `^(?:${PLAY_VERB}) (?:reproducir )?(?!un timer|una alarma|el timer|la alarma`
    + `|timer|alarma|aviso|recordatorio`
    + `|(?:el )?(?:modo|tema) (?:claro|oscuro)|(?:el )?volumen|brillo)(.+)$`,
  ).exec(value);
  if (query) {
    const q = query[1].replace(/^en\s+/, '').trim();
    if (isKnownAppName(q, apps)) return null;
    return { action: 'query', query: q };
  }
  return null;
}

module.exports = { parseMusicCommand, DEFAULT_HER_SONG };
