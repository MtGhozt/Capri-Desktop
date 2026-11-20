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
| `main.js` | Arranque (`main()`), cableado de IPC/fábricas y el detector de juegos (objetivo: &lt;1500 líneas). |
| `overlay-window.js` | La ventana overlay: create/fit, click-through, foco del chat, Esc y la ventana demo. |
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
| `menu-actions.js` | Las acciones que llegan por `menu:action`, por dominio: apps, voz, música, cerebro, juegos, sistema y escritorio. |
| `menu-guard.js` | El menú nunca se queda con la pantalla: heartbeat y cierre forzado. |
| `shortcuts.js` | Atajos globales: mostrar/ocultar, chat, push-to-talk, cerrar el menú y salir de emergencia. |
| `tray.js` | El icono de la bandeja y su menú, reconstruido (con debounce) cuando cambia la config. |
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
   `server.py` es el shell (`Engine` + WebSocket); la lógica vive en mixins hermanos:
   `wake.py` (wake/VAD), `stt.py` (mic/Whisper), `tts_runtime.py` (sintesis/OmniVoice).
   Helpers compartidos: `heavy.py`, `greet.py`, `tts.py`, `tts_text.py`, `vram.py`.
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
| `apps-wiring.js` | El cableado de apps que vivía en `main.js`: tabla, escaneo (`scan.json`), altas/bajas desde el menú y los diálogos. |
| `app-command.js`, `app-flow.js`, `app-actions.js`, `app-confirm.js` | Leer la orden, preguntar si hace falta, abrir/cerrar y decirlo. |
| `app-host.js` | El PC real detrás: programas, enlaces, `close-app.ps1`, taskkill. |
| `app-scan.js`, `app-fx.js` | Qué hay instalado y los efectos de abrir/cerrar. |
| `music.js`, `music-command.js`, `namida-search.js`, `spotify.js` | Namida y Spotify: qué suena, play/pausa/siguiente, "pon X". |
| `music-wiring.js` | El cableado de música que vivía en `main.js`: tokens cifrados de Spotify, OAuth, media keys de Windows y la instancia de `music.js`. |
| `context.js` | Qué hay en primer plano (música, juego, vídeo, código) para decir algo que encaje. |
| `screen-look.js` | Mirar la pantalla a pedido; el JPEG vive sólo en memoria. |
| `screen-capture.js` | El cableado de `screen-look.js` que vivía en `main.js`: qué pantalla, el escudo, el JPEG en memoria y el auto look cada minuto. |
| `voice-install.js`, `voice-ref.js`, `voice-config.js`, `vc-runtime.js` | Instalar la voz, tu propia referencia, lo que recibe el sidecar, el runtime VC++. |
| `voice-wiring.js` | Diálogos de Ajustes › AUDIO (carpeta, instalar, ref propia) y si la respuesta hablada está encendida. |
| `chat-settings.js` | Cerebro: proveedor, modelo, claves cifradas y el probe desde Ajustes. |
| `offers.js` | Burbujas opcionales al arrancar: actualización en GitHub y perfil de hardware. |
| `recommend-profile.js`, `assistants.js`, `agent-brain.js` | Perfiles sugeridos, agentes que vigila y usarlos como cerebro. |
| `hearing.js` | Sensibilidad de la wake word y hotkey del push-to-talk. |
| `game-detect.js`, `game-mode.js`, `game-quiet.js`, `game-window.js`, `game-comment.js` | Un juego a pantalla completa: bajarse de la GPU, no robar foco ni clics, comentar sólo con voz. |
| `render-mode.js`, `renderer-recover.js` | Cómo se dibuja la ventana y qué hacer si el renderer cae. |
| `vram.js` | VRAM en uso para el log de game mode. |
| `about.js` | Enlaces y textos de Acerca de. |
| `llm-probe.js` | Una petición mínima para comprobar que un proveedor funciona. |

## Renderer: menú de Ajustes (`menu.js` + `menu/`)

`src/renderer/js/menu.js` sigue siendo el shell: `AppMenu`, navegación, `renderQuick` /
`renderFull` (dispatch) y wrappers hacia `menu/*`. El plate de Ajustes llama a cada
sección en el mismo orden DOM que antes.

| Módulo | Secciones / responsabilidad |
| --- | --- |
| `menu/widgets.js` | `build`, `kbd`, `createRowHelpers`, `textInput`, opciones compartidas (`REPLY_OPTIONS`, zonas horarias, temas). |
| `menu/quick.js` | Menú rápido del overlay (plate compacto + submenu flotante). |
| `menu/help.js` | `placeHelpPanel`, botón `?`, panel de ayuda y colocación del submenu. |
| `menu/actions.js` | `act` / `optimisticAct` (IPC del menú). |
| `menu/voz.js` | AUDIO, OÍDO Y VOZ, `fixPanel`, sensibilidad y tecla para hablar. |
| `menu/musica.js` | MÚSICA y Spotify. |
| `menu/cerebro.js` | CEREBRO, `brainPanel`, `saveShare`. |
| `menu/agentes.js` | AGENTES. |
| `menu/memoria.js` | MEMORIA Y PERSONALIDAD. |
| `menu/apps.js` | entrada APPS, vista de tabla, escaneo, editor y enlaces. |
| `menu/comportamiento.js` | CLIPS, COMPORTAMIENTO (`render`) y toggles posteriores (`renderTail`, después de recordatorios en `menu.js`). |
| `menu/recordatorios.js` | RECORDATORIOS y helpers de hora local. |
| `menu/apariencia.js` | APARIENCIA y `pickRender`. |
| `menu/atajos.js` | ATAJOS, `shortcutRow`, `saveShortcut`. |
| `menu/about.js` | ACERCA DE y `aboutPanel`. |

Los tests que antes leían sólo `menu.js` usan `test/menu-source.js` (concatenación en orden
de sección). SALIR queda inline en `menu.js`.

## Renderer: arranque del overlay (`app.js` + `app/`)

`src/renderer/js/app.js` sigue siendo el shell de `boot()`: carga assets, construye las
instancias (fx, chip, mask, voice, panel, bubble, menú, dormant, capri, brain, systemFx,
guide) y el cableado básico (resize, config, Claude, ventanas). El resto se cablea con
`wireX({ deps })` bajo `app/`. Sin renombrar eventos IPC, ids del DOM ni `window.*` hooks.

| Módulo | Qué cablea |
| --- | --- |
| `app/pointer.js` | Click-through, biochip/máscara, rearm del hook, caricias, menu-guard (`beat`/`forceFree`), fold/unfold a DORMANT. |
| `app/voice-events.js` | `host.onVoice`, tokens/done/error del chat, estado LLM, gamepad push-to-talk. |
| `app/commands.js` | `host.onCommand` y efectos de apps (Paso 4E: zap/spark). |
| `app/demo.js` | Secuencia showcase del demo y el hook Playwright `__capriE2E`. |

Los tests que antes leían sólo `app.js` usan `test/app-source.js` (concatenación en orden
de módulo).

## Renderer: capa FX (`fx.js` + `fx/`)

`src/renderer/js/fx.js` sigue siendo el shell: `FxLayer`, canvas/resize/frame, la API pública
que dispara efectos, y un mapa `DRAWERS[type](fx, it, t, dt, now)` en lugar del switch largo.
Los callers (`app.js`, `chip.js`) importan `FxLayer`, `COLORS`, `GRAB_FRAMES`, `drawMask` desde
`fx.js` como antes.

| Módulo | Qué dibuja |
| --- | --- |
| `fx/primitives.js` | `COLORS`, `FRAME_MS`, `lerp`/`hash`/`onTwos`, `drawMask`/`drawEye`, `shard`/`sparkle`/`fadeStep`/`eye`. |
| `fx/electric.js` | `jag`/`ribbon`/`along`/`stroke` y drawers: bolt, crackle, zap, hitbox, flare, ring, lines. |
| `fx/possession.js` | `possession` y drawers: motes, satellite, surge, possess. |
| `fx/particles.js` | Drawers: shard, beam, streak, slice, slit, vortex, drift, cutin, pointer, glyph. |
| `fx/intro.js` | Intro: `GRAB`/`GRAB_FRAMES`/`prepareGrab`/`grabbed`/… y el drawer `intro`. |
