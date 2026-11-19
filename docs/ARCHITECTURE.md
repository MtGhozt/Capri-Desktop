# Arquitectura de `src/main`

`main.js` es el punto de entrada y el cableado de arranque: crea la ventana, la bandeja, el
sidecar de voz, el cerebro y los temporizadores, y llama a todo lo demás. Todo lo que se puede
probar sin Electron vive en módulos pequeños que exportan `createX({ deps })` (o funciones
puras). Los módulos nuevos toman sus dependencias estáticas con `require`; sólo las instancias y
el estado mutable llegan por `deps`, normalmente como getters (`getOverlay`, `getLlm`, `getVoice`…).
El estado mutable compartido está en `state.js`.

## Arranque y estado

| Módulo | Qué hace |
| --- | --- |
| `main.js` | Ventana overlay, bandeja, arranque (`main()`), cableado de IPC, atajos, `applyMenuAction` (apps/música/PC vía `menu:action`) y el detector de juegos. |
| `state.js` | Banderas mutables compartidas: `overlayFolded`, `ttsLoading`, `voiceTalking`, `llmBusy`, `lastTts`, `lastHeard`. |
| `config.js` | `config.json` en `%APPDATA%\Capri`, migraciones y valores por defecto. |
| `log.js` | Una línea por evento en local, `voice.log` con rotación a 5 MB. |
| `timing.js` | Una línea `[timing]` por turno: etapas en ms. |
| `setup.js` | Primer arranque: nada puede responder todavía, abre Ajustes con una bienvenida. |
| `user-files.js` | Persona y memoria editables en `userData`, copiadas la primera vez. |
| `windows.js`, `rects.js` | Posición de las otras ventanas (PowerShell + Win32), convertida a coordenadas del overlay. |
| `bridge.js` | Servidor HTTP local `127.0.0.1:47823`; los hooks POSTean ahí. |
| `updates.js` | Comprobación opcional de releases; nunca bloquea el arranque. |
| `diagnose.js` | El informe de "Diagnóstico": sin rutas ni claves. |

## IPC

| Módulo | Qué hace |
| --- | --- |
| `ipc-overlay.js` | Hover/click-through, log y beat del renderer, plegado, cursor, ventana en primer plano, visibilidad del chat. |
| `ipc-settings.js` | Config del renderer, menú de bandeja (y el del clic derecho), guía de la bandeja, ventana de Ajustes, sonidos. |
| `ipc-voice.js` | Saludo de arranque y de desbloqueo, `capri:speak`, push-to-talk, interrupción. |
| `ipc-misc.js` | Chat send/cancel, estado del LLM local, ping de system FX, lista de sonidos del usuario. |
| `chat-visible.js` | Qué hay realmente en pantalla: el bubble avisa de cada apertura y cierre. |
| `menu-state.js` | El payload de `menu:get`: una proyección de config + estado vivo para bandeja, menú y Ajustes. |
| `menu-guard.js` | El menú nunca se queda con la pantalla: heartbeat y cierre forzado. |
| `labels.js` | El menú de bandeja en cada idioma. |
| `settings-window.js` | La ventana de Ajustes (una sola instancia). |

## Un turno

| Módulo | Qué hace |
| --- | --- |
| `turn.js` | Un turno completo: escalera de comandos directos y, si nada aplica, el modelo con pantalla, clima y cola de voz. `cancel()` corta el turno entero. |
| `voice.js` | El cliente del sidecar: WebSocket local, eventos, push-to-talk, dormida/despierta. |
| `speak.js` | Cola de frases: agrupa y manda la línea al sidecar para que la diga entera. |
| `goodnight.js` | Se despide y sólo después se va a su rincón y se pliega. |
| `replies.js` | Lo que contesta cuando la orden se reconoce: PC, música, dormir/despertar, su nombre, el clip, arreglos de oído y recordatorios. |
| `direct-match.js` | Escalera de sólo lectura "¿esto es un comando directo?", compartida con el separador de multi-orden. |
| `multi-command.js` | Varias órdenes en una frase ("minimiza todo y ve a dormir"): sólo si cada parte ya es directa. |
| `command-text.js` | Normaliza el texto del chat o de Whisper: sin acentos, minúsculas, sin wake word. |
| `chat-providers.js`, `chat-models.js` | Quién responde (LM Studio local o nube) y qué modelo se recuerda por proveedor. |
| `llm.js` | Cliente compatible con OpenAI, streaming, visión y cancelación. |
| `lms.js` | Hablar con LM Studio: cargar/descargar el modelo, estado, VRAM. |
| `chat-text.js` | Limpia la respuesta de la nube (clasificadores, Markdown, pensar en voz alta) antes de mostrarla o decirla. |
| `mood-tag.js` | Etiquetas ocultas al inicio: `[calm]` elige la referencia de TTS, `[volume:…]`/`[pc:snip]` ejecutan una acción cerrada. |
| `follow-up.js` | Si su respuesta termina en pregunta, el micro se abre unos segundos sin wake word. |
| `comments.js` | Su vida en el escritorio: una línea cada 15–40 minutos y una al cambiar de contexto. |
| `greetings.js` | Los saludos de arranque; el sidecar los renderiza una vez con OmniVoice. |

### Flujo de un turno

1. **Voz.** El sidecar (Python, `voice/`) oye la wake word o el push-to-talk, transcribe con
   faster-whisper y manda `{type:'transcript', text, turn, stt}` por WebSocket a `127.0.0.1`.
2. **Oído.** `voice.js` entrega el evento a `main.js`; `hearTranscript()` descarta alucinaciones
   del STT, aplica `hearing.fixes` (`fixes.js`) y quita la wake word (`command-text.js`).
3. **Pantalla.** El evento `voice` llega al renderer (`app.js`) y `bubble.submitFromVoice()` hace
   `chat:send` con `meta.src = 'voice'`.
4. **Turno.** `turn.send()` en `turn.js` abre el turno (`timing.js`), deja contestar a lo que está
   esperando respuesta (apagado, "¿quisiste decir…?"), prueba los comandos directos
   (`replies.js`, `apps()`) y, si nada aplica, llama al cerebro (`llm.js` / agente CLI) con el
   look de pantalla, el clima y los extras del sistema.
5. **Respuesta.** El texto se manda al bubble (`chat:doing`/`chat:done`) y, si toca hablar,
   `speakLine()` encola la línea en el sidecar (`speak.js`), que responde con `talking` y
   `talking_done`; `follow-up.js` y `timing.js` se enteran por esos eventos.

## Comandos directos (sin modelo)

| Módulo | Qué hace |
| --- | --- |
| `sleep-command.js`, `wake-command.js` | Dormir y despertar. |
| `quit-command.js`, `quit-flow.js` | Cerrar Capri con resistencia: pregunta una vez. |
| `clip-command.js`, `clips.js` | "Guarda eso": dispara el hotkey de Instant Replay y abre la carpeta. |
| `mic-command.js`, `stop-tts-command.js`, `forget-command.js` | Micrófono, callarse, olvidar la conversación. |
| `fix-command.js` | "Cuando digo X quiero decir Y". |
| `name-command.js` | Cómo llamarte. |
| `system-command.js` | Apagar, reiniciar, suspender: preguntan primero. |
| `pc-actions.js` | Acciones cerradas (`[volume:…]`, `[theme:…]`, `[window:…]`) y datos del sistema para el LLM. |
| `reminders.js` | Temporizadores y recordatorios que sobreviven a un reinicio. |
| `weather.js` | Clima (Open-Meteo) y festivos, sin claves. |
| `whats-new.js` | La nota de "qué hay de nuevo" tras actualizar. |
| `lines-es.js` | Las frases de los comandos directos. |
| `wake-phrase.js` | Variantes de la wake word que el sidecar reconoce. |
| `gamepad-ptt.js` | Botón del mando como push-to-talk (lo sondea el renderer). |

## Sus apps, la música y el PC

| Módulo | Qué hace |
| --- | --- |
| `apps-config.js` | La tabla de apps: qué alcanza "abre X" y "cierra X". |
| `app-command.js`, `app-flow.js`, `app-actions.js`, `app-confirm.js` | Leer la orden, preguntar si hace falta, abrir/cerrar y decirlo. |
| `app-host.js` | El PC real detrás: programas, enlaces, `close-app.ps1`, taskkill. |
| `app-scan.js`, `app-fx.js` | Qué hay instalado y los efectos de abrir/cerrar. |
| `music.js`, `music-command.js`, `namida-search.js`, `spotify.js` | Namida y Spotify: qué suena, play/pausa/siguiente, "pon X". |
| `music-wiring.js` | El cableado de música que vivía en `main.js`: tokens cifrados de Spotify, OAuth, media keys de Windows y la instancia de `music.js`. |
| `context.js` | Qué hay en primer plano (música, juego, vídeo, código) para decir algo que encaje. |
| `screen-look.js` | Mirar la pantalla a pedido; el JPEG vive sólo en memoria. |
| `voice-install.js`, `voice-ref.js`, `voice-config.js`, `vc-runtime.js` | Instalar la voz, tu propia referencia, lo que recibe el sidecar, el runtime VC++. |
| `recommend-profile.js`, `assistants.js`, `agent-brain.js` | Perfiles sugeridos, agentes que vigila y usarlos como cerebro. |
| `hearing.js` | Sensibilidad de la wake word y hotkey del push-to-talk. |
| `game-detect.js`, `game-mode.js`, `game-quiet.js`, `game-window.js`, `game-comment.js` | Un juego a pantalla completa: bajarse de la GPU, no robar foco ni clics, comentar sólo con voz. |
| `render-mode.js`, `renderer-recover.js` | Cómo se dibuja la ventana y qué hacer si el renderer cae. |
| `vram.js` | VRAM en uso para el log de game mode. |
| `about.js` | Enlaces y textos de Acerca de. |
| `llm-probe.js` | Una petición mínima para comprobar que un proveedor funciona. |
