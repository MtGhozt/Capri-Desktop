'use strict';

// Her hello when she boots. The sidecar renders each one once with OmniVoice and keeps it in
// voice/models/omnivoice/greet-N.wav, so the next boot says it instantly. `id` is what names
// that file: don't renumber them.

const GREETINGS = [
  { id: 'greet-1', text: '¡Hola, humanito! ¿Me extrañaste?' },
  { id: 'greet-2', text: 'Bueno, bueno… ya llegué. Que empiece la diversión.' },
  { id: 'greet-3', text: '¡Hola! Seamos mejores amigos hoy también, ¿sí?' },
  { id: 'greet-4', text: 'Ya estoy aquí, tontito. ¿Qué hacemos?' },
];

/** A greeting at random, never the one from last boot. */
function pickGreeting({ last = null, random = Math.random } = {}) {
  const fresh = GREETINGS.filter((item) => item.id !== last);
  const from = fresh.length ? fresh : GREETINGS;
  const index = Math.min(from.length - 1, Math.max(0, Math.floor(random() * from.length)));
  return from[index];
}

module.exports = { GREETINGS, pickGreeting };
