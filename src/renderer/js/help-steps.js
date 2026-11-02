// The "?" steps in Ajustes, one object so every panel is edited in one place. A step is a line of
// text, or { text, command } when there is a command to copy. URLs in text become clickable links
// (main opens them with shell.openExternal after http/https allowlist checks).

const HELP_URL_RE = /https?:\/\/[^\s<>"'\)\]]+/gi;

/** Split help copy into plain text and URL parts (trailing .,;:!? ) stripped from URLs). */
export function splitHelpText(text) {
  const s = String(text || '');
  const parts = [];
  let last = 0;
  for (const match of s.matchAll(HELP_URL_RE)) {
    const raw = match[0];
    let url = raw;
    while (/[.,;:!?)]$/.test(url)) url = url.slice(0, -1);
    if (!url) continue;
    const index = match.index;
    if (index > last) parts.push({ type: 'text', value: s.slice(last, index) });
    parts.push({ type: 'url', value: url });
    last = index + url.length;
  }
  if (last < s.length) parts.push({ type: 'text', value: s.slice(last) });
  return parts.length ? parts : [{ type: 'text', value: s }];
}

export const HELP_STEPS = {
  spotify: {
    title: 'Spotify',
    section: 'music',
    steps: [
      'Abrí el navegador (Chrome, Edge, etc.) y andá a https://developer.spotify.com/dashboard. Iniciá sesión con la misma cuenta de Spotify que usás en la PC.',
      'Tocá “Create app”. Poné un nombre cualquiera (por ejemplo Capri), aceptá los términos y creá la app.',
      {
        text: 'En la app, buscá Redirect URIs y agregá exactamente esta dirección (copiála; un carácter de más y falla):',
        command: 'http://127.0.0.1:47835/callback',
      },
      'Guardá los cambios. Copiá el Client ID (un código largo) y pegalo en Ajustes → MÚSICA → Spotify, en el casillero de Client ID.',
      'Tocá CONECTAR. Se abre el navegador otra vez: aceptá los permisos. Cuando vuelvas a Capri, deberías ver Spotify conectado.',
      'Si el navegador dice que el redirect no coincide: volvé al dashboard, revisá que la URI sea exactamente la de arriba (http, 127.0.0.1, puerto 47835) y guardá de nuevo.',
      'Sin Spotify Premium, Capri solo puede abrir la app de Spotify; no puede pausar, saltar ni buscar canciones. Con Premium sí controla la reproducción.',
    ],
  },
  hearing: {
    title: 'Escuchar (voz de entrada)',
    section: 'hearing',
    note: 'Capri necesita Python 3.11 y la carpeta de voz para oírte. El audio no sale de tu PC.',
    steps: [
      'La forma fácil: en Ajustes → AUDIO tocá «Instalar voz». Si falta Python, Capri te manda a bajarlo.',
      {
        text: 'Si te pide Python 3.11: descargalo desde esta página (Windows installer 64-bit). En el instalador marcá la casilla “Add python.exe to PATH” antes de Install Now. Sin eso, Capri no lo encuentra.',
        command: 'https://www.python.org/downloads/release/python-3119/',
      },
      'Cerrá y abrí Capri de nuevo. Volvé a Ajustes → AUDIO → «Instalar voz». Deberías ver progreso (descarga / setup). Cuando termine, la carpeta queda en:',
      {
        text: 'Ruta de la voz (sobrevive al actualizar Capri):',
        command: '%LOCALAPPDATA%\\capri-desktop\\voice',
      },
      'Fallback manual si el botón falla: abrí el Explorador de archivos y pegá esa ruta en la barra de dirección. Enter.',
      'En esa carpeta, hacé clic en la barra de dirección del Explorador, escribí powershell y Enter. Se abre PowerShell ya dentro de voice\\.',
      {
        text: 'En PowerShell corré (con GPU NVIDIA usá OmniVoice; tarda y baja varios GB):',
        command: '.\\setup.ps1 -OmniVoice',
      },
      {
        text: 'Sin NVIDIA, o solo para oír (STT) sin clone caro:',
        command: '.\\setup.ps1',
      },
      'La primera vez baja modelos (varios GB). Dejá la ventana abierta. Si ves errores de py -3.11: reinstalá Python marcando Add to PATH y reiniciá la PC.',
      'En Ajustes → AUDIO (OÍDO) elegí el micrófono correcto. Decí “Hey Capri” o usá el atajo de hablar. Si no te oye: Windows → Configuración → Privacidad → Micrófono, permití a Capri / escritorio.',
      {
        text: 'Si algo falla, abrí los logs y el config acá (Explorador → pegá en la barra de dirección):',
        command: '%APPDATA%\\capri-desktop',
      },
      'Adentro están config.json y la carpeta logs\\ (voice.log). En Discord, canal #errores-bugs, pegá el final de voice.log y qué estabas haciendo. Invitación: https://discord.gg/wmVfYdjpdA',
    ],
  },
  voice: {
    title: 'Respuesta con voz',
    section: 'hearing',
    note: 'Sin tu archivo, Capri usa la voz por defecto (OmniVoice voice-design). No se descarga audio clonado de terceros.',
    steps: [
      'Instalá la voz como en el «?» de Escuchar (Instalar voz o setup.ps1). Para hablar con OmniVoice necesitás GPU NVIDIA y el setup con -OmniVoice.',
      {
        text: 'En PowerShell, dentro de la carpeta voice, el comando completo es:',
        command: '.\\setup.ps1 -OmniVoice',
      },
      'Eso descarga varios GB (PyTorch + modelos). La primera vez que Capri carga OmniVoice, en la burbuja vas a ver “cargando voz…” y puede tardar uno o dos minutos. Después ya contesta con voz.',
      'En Ajustes → AUDIO → Respuesta elegí VOZ (no Blips ni Silencio).',
      'Para usar TU voz: en la carpeta voice, si no existe la carpeta ref, creala (clic derecho → Nuevo → Carpeta → nombre exacto ref).',
      'Grabá un .wav limpio de 5 a 15 segundos, una sola persona hablando, sin música de fondo. Nombres SIN espacios, por ejemplo mi_voz.wav.',
      'Al lado, un .txt con el MISMO nombre (mi_voz.txt) y adentro la transcripción exacta de lo que se oye en el wav, palabra por palabra.',
      'En Capri: Ajustes → AUDIO → «Usar mi propia voz…», elegí el .wav y pegá o confirmá la transcripción. (Avanzado: en config.json, voice.ttsRef con la ruta al wav.)',
      {
        text: 'Si no tenés clips de humor (burla, emoción, etc.), abrí config.json y poné ttsMoods en null para que no busque archivos que no existen:',
        command: '"ttsMoods": null',
      },
      {
        text: 'config.json y logs viven en:',
        command: '%APPDATA%\\capri-desktop',
      },
      'Si la voz no carga: mirá logs\\voice.log. Si dice VRAM baja u omnivoice skipped, cerrá juegos/Chrome pesado o usá Kokoro / Blips. Para pedir ayuda: Discord #errores-bugs (https://discord.gg/wmVfYdjpdA) con el final del log.',
    ],
  },
  brain: {
    title: 'Cerebro',
    section: 'model',
    steps: [
      'Gemini es la opción gratis recomendada. Abrí https://aistudio.google.com/apikey en el navegador, iniciá sesión con Google y creá una API key.',
      'Copiá la key. En Capri: Ajustes → CEREBRO → Gemini, pegala en el casillero y guardá / probá la conexión.',
      'Si la key es rechazada: regenerá otra en AI Studio, asegurate de pegarla sin espacios al inicio o al final, y que el proyecto tenga la API de Gemini habilitada.',
      'LM Studio solo hace falta si elegís el cerebro “local”: tiene que estar instalado, con el servidor encendido (en esta PC suele ser el puerto 1235) y un modelo cargado.',
      'Las opciones de agente (Cursor, Claude Code, etc.) solo aparecen / funcionan si ese programa está instalado en tu PC.',
      {
        text: 'Si Capri no contesta: revisá Ajustes → CEREBRO (proveedor y key) y el log:',
        command: '%APPDATA%\\capri-desktop\\logs\\voice.log',
      },
    ],
  },
};

// Only one help panel at a time: opening another closes the previous one.
export function toggleHelp(open, id) {
  return open === id ? null : id;
}
