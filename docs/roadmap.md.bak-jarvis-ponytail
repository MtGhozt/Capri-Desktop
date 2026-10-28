# Capri — Roadmap (actualizado 2026-10-26)

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

- [ ] **4A Corrector de lo que escucha mal:** tabla "cuando oye X → leer como Y" (palabras completas), aplicada antes de los comandos y del LLM. Comando de voz "cuando digo X quiero decir Y". En el menú, "Corregir lo último" (lo último que oyó).
- [ ] **4B Conversación sin wake word:** si su respuesta termina en pregunta, escucha ~8 s sin "Hey Jarvis". Slider de sensibilidad del wake word y atajo de teclado para hablar.
- [ ] **4C Motor de apps:** base upstream `5ecbae7` (`launch.js`, `apps.js`, `chat.js`), en español. Tabla nombre / también dice / tipo (programa, juego de Steam, link/URI) / ruta / procesos / al cerrar (forzar, como la X, preguntar). "Abre X", "cierra X", "abre X y Y"; "¿quisiste decir…?".
- [ ] **4D Escaneo de la PC:** Steam (`libraryfolders.vdf`), Epic, GOG y accesos del menú Inicio. Lista en el menú con "volver a escanear".
- [ ] **4E Animaciones:** cerrar = teletransporte con imágenes residuales + rayo rojo a la ventana; abrir = gesto con chispas.
- [ ] **4F Música:** Namida/Spotify con teclas multimedia. Spotify con Client ID propio (PKCE, token local fuera de git) para "pon X"; sin Premium abre la búsqueda. "Pon música" usa Namida.
- [ ] **4G Energía:** "apaga la compu", "reinicia la compu", "suspende la compu" con confirmación en voz alta (solo un "sí" claro ejecuta). Secuencia glitch a pantalla completa antes de apagar/reiniciar (más corta al suspender), con textos propios en español. "Bloquea la PC", "minimiza todo" y "devuélvelas" van directos.
- [ ] **4H Modo dron:** un ojo con fragmentos de su pelo girando (magenta/violeta/verde neón), dibujado en canvas, diseño propio. En modo juego aparece en vez de desaparecer; también se activa a mano desde el menú.
- [x] **4H caja + poses:** caja `CAPRI.SYS // MENSAJE` (carpeta, logs, typewriter) y Capri recostada/de pie en el borde (`lying_A` / `lying_B`).
- [ ] **4I Extras:** modo compacto, "Hacer algo" en el menú, saludo grande al desbloquear la PC.
- [ ] **4J Pulido para GitHub** (puede pasar a la Fase 6): submenú de voces (voz neural robótica por defecto, "Capri" solo local), proveedor por API key, `setup.bat` de un clic, README.
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