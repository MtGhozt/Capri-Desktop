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
      'Abrí https://developer.spotify.com/dashboard e iniciá sesión con la misma cuenta de Spotify de esta PC.',
      'Tocá “Create app”, poné un nombre (ej. Capri) y creá la app.',
      {
        text: 'En Redirect URIs agregá exactamente esta dirección (copiála):',
        command: 'http://127.0.0.1:47835/callback',
      },
      'Copiá el Client ID y pegalo en Ajustes › Música / Reproductor › Client ID de Spotify. Tocá CONECTAR y aceptá los permisos.',
      'Sin Spotify Premium Capri solo abre la app; con Premium controla play, pausa, siguiente y búsqueda.',
    ],
  },
  namida: {
    title: 'Namida',
    section: 'music',
    steps: [
      'En Namida, agregá tus carpetas de música (Biblioteca / Folders) y esperá a que termine de leerlas.',
      'En Capri: Ajustes › Música / Reproductor › Reproductor = NAMIDA.',
      'En Mis apps asegurate de tener la app «Namida»; si es portable, agregá namida.exe a mano.',
      'Ejemplos: «pon música», «pon <canción>», «qué está sonando», «pausa la música», «siguiente».',
    ],
  },
  hearing: {
    title: 'Instalar voz',
    section: 'hearing',
    note: 'El audio se procesa en tu PC. No hace falta PowerShell a mano.',
    steps: [
      {
        text: 'Instalá Python 3.11 (Windows installer 64-bit). En el instalador marcá “Add python.exe to PATH” antes de Install Now:',
        command: 'https://www.python.org/downloads/release/python-3119/',
      },
      'En Capri: Ajustes › Oído y voz › «Instalar voz». Vas a ver la barra de progreso; «Ver detalles» muestra el log de la instalación.',
      'Con GPU NVIDIA se instala OmniVoice. Sin NVIDIA, la casilla «OmniVoice (mejor con GPU NVIDIA)» queda opcional (sin ella solo STT / Kokoro).',
      'Si falta el runtime: tocá «Instalar VC++ x64» o «Bajar Python 3.11» según el aviso.',
      {
        text: 'Si falla, el log está acá. Pegá el final en Discord #bugs (https://discord.gg/wmVfYdjpdA):',
        command: '%APPDATA%\\capri-desktop\\logs\\voice.log',
      },
    ],
  },
  talk: {
    title: 'Cómo hablarle',
    section: 'hearing',
    steps: [
      'Decí «Hey Capri» y después tu orden (con la voz instalada y el micrófono en ACTIVO).',
      'O usá «Tecla para hablar» en Ajustes › Oído y voz (por defecto Ctrl+Alt+V): mantené o tocá según cómo la configuraste.',
      'Para escribirle: Ctrl+Alt+T abre el chat.',
      '«Pausa antes de cortar» (CORTA · 0.8 s / NORMAL · 1.4 s / LARGA · 2.2 s) define cuánto silencio cierra la frase después de «Hey Capri».',
      '«Recortá la pantalla», «poné Discord a la izquierda», o «buscame el PDF de…» / «dónde está la foto de…» (abre la carpeta, no el archivo).',
    ],
  },
  wake: {
    title: 'El “Hey Capri” no arranca / no te entiende',
    section: 'hearing',
    note: 'Si el log dice “DLL load failed” o “Could not find module … .dll”, falta Microsoft Visual C++.',
    steps: [
      'Cerrá Capri.',
      {
        text: 'Instalá Microsoft Visual C++ Redistributable (x64), o desde Ajustes › Oído y voz tocá «Instalar VC++ x64»:',
        command: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
      },
      'Reiniciá la PC, abrí Capri y probá «Hey Capri» o «Tecla para hablar».',
      {
        text: 'Si sigue fallando, pegá el final de este log en Discord #bugs (https://discord.gg/wmVfYdjpdA):',
        command: '%APPDATA%\\capri-desktop\\logs\\voice.log',
      },
    ],
  },
  voice: {
    title: 'Respuesta con voz',
    section: 'hearing',
    note: 'OmniVoice (voz por defecto) necesita GPU NVIDIA. Sin clone propio no se baja audio de terceros.',
    steps: [
      'Instalá la voz con Ajustes › Oído y voz › «Instalar voz» (ver el «?» de Instalar voz).',
      'En Ajustes › Oído y voz › Respuesta elegí VOZ (habla), BLIPS (beeps al escribir) o SILENCIO (solo texto).',
      'La primera carga de OmniVoice puede mostrar «cargando voz…» uno o dos minutos; después contesta con voz.',
      'Para tu clone: «Usar mi propia voz…», elegí un .wav de 5–15 s y escribí en «Qué dice el audio» lo que dice, palabra por palabra (o «Cargar .txt»); «Guardar voz» se activa recién con audio y texto. Se guarda en «Carpeta de voz» → ref/my_ref.wav junto a su .txt.',
      {
        text: 'Si no carga: mirá el log y reportá en Discord #bugs:',
        command: '%APPDATA%\\capri-desktop\\logs\\voice.log',
      },
    ],
  },
  gaming: {
    title: 'No molestar',
    section: 'behavior',
    note: 'Con una app a pantalla completa (juegos, películas, presentaciones), Capri no se despierta con «Hey Capri» ni habla sola.',
    steps: [
      '«Silenciar en esta app»: se queda callada con esta app aunque no esté a pantalla completa.',
      '«No silenciar nunca»: sigue activa con esta app aunque esté a pantalla completa.',
      '«Sacar de la lista»: vuelve a la detección automática.',
      '«Dron en No molestar» (SÍ/NO): en pantalla completa puede soltar GPU pesada y mostrar el dron ligero.',
    ],
  },
  brain: {
    title: 'Cerebro',
    section: 'model',
    note: 'Las keys se guardan cifradas en tu PC (no van a git ni a los logs).',
    steps: [
      'En Ajustes › Cerebro los grupos son «Gratis» (LM Studio, OpenRouter), «Gratis con límite» (Gemini, Groq) y «De pago» (OpenAI, Anthropic, DeepSeek, Mistral, NVIDIA, Grok/xAI).',
      'En cada tarjeta: pegá la Key si hace falta (o URL/Modelo en LM Studio), tocá «Probar» y, si dice Listo, pasá a «Activo».',
      'Sin key un proveedor de nube queda en «Apagado» (no se puede activar). «Quitar key» borra la guardada.',
      'Abajo, «Agentes instalados» (si aparece): activá el CLI de Claude / Cursor / OpenCode / Codex / Gemini que tengas en el PATH; Capri no guarda esas keys.',
      {
        text: 'Si no contesta, revisá Prioridad / Activo y el log:',
        command: '%APPDATA%\\capri-desktop\\logs\\voice.log',
      },
    ],
  },
  agents: {
    title: 'Agentes',
    section: 'agents',
    steps: [
      'En Ajustes › Agentes cada agente muestra INSTALAR o QUITAR (hooks en su config).',
      'Después de INSTALAR, reiniciá ese agente. Codex pide confiar los hooks con /hooks.',
      'Capri avisa cuando arranca una sesión, cuando el agente trabaja, si te pide permiso («¡… te está pidiendo permiso!») y cuando termina.',
      'QUITAR saca los hooks de Capri de ese agente.',
    ],
  },
  apps: {
    title: 'Mis apps',
    section: 'apps',
    steps: [
      'Ajustes › Mis apps › «Mis apps» abre la lista de programas y enlaces que Capri puede abrir o cerrar.',
      '«Buscar programa…» elige un .exe o acceso directo de esta PC.',
      '«Agregar carpeta o archivo» suma una carpeta (Descargas, Documentos, Escritorio) o cualquier archivo: se abre como «abrí Descargas».',
      '«Añadir enlace» guarda una URL (por ejemplo un sitio) con el nombre que le pongas.',
      'En «Probar comando» escribí algo como «abre Discord»: te dice qué haría, sin hacerlo.',
    ],
  },
  screen: {
    title: 'Pantalla',
    section: 'bubble',
    steps: [
      'En Ajustes › Apariencia › Pantalla elegí cómo dibuja Capri.',
      '«Automático (recomendado)»: la configuración gráfica normal de Windows.',
      '«OpenGL (experimental)»: si Capri se vuelve invisible o transparente, volvé a Automático.',
      '«Sin GPU (lento)» es último recurso (pide CONFIRMAR); dibuja por CPU.',
    ],
  },
  clip: {
    title: 'Guardar clip',
    section: 'behavior',
    note: 'NVIDIA usa ShadowPlay (Alt+F10). Sin NVIDIA, Win+Alt+G (Xbox Game Bar; grabación en segundo plano).',
    steps: [
      'Con NVIDIA: Alt+F10 (o el atajo de Instant Replay) guarda el clip reciente.',
      'Activá Instant Replay en la app de NVIDIA si todavía no está.',
      'Sin NVIDIA: Win+Alt+G pide a Xbox Game Bar el «record last 30 s»; hace falta grabación en segundo plano en Windows.',
    ],
  },
  memory: {
    title: 'Memoria y personalidad',
    section: 'memory',
    steps: [
      '«Olvidar conversación» borra el hilo actual de chat (no toca memory.md).',
      '«Personalidad» abre persona.md: tono y carácter de Capri.',
      '«Memoria» abre memory.md: notas fijas sobre vos que viajan en el prompt.',
      '«Recargar personalidad» relee esos archivos sin reiniciar Capri.',
    ],
  },
};

// Only one help panel at a time: opening another closes the previous one.
export function toggleHelp(open, id) {
  return open === id ? null : id;
}
