# Capri — Roadmap (actualizado 2026-10-28)

Upstream de referencia: mochiiwuff/capri-desktop v0.4.0 (`bde7b42`). Nunca push a upstream. Traer cosas por partes (port manual o cherry-pick), no merge completo.

## Fase 3 — Voz y overlay ✅
- [x] OmniVoice clon + Kokoro fallback, blips, wake "Hey Jarvis", sleep, persona Edgerunners.
- [x] 3C menú por secciones estilo CP2077 + clips NVIDIA (Alt+F10).
- [x] 3D liberar recursos: descargar OmniVoice/Whisper en reposo (`64a855b`).
- [x] 3E temas del menú: CYBERPUNK / CAPRI (`f247883`).
- [x] 3F traído de upstream: volver tras suspensión (`473d270`), barra de tareas (`68fbbb4`), intro nueva (`e731a39`), "Iniciar con Windows" en el menú (`2df9004`).
- [x] 3G comandos directos más amplios para dormir y la voz, sin pasar por el modelo (`583e419`).
- [x] 3H torch fijado, modo juego y un solo escritor para el log (`7c8d3bd`..`60c2bd2`).
- [x] 3I menú con degradado del tema, saludo desde wav en caché, comentarios propios y contexto de la ventana activa.
- [x] 3J–3M descanso en la barra de tareas: se queda donde la sueltas, pies sobre el borde visible, sube y baja con la barra, deambula libre y duerme en una esquina de abajo.

## Fase 4 — Acciones en la PC
Inspirada en "Capri // Deck" de kamome513: solo ideas, nada de arte copiado.

- [x] **4A Corrector de lo que escucha mal:** tabla "cuando oye X → leer como Y" (palabras completas), aplicada antes de los comandos y del LLM. Comando de voz "cuando digo X quiero decir Y". En el menú, "Corregir lo último" (lo último que oyó). Hecho (`b1a4059`).
- [x] **4B Conversación sin wake word:** si su respuesta termina en pregunta, escucha ~8 s sin "Hey Jarvis". Slider de sensibilidad del wake word y atajo de teclado para hablar. Hecho (`76b7318`).
- [x] **4C Motor de apps:** base upstream `5ecbae7` (`launch.js`, `apps.js`, `chat.js`), en español. Tabla nombre / también dice / tipo (programa, juego de Steam, link/URI) / ruta / procesos / al cerrar (forzar, como la X, preguntar). "Abre X", "cierra X", "abre X y Y"; "¿quisiste decir…?". Hecho (`51af817`).
- [x] **4D Escaneo de la PC:** Steam (`libraryfolders.vdf`), Epic, GOG y accesos del menú Inicio. Lista en el menú con "volver a escanear". Hecho (`cc29810`).
- [x] **4E Animaciones:** cerrar = teletransporte con imágenes residuales + rayo rojo a la ventana; abrir = gesto con chispas. Hecho (`9251317`).
- [x] **4F Música:** Namida/Spotify con teclas multimedia. Spotify con Client ID propio (PKCE, token local fuera de git) para "pon X"; sin Premium abre la búsqueda. "Pon música" usa Namida. Hecho (`0d8d116, cc9e069`).
- [x] **4G Energía:** "apaga la compu", "reinicia la compu", "suspende la compu" con confirmación en voz alta (solo un "sí" claro ejecuta). Secuencia glitch a pantalla completa antes de apagar/reiniciar (más corta al suspender), con textos propios en español. "Bloquea la PC", "minimiza todo" y "devuélvelas" van directos. Hecho (`3f98675..f276b22`).
- [x] **4H Modo dron:** un ojo con fragmentos de su pelo girando (magenta/violeta/verde neón), dibujado en canvas, diseño propio. En modo juego aparece en vez de desaparecer; sin modo manual por ahora.
- [x] **4H caja + poses:** caja `CAPRI.SYS // MENSAJE` (carpeta, logs, typewriter) y Capri recostada/de pie en el borde (`lying_A` / `lying_B`).
- [x] **4I Extras:** modo compacto provisional, "Hacer algo" en el menú, saludo grande al desbloquear la PC.
  - Saludo con voz al arrancar y al desbloquear, con cooldown y fallback local.
  - Hora, momento del día y tiempo desde la última conversación en cada prompt.
  - Comentarios espontáneos con privacidad de pantalla, reacción si se ignoran y escucha posterior.
  - Caricias en la cabeza pasando el cursor; reacción visual y sonora.
  - Bailar ocasionalmente cuando recibe estado de reproducción musical.
  - "Hacer algo" y modo compacto provisional desde el menú.
- [x] **Rediseño del menú + ventana de ajustes:** hecho, sin commit.
- [ ] **4J Ver la pantalla:**
  - Captura de pantalla enviada a un modelo con visión, solo con el interruptor de pantalla activado (apagado por defecto) y solo con proveedores en la nube o un modelo local con visión.
  - Intervalo largo y limitado para no gastar.
  - "Mira mi pantalla" bajo pedido.
  - Corregir el interruptor actual, que solo manda el exe y el título de la ventana (nombre engañoso).
  - Que los comentarios de 4I usen esto cuando esté activo.
- [x] **4L Pulido para GitHub** (en curso, sin commit hasta probar): TTS off / blips por defecto, Gemini `gemini-flash-lite-latest`, first-run hint de clave, `persona.md`/`memory.md` en userData, CREDITS + PolyForm + README ES/EN, instalador 0.1.0. Queda: GIFs, Release, push.
- [x] **4K Traído de upstream:** proveedores de chat en la nube (LM Studio, OpenRouter, Groq, Gemini, OpenAI, Mistral, DeepSeek) con clave cifrada y vuelta automática a Gemma, clic recuperado con el puntero encima, y opción "Pantalla" para PCs donde su ventana sale negra. Ver `docs/THIRD_PARTY.md`.
- Quitar "módulo no conectado" de `persona.md` a medida que cada cosa funcione.

## Fase 5 — Vigilar agentes de código
- Base: upstream hooks (`capri-hook.js`, `capri-codex-hook.js`, `capri-agy-hook.js`, `assistants.js`).
- Agregar OpenCode (y Cursor). Avisar cuando un agente termina o pide permiso.

## Más adelante
- Proveedor de LLM con API key (modelo pago) además de LM Studio local. Referencia: upstream multi-proveedor (`affea9d`, `bde7b42`). Key guardada local, nunca en git.
- Wake word propio "Hey Capri".
- Retomar respuesta tras interrupción.
- Refinar voz con más clips (ver docs/capri-personalidad.md).
- Idiomas, solo si el repo se hace público.
- Fijar versiones de torch/torchaudio en voice/setup (hoy torch 2.14.1+cu130 con torchaudio 2.11.0).

## Ideas e inspiraciones (revisado 2026-10-30)
- **Upstream mochiiwuff** (fork, se puede reutilizar código): mirar la pantalla cuando se le pide (e09878d); sentir la PC: CPU, batería, red, USB, juegos (2024660); notar lo que conectás: teléfono, control, audífonos, cargador (f167fd6); enojarse después de que la tiran o celos de otra IA (f7685d2); buscar archivos y abrir la carpeta (3cd5377, 7d6cc1b); chat con modelos cloud gratis de Ollama (3e6f529); abrir juegos de Roblox por nombre (135d6b8); dos pedidos en una frase (d6c8070).
- **dark-anishi/capri-desktop-noir** (referencia): volumen de música sincronizado aparte del sistema (b959290); recuperar input del mouse y limpiar overlay de forma segura (8e6a699).
- **lachydotmcg** (PolyForm Noncommercial: solo ideas, nada de código): no repetirse en el chat de voz; apodos de juegos ("cs" = Counter-Strike 2); usar el juego ya abierto en vez de abrir otra copia; que el wake word no interfiera con audífonos Bluetooth; dejar YouTube sonando; tamaño configurable; GitHub Pages, aviso SmartScreen, copiar detalles de error, actualizaciones con un clic.
- **Fase 5** no necesita API: hooks locales de Cursor y plugin/eventos de OpenCode avisando a Capri por el WebSocket local.