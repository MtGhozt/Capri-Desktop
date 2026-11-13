'use strict';

// One short bubble the first time she boots after an update, plus "¿qué hay de nuevo?" on demand.
// Add the lines for each release here; a version with no entry says nothing.

const { normalizeCommandText } = require('./command-text');

const NOTES = {
  '0.2.10': [
    'Sin la casilla de OmniVoice hablo directo con la voz normal: sin «Cargando voz…» ni aviso de Torch.',
    'Si abrís Capri dos veces o hay un proceso de voz colgado, espero y sigo con tu voz clonada, no con la normal.',
    'Reinstalar la voz desde Ajustes ya arregla la clonada, y el aviso dice qué hacer (marcar OmniVoice, requiere NVIDIA).',
    'Mi risa suena a «ja, ja, ja», no a una "a" larga.',
  ],
  '0.2.9': [
    'Capri hace cosas en tu PC: volumen, ajustes de Windows, tema claro/oscuro, batería, disco, RAM e IP.',
    '«Recortá la pantalla» abre el recorte de Windows.',
    'Ordená ventanas: «poné Discord a la izquierda y Chrome a la derecha», maximizar, minimizar o restaurar.',
    'Buscá archivos en tus carpetas y Capri te los muestra en el Explorador.',
    '«Callate» corta la voz al instante, y los comandos chocan menos entre sí.',
    'La versión se ve en el chat y en Ajustes, para reportar errores más fácil.',
  ],
  '0.2.8': [
    'Clima/feriados en carácter; si el modelo falla, te contesto igual sin cartel de error.',
    'Recordatorios con aviso previo, editor en Ajustes y formato 12h/24h en Comportamiento.',
    'Clip: ShadowPlay en NVIDIA, o Win+Alt+G (Xbox Game Bar) si no hay NVIDIA.',
    'Menú más fluido y voz más estable; al mirar la pantalla uso el monitor de adelante.',
  ],
  '0.2.7': [
    'Volví a Gemini gratis y, si preguntás qué modelo soy, te digo el mío real; tu modelo elegido a mano no se toca.',
    'Los recordatorios ya se decían en voz alta desde la 0.2.6; ahora, si la voz falla, la burbuja igual aparece.',
    'Vuelvo a usar tu GPU compatible para clonar voz; armar la tuya son 2 pasos: .wav, escribir qué dice y guardar.',
  ],
  '0.2.6': [
    'Ahora uso la hora de tu país, y la podés elegir en Ajustes.',
    'Podés pedirme timers y recordatorios por voz, y te esperan aunque cierres Capri.',
    'La primera vez que bajo mi voz te lo digo claro, y el texto aparece aunque la voz tarde.',
  ],
  '0.2.5': [
    'Ahora entiendo varios comandos en una frase, y Spotify entiende más frases y reintenta si falla.',
    'Si la GPU no alcanza para clonar voz te aviso, y tu voz personalizada queda en 2 pasos.',
    'Claude Code se detecta aunque no esté en el PATH, y mis respuestas tienen más contexto.',
  ],
  '0.2.4': [
    'Groq y Mistral volvieron, y los atajos se editan desde mi menú.',
    'Namida te dice qué suena, Mis apps abre carpetas y ya sé cómo llamarte.',
    'Diagnóstico + Abrir log para reportar, y las caricias ahora ronronean (3 seguidas me fastidian).',
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
