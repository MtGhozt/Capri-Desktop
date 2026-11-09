# Changelog

## 0.2.7 (en preparación, sin publicar)

### Cerebro y proveedores

- **Gemini vuelve a `gemini-flash-lite-latest`:** la 0.2.5 cambió sin querer el modelo por defecto a `gemini-flash-latest`, que puede resolver a uno de pago/limitado y hace fallar las claves gratis. Se restaura el id liviano y, al abrir, un `config.json` que guardó el valor equivocado se corrige solo; un modelo elegido a mano se deja intacto.
- **Los modelos ya saben qué los hace funcionar:** el prompt del sistema incluye el proveedor activo y su modelo real (LM Studio/Ollama usan el nombre local; los agentes CLI, su etiqueta). Si le preguntás qué IA es, responde eso y sigue siendo Capri; no inventa ser otra empresa.

### Recordatorios

- **Aviso hablado (ya desde la 0.2.6):** cuando vence un recordatorio o timer, además de la burbuja lo dice la voz existente, sin pedirle nada al modelo. Respeta **No molestar** y la voz apagada (nunca la enciende sola), no duplica el aviso y no pisa una respuesta abierta. La 0.2.7 no agrega la función: endurece los fallos.
- **Si el TTS falla, la burbuja igual aparece:** el aviso visual y el procesamiento de recordatorios no dependen del audio. Varios recordatorios vencidos al abrir siguen agrupándose en un solo aviso.

### Voz

- **GPU compatible vuelve a clonar voz:** el chequeo de arquitectura CUDA comparaba `sm_89` (RTX 4060) contra una lista exacta y rechazaba placas que sí pueden correr OmniVoice. Ahora acepta la compatibilidad binaria dentro de la misma versión mayor; una GPU realmente incompatible sigue cayendo a Kokoro.
- **El aviso de fallback dice el motivo real:** distingue Torch/arquitectura, VRAM/OOM y otros errores de carga, en vez de culpar siempre a la GPU.
- **Tu voz personalizada, en 2 pasos:** elegís el .wav (5–15 s), escribís en el panel qué dice palabra por palabra (o cargás un .txt) y «Guardar voz» se activa recién con audio y texto.

## 0.2.6 (etiqueta `v0.2.6`)

### Chat y hora

- **Hora local de tu país:** deja de asumir Costa Rica; usa la zona del sistema o la que elijas en Ajustes, y el modelo recibe esa hora y fecha.

### Recordatorios

- **Timers y recordatorios persistentes:** por voz o chat ("timer 10 minutos", "recordame en 2 horas", fechas con `[remind:…]`), guardados en `reminders.json` y sobreviven a cerrar Capri.
- Avisan con burbuja y voz; **No molestar** los muestra en silencio. Al arrancar, los vencidos mientras estaba cerrada se cuentan una sola vez y se agrupan en un único aviso; la burbuja queda el tiempo suficiente para leerlo.

### Voz

- **Primera descarga explicada:** la primera vez que baja la voz lo dice claro, y el texto de la respuesta aparece aunque el audio todavía tarde.

## 0.2.5 (etiqueta `v0.2.5`)

### Chat

- **Varios comandos en una frase:** "minimiza todo y ve a dormir" se separa en partes y se ejecuta en orden (dormir siempre al final). La misma escalera de comandos directos se comparte con `chat:send`, y la cadena se corta si una parte pide confirmación.
- **Etiquetas de acción sin argumentos** (`[sleep]`, `[minimize]`, `[lock]`, `[mic:on]`, `[music:next]`, …) dentro del mecanismo oculto existente, con la lista cerrada en el prompt para que las paráfrasis lleguen a la misma acción.
- **Contexto más honesto:** una frase suelta después de 10 minutos de silencio no arrastra la charla vieja; los comentarios espontáneos no entran al historial (solo pueden responder a un seguimiento) y el prompt pide no inventar contexto en mensajes ambiguos.
- **Regresión conocida, corregida en 0.2.7:** el modelo por defecto de Gemini quedó en `gemini-flash-latest`.

### Voz y música

- **GPU débil:** si OmniVoice falla por falta de GPU, avisa una vez y sigue con Kokoro el resto de la sesión (sin reintentar en cada respuesta ni repetir el aviso).
- **Spotify:** entiende más frases (incluido voseo y "poné reproducir …"), refresca el token vencido y reintenta una vez tras un 401; sin dispositivo activo, abre Spotify, espera y reintenta. Un tema abierto en la app se informa como abierto, no como reproducido.

### Agentes

- **CLIs fuera del PATH:** Claude Code se encuentra en su carpeta de instalación nativa y los CLIs de npm en `%APPDATA%\npm`; la tarjeta explica "Lo encontré fuera del PATH; funciona igual" y cada detección lo registra en `voice.log`.

## 0.2.4

> [!TIP]
> **¿Venís de 0.2.3?** Al abrir esta versión, Capri muestra una burbuja **NUEVO** con las novedades; **«¿qué hay de nuevo?»** la repite cuando quieras. Si venís de una versión anterior sin `lastSeenVersion`, también aparece una vez (basta con que exista `config.json`).
>
> Para Discord: copiá el reporte con **Ajustes → Acerca de → Diagnóstico → Copiar reporte** y, si te lo piden, **Abrir log** y adjuntá `voice.log`.

### Cerebro y proveedores

- **Groq** vuelve a la lista en **Gratis con límite** y **Mistral** en **De pago**; se habían ocultado al reordenar las tarjetas.
- **Abrir la página de la clave** desde Cerebro vuelve a funcionar para **Groq, Mistral, DeepSeek y OpenRouter**: sus hosts ya están en la allowlist de enlaces externos (solo abre en el navegador del sistema y solo hosts conocidos).
- **Detección de agentes:** Cursor Agent se reconoce también con el binario `agent`, su instalación en Windows usa `irm 'https://cursor.com/install?win32=true' | iex` y OpenCode se instala con `npm install -g opencode-ai`. La comprobación de versión tiene 15 s y cada detección escribe `agent detect <id> bin=… path=… version=ok|timeout|error|none` en `voice.log`, así un CLI lento ya no queda como «No instalado» sin explicación.

### Voz

- **Whisper en CPU:** el primer arranque puede tardar ~170–180 s (más con disco frío). El límite de carga pasa de 60 s a **240 s**; antes se vencía a mitad de carga y parecía que la voz no arrancaba.
- **Un solo warmup:** si Whisper ya se está cargando, un segundo pedido (config, PTT, saludo) no inicia otra carga ni queda esperando minutos. Es un intento hasta que esté listo o falle una vez, con el motivo en `voice.log` y en Ajustes.
- **PC sin GPU:** el aviso de «la primera carga puede tardar ~3 minutos» sigue en Ajustes y en `docs/SOPORTE.md`; ahora el timeout real acompaña ese tiempo.

### UI y comportamiento

- **Atajos editables:** los atajos globales, el toggle del chat, la tecla de hablar y las teclas de música se capturan desde el menú. Rechaza un combo ya usado por otro atajo, un clip, cerrar el menú o la salida de emergencia; si Windows no lo acepta, restaura el anterior. El atajo de la bandeja sigue `config.json`.
- **Namida — qué está sonando:** lee la sesión multimedia de Windows (SMTC) y, si no hay, el título de la ventana; Spotify queda como fallback. Si no encuentra nada: «No sé qué está sonando en Namida.»
- **Mis apps:** abre **carpetas y archivos** (solo un `.exe` real se ejecuta; el resto va por el shell), agrega Descargas, Documentos y Escritorio cuando existen, y cerrar una carpeta es un no-op amable en vez de tocar el Explorador.
- **Tu nombre:** en el primer arranque te pregunta «¿Cómo querés que te llame?» (con **Saltar**), queda en Ajustes › Comportamiento y también con **«llamame Mati»** / «decime Mati». El nombre solo se manda al modelo cuando existe.
- **Copiar en comandos de agentes:** el botón **Copiar** de los comandos de instalación dice **Copiado** y vuelve a **Copiar** a los 1,6 s; igual en las ayudas **COPIAR → COPIADO → COPIAR**.
- **Caricias:** suenan con un **ronroneo** suave (respeta silencio / BLIPS); **3 caricias seguidas** en 1,2 s y se fastidia con una línea propia. Las caricias se pueden apagar en Comportamiento.
- **Extras (primera vez):** después del nombre/saludo, una pantalla opcional para activar **Ver mi pantalla** y crear un **acceso directo en el Escritorio**.
- **Qué hay de nuevo:** burbuja **NUEVO** solo después de actualizar (nunca en instalación nueva) y **«¿qué hay de nuevo?»** a pedido. Cubre el upgrade desde 0.2.3 y desde versiones sin `lastSeenVersion`.

### Soporte y diagnóstico

- **Ajustes › Acerca de › Diagnóstico:** revisa Python 3.11, VC++ x64, el sidecar de voz y los agentes detectados; **Copiar reporte** genera texto sin rutas de usuario ni claves.
- **Abrir log** en Acerca de y en el menú; **Copiar error** en las burbujas de error, siempre redactado. Menos pasos para reportar en Discord **#bugs**.
- **`docs/SOPORTE.md`:** guía de síntoma → causa → arreglo (Python `0x80070660` / `1632` con Microsoft Store o NuGet, VC++/DLL, `CERTIFICATE_VERIFY_FAILED`, Claude Code, PC sin GPU, LM Studio, dónde están los logs).
- **Redacción de secretos:** `redactSecrets` limpia claves y tokens (`sk-`, `AIza`, `xai-`, hex/base64 largos, `Bearer …`) en el reporte, en **Copiar error**, en la burbuja y en **cada línea de `voice.log`**. El helper del renderer se llama `redact-keys.js` porque `.gitignore` confundía `redact-secrets.js` con un archivo de claves y no lo empaquetaba.
- **`voice.log` sin spam:** la línea `click-through on/off` se escribe solo cuando el estado cambia; antes cada clic o hover llenaba el log.

### Correcciones

- Agentes marcados «No instalado» con el CLI presente (Cursor `agent`, OpenCode).
- Enlaces de claves bloqueados en Cerebro (Groq, Mistral, DeepSeek, OpenRouter).
- Whisper: timeout de 60 s y warmups duplicados en PCs sin GPU.
- Los botones de copiar quedaban en «Copiado» para siempre.
- `voice.log` se llenaba de líneas `click-through` al hacer clic.
- El helper que redacta claves en la burbuja no llegaba al instalador.

## 0.2.3

> [!IMPORTANT]
> **Usuarios de Antigravity:** esta versión corrige un bug crítico en la instalación de hooks. Si ya instalaste los hooks antes, desinstalalos y volvé a instalarlos desde Ajustes › Agentes, o ejecutá Capri una vez (se repara solo al arrancar).

- Ayudas "?" actualizadas a la versión actual.
- **Hooks Antigravity (crítico):** el comando instalado en `hooks.json` ya no lleva comillas internas alrededor de la ruta. Antigravity no pasa el comando por shell, por lo que las comillas llegaban a node literalmente y causaban `MODULE_NOT_FOUND`; como era `PreToolUse`, cancelaba *todas* las llamadas a herramientas. Se corrige en la instalación nueva y se repara la entrada vieja al arrancar Capri.
- **Hooks Antigravity — solo eventos de notificación:** Capri ya no instala `PreToolUse` ni `PreInvocation` en Antigravity. Solo instala `SessionStart`, `PostToolUse`, `PostInvocation` y `Stop` (todos asíncronos), así Capri nunca puede bloquear las herramientas del agente.
- **Hooks Antigravity — ruta con espacios:** si el directorio de instalación tiene espacios en el nombre de usuario, Capri intenta obtener la ruta corta 8.3 de Windows. Si no es posible, muestra un mensaje claro en vez de instalar un hook roto.
- **Chat toggle (Ctrl+Alt+T):** ya no requiere dos pulsaciones cuando el chat se abre solo (wake word, evento de agente, saludo, auto-look). La burbuja reporta su visibilidad real al proceso principal; el toggle siempre da vuelta lo que se ve en pantalla. Se registra `chat toggle visible=<antes>-><después> source=<origen>` en el log de voz.
- Oído: la escucha después de «Hey Capri» ya no corta en la primera pausa para pensar. El silencio que cierra la orden pasa de 0,7 s a 1,4 s por defecto, y a 1,0 s si apenas empezaste a hablar (arranque falso); el `listen end` del log ahora muestra el corte elegido en `end_ms=`.
- Ajustes › Oído: nueva «Pausa antes de cortar» con Corta (0,8 s) / Normal (1,4 s) / Larga (2,2 s). Queda en `config.json` como `voice.pauseBeforeCut`; los configs viejos usan Normal.
- Chat: la línea OÍDO de CAPRI.SYS // MENSAJE muestra la transcripción completa, en varias líneas y con scroll; antes el recuadro la recortaba al llegar a 4 líneas.
- El tope de la escucha pasa a 30 s (antes 15 s) y el tiempo de espera de 10 s ahora solo corta si no llegaste a hablar: una orden larga no pierde el final y la escucha nunca queda colgada.

## 0.2.2

- Voz: si falta Microsoft Visual C++ Redistributable (x64), Capri lo dice una vez en el chat y en Ajustes › Oído, con botón para bajar `vc_redist.x64.exe`; el instalador de voz también avisa antes y después.
- Wake word: un error de DLL (`onnxruntime_pybind11_state`) ya no se reintenta 3 veces; una línea `native runtime missing: <módulo>` y sigue con Whisper.
- STT: si `ctranslate2.dll` no carga, queda marcado como no disponible con el motivo, sin “Future exception was never retrieved” ni un `stt failed` por cada frase.
- Descargas del sidecar (silero VAD): usan `certifi` si está en el venv y, ante `CERTIFICATE_VERIFY_FAILED`, avisan de un posible antivirus inspeccionando HTTPS (nunca se desactiva la verificación).
- Ayuda: nuevo «?» “El Hey Capri no arranca / no te entiende” con los pasos del VC++ x64.
- «Modo juego» pasa a llamarse «No molestar» en toda la interfaz (menú, Ajustes, ayuda y README); las claves de config y los ids internos no cambian, así que las listas existentes siguen funcionando. Opciones: «Silenciar en esta app», «No silenciar nunca» y «Sacar de la lista».
- Ayuda: nuevo «?» en No molestar (Ajustes › Comportamiento) que explica la pantalla completa y qué hace cada opción.
- Pantalla: OpenGL ahora dice «OpenGL (experimental)» y, al elegirlo, avisa «Si Capri se vuelve invisible o transparente, volvé a Automático.»

## 0.2.1

- Win+L: rearmar el mouse hook (off→on), menú con captura explícita, resync dedupeado.

## 0.2.0

- Instalar voz con progreso, estado final y detalles colapsables; voz OmniVoice por defecto y Usar mi propia voz con `.wav` + `.txt`.
- Modelo de wake `hey_capri`, filtro que conserva despertares reales y arranque/reinicio del sidecar sin procesos huerfanos.
- Nueva persona, vista de pantalla 6C con consentimiento, ventana activa y lista de apps en el contexto.
- Modo juego 6D con despertar silenciado, opciones por juego agrupadas en Juego y exclusion de Electron, Capri y grabadores como Recordly.
- Cerebros 6E: Cursor, Codex, Gemini, OpenCode, Claude y Automatico, con fallback de Gemini para vision.
- Pistas de Pantalla, confirmacion de SIN GPU, ayuda detallada con enlaces clickeables y Atajos siempre visibles.
- Correcciones de congelamiento, hit-test, arrastre, cierre del chat, recuperacion al desbloquear y relanzamiento visible.

## 0.1.5

- Ajustes → AUDIO: botón **Instalar voz** (descarga sources a `%LOCALAPPDATA%\capri-desktop\voice`, Python 3.11, `setup.ps1`, progreso en el panel)
- Voz por defecto sin audio clonado: si `ttsRef` falta, OmniVoice usa voice-design (`ttsDesign`); **Usar mi propia voz…** copia un `.wav` + transcripción a `ref\my_ref.*`
- Botones **?** de Ajustes centrados (círculo + fila del título alineada)
- No se empaquetan ni se suben a git wavs / refs / voces clonadas
- Pantalla: pistas claras en Apariencia; confirmación antes de SIN GPU
- 6C: “mirá mi pantalla” con JPEG en memoria (opt-in + consentimiento); auto-look opcional
- 6E: Cerebro › Usar mi agente instalado (Claude, Cursor, OpenCode, Codex, Gemini CLI) + Automático
- Persona: menos burla/tsundere; más energía loca tica (ríe con él, voseo)

## 0.1.4

- Acerca de: Discord y TikTok; “Donar” queda oculto hasta que exista la URL de Ko-fi
- Enlaces externos con allowlist por host (Discord, TikTok, GitHub, keys, Ko-fi) en `about.js`
- “Acerca de…” sale del menú rápido; queda en Ajustes
- Menú rápido ya no queda vacío al abrir: se pinta desde caché y Rajdhani va precargada
- `menu:get` ligero (sin escanear CLIs, apps ni mics) y caché de CLIs 60 s
- Tests de enlaces de Acerca de y del layout del menú
- Configuración: guardar fusiona con `config.json` en disco (una edición a mano ya no borra otros ajustes) y un archivo ilegible se conserva como `config.json.bak`
- Claves: si `llm-keys` no se puede leer, se avisa y no se sobrescribe (antes podía quedar solo la clave nueva)

## 0.1.3

- Whisper: umbral ~4 GB RAM; sin `hey_jarvis` por defecto
- Cerebro: cards gratis / en mi PC / mi propia key; Anthropic y Grok/xAI; “Usar mi agente instalado” (Claude Code + OpenCode; resto TODO)
- Aviso de voz amigable si falta el sidecar (una sola vez)
- Hooks para 5 agentes (Claude Code, Codex, Antigravity, Cursor, OpenCode) con `origin` y frases que los nombran
- Permisos de agentes: alerta sticky + voz (“¡Cursor te está pidiendo permiso!…”)
- OpenCode: `session.execution.succeeded` → Stop; dedupe de PreToolUse ×N
- Buscar actualizaciones al abrir (máx. 1×/24 h, GitHub Releases; Sí abre la página)
- Ajustes › Acerca de (+ menú): versión, autor, comunidad, desarrollo, logs, updates

## 0.1.2

- Wake: "Hey Capri" / mangled forms already stripped before the LLM; wake-only opens a follow-up listen window
- Salir: confirm window stays solid (no click-through); Sí always quits; e2e clicks Sí once
- Volumen / mute solo de la música (API de Spotify o sesión de Windows del player), nunca el master
- Persona: teasing más juguetón, insultos raros
- TTS: avisa si falta un transcript de mood/ref; OmniVoice más determinista (`position_temperature` 0)
- Perf: poll de ventanas 300 ms; caricias menos IPC; rAF del dron/Capri pausados al ocultar; idle del sidecar más lento

## 0.1.1

- Ánimos de voz automáticos (burla, emoción, aburrida, seria)
- Despierta diciendo "Capri" (Whisper), además de "Hey Capri"; Ctrl+Alt+V para escuchar/detener
- Filtro de silencio: ya no "oye" cosas cuando nadie habla
- "Pon tu canción", y puede abrir apps / poner música desde el chat
- Memoria de los últimos mensajes del chat
- Pausas naturales al hablar
- Te pregunta antes de cerrarse; salida de emergencia Ctrl+Alt+Shift+Q
- Arreglos: micrófono que no abría, menú/Salir que se trababan, cuelgue al acariciarla, aviso de VRAM
- Recuperación automática si la ventana falla
