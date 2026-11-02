// The "?" steps in Ajustes, one object so every panel is edited in one place. A step is a line of
// text, or { text, command } when there is a command to copy.

export const HELP_STEPS = {
  spotify: {
    title: 'Spotify',
    section: 'music',
    steps: [
      'Creá una app en developer.spotify.com/dashboard.',
      'Agregá el redirect http://127.0.0.1:47835/callback.',
      'Copiá el Client ID y pegalo acá abajo.',
      'Tocá CONECTAR y aceptá en el navegador.',
      'Sin Premium, Capri solo puede abrir la app de Spotify; no puede controlar la reproducción.',
    ],
  },
  hearing: {
    title: 'Escuchar (voz de entrada)',
    section: 'hearing',
    steps: [
      'Tocá «Instalar voz» en Ajustes → AUDIO (pide Python 3.11 si falta).',
      'La carpeta queda en %LOCALAPPDATA%\\capri-desktop\\voice y sobrevive al actualizar Capri.',
      'Fallback manual: Python 3.11 con "Add to PATH", abrí la carpeta de voz y corré setup.ps1.',
    ],
  },
  voice: {
    title: 'Respuesta con voz',
    section: 'hearing',
    note: 'Sin tu archivo, Capri usa la voz por defecto (OmniVoice voice-design). No se descarga audio clonado.',
    steps: [
      'Tocá «Instalar voz» (OmniVoice con GPU NVIDIA; casilla si no hay NVIDIA).',
      'Elegí VOZ en Respuesta.',
      'Opcional: «Usar mi propia voz…» — un .wav de 5–15 s y su transcripción exacta.',
      'Fallback manual: setup.ps1 -OmniVoice y, si querés clone, ref\\mi.wav + ref\\mi.txt.',
    ],
  },
  brain: {
    title: 'Cerebro',
    section: 'model',
    steps: [
      'Gemini es la opción gratis recomendada: sacá una key en aistudio.google.com.',
      'Pegala en el casillero de Gemini.',
      'LM Studio solo si está instalado.',
      'Las opciones de agente necesitan ese agente instalado.',
    ],
  },
};

// Only one help panel at a time: opening another closes the previous one.
export function toggleHelp(open, id) {
  return open === id ? null : id;
}
