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
      'Instalá Python 3.11 y marcá "Add to PATH".',
      'Abrí la carpeta de voz.',
      'Escribí powershell en la barra de direcciones del Explorador y dale Enter.',
      { text: 'Corré el instalador:', command: 'powershell -ExecutionPolicy Bypass -File .\\setup.ps1' },
      'Elegí esa carpeta con "Elegir carpeta…".',
    ],
  },
  voice: {
    title: 'Respuesta con voz',
    section: 'hearing',
    note: 'Pronto esto se instalará con un botón; por ahora es manual:',
    steps: [
      {
        text: 'Instalá OmniVoice (se recomienda una GPU NVIDIA):',
        command: 'powershell -ExecutionPolicy Bypass -File .\\setup.ps1 -OmniVoice',
      },
      'Elegí VOZ en Respuesta.',
      'Para una voz propia, poné un .wav corto y limpio y un .txt con su transcripción exacta en voice\\ref.',
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
