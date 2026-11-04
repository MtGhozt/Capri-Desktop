# Changelog

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
