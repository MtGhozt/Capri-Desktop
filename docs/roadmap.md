# Capri — Roadmap (actualizado 2026-11-08)

Upstream de referencia: mochiiwuff/capri-desktop v0.4.0 (`bde7b42`). Nunca push a upstream. Traer cosas por partes (port manual o cherry-pick), no merge completo.

## Hecho

Resumen de lo cerrado (el detalle está en el historial de git y en el CHANGELOG):

- **Fase 3 — Voz y overlay:** OmniVoice con voz clonada y Kokoro de respaldo, blips, wake "Hey Capri", menú por secciones estilo CP2077, temas CYBERPUNK / CAPRI, clips NVIDIA (Alt+F10), liberar VRAM en reposo, descanso en la barra de tareas e "Iniciar con Windows".
- **Fase 4 — Acciones en la PC:** corrector de lo que oye mal, conversación sin wake word, motor de apps ("abre / cierra X", "abre X y Y"), escaneo de Steam/Epic/GOG/Inicio, animaciones al abrir y cerrar, música con Namida y Spotify, energía con confirmación, modo dron, caja `CAPRI.SYS // MENSAJE`, caricias y saludos.
- **Fase 5 — Cerebro fácil:** tarjetas de Cerebro (gratis con key, en tu PC, tu propia key), "Probar", keys solo locales y README reescrito para empezar sin código.
- **Fase 6 — Hecho:** hooks de agentes (Claude Code, Codex, Antigravity, Cursor y OpenCode), "Usar mi agente instalado", ver la pantalla a pedido con consentimiento, detección de juegos con No molestar y proveedores con key.
- **Fixes 0.2.x — Hecho:** 0.2.2 (aviso de VC++ faltante, barra "Cargando voz", "Modo juego" → "No molestar" + ayuda "?", OpenGL experimental, etiquetas de Mis apps); 0.2.4 (Diagnóstico en Acerca de con "Copiar detalles de error" y "Abrir log"); 0.2.5 (varios comandos en una frase, CLIs fuera del PATH, Spotify con más frases y reintentos, voz que cae a Kokoro en GPUs débiles y contexto sin charla vieja); 0.2.6 (hora local elegible, timers y recordatorios persistentes con aviso en burbuja y voz, primera descarga de voz explicada); **0.2.7 publicada** (`v0.2.7`: Gemini vuelve a `gemini-flash-lite-latest` y corrige configs guardadas, el modelo dice qué proveedor/modelo lo hace funcionar, CUDA forward-compatible para clonar voz, voz personalizada en 2 pasos claros, aviso hablado de recordatorios más firme si falla el TTS).
- **En preparación (0.2.8, sin publicar):** verificado en el historial local:
  - Pantalla: "Mirá mi pantalla" usa el monitor de la ventana activa (no el del mouse); reintenta frame negro; la captura no se guarda en disco salvo `voice.debugSave`.
  - Voz: instalación con detalles copiables, sin «Listo» falso; OmniVoice verifica imports y no reintenta en loop si falta torch.
  - Clima/feriados opcionales (Open-Meteo + Nager.Date) junto a la hora; ciudad resuelta o «No encontré esa ciudad»; offline sin spam.
  - Recordatorios: aviso 1–2 h antes en eventos (`[remind:…|…|min]`); editar/mover/borrar por chat y pestaña Recordatorios (zona de Ajustes).
  - Ajustes/menú: «Iniciar con Windows» de vuelta; pestañas Memoria y personalidad / Oído y voz; Proveedor del overlay = prioridad ↑/↓; clip avisa si no hay NVIDIA; Atajos alineados.

Queda abierto de la Fase 6: Anthropic y Grok como proveedores propios, la guía corta por opción y leer el estado del juego.

## Siguiente

- **0.2.9 (P2 parte 1, en prep):** volumen Windows, `ms-settings:`, batería/disco/RAM/IP vía `turnExtras`, modo oscuro/claro — etiquetas `[volume|settings|theme|info:…]`.
- **Resto de P2 / 0.3:** ventanas lado a lado, snip, tidy; **0.3 / 0.4 → P3:** sentir la PC y juegos.

## Próximo, por prioridad

### P1 — Estabilidad (versiones chicas de fixes)

- Probar el fix de "Mirá mi pantalla" en una PC con dos monitores (código ya en 0.2.8).
- Que el wake word no interfiera con audífonos Bluetooth.
- Actualización con un clic.

### P2 — Que el chat haga cosas en la PC (idea de upstream `cb33e87`)

- **Hecho (0.2.9 parte 1):** volumen Windows, páginas de Configuración (Bluetooth, sonido, etc.), batería/disco/RAM/IP al LLM, modo oscuro/claro — vía etiquetas + `pc-actions.js` (allowlist).
- Ordenar ventanas: "poné Discord a la izquierda y Chrome a la derecha", recortar pantalla.
- Dos pedidos en una frase (`d6c8070`), buscar archivos por tipo y abrir la carpeta (`3cd5377`).

### P3 — Sentir la PC y juegos

- Notar lo que conectás: teléfono, control, audífonos, cargador (`f167fd6`); CPU/batería/red (`2024660`).
- Detección por launcher, apodos de juegos ("cs" = CS2), usar el juego ya abierto.
- Mandos para hablar sin teclado.
- Nuevo "Modo juego" real: Capri comenta lo que pasa en la partida (distinto de No molestar).
- **Pantalla (idea de la comunidad):** mejorar el contexto de pantalla que ya existe para que entienda mejor lo que ve ("¿qué opinás de esto?" sobre un dibujo o modelo).
- **Grabar clips sin NVIDIA (sin fecha):** que Capri grabe los últimos segundos en cualquier GPU, o usar la grabación de Windows (Win+Alt+R) como alternativa a ShadowPlay.

### Integraciones (después de juegos, idea de la comunidad)

- Leer los últimos 10–20 mensajes de WhatsApp/Discord solo desde las notificaciones de Windows.
- Escribir o llamar por WhatsApp por voz, siempre confirmando antes de enviar y preguntando cuál contacto si hay nombres repetidos; desactivado mientras se juega online.

### P4 — Cerebro y voz

- Fallback a modelos cloud gratis de Ollama (`3e6f529`).
- Voz local gratis para todos (ex Fase 7), varias voces de referencia.
- Retomar respuesta tras interrupción.
- **Idiomas:** detectar el idioma de Windows (con selector en Ajustes) y traducir la interfaz (textos en un archivo por idioma); que el cerebro responda en ese idioma; Whisper ya entiende varios idiomas; pendiente: voces de Kokoro/OmniVoice por idioma y comandos directos (hoy en español). Versión grande, sin fecha.

### P5 — Personalidad y diversión

- Tirarla y que rebote/se cuelgue de las ventanas, seguirte entre monitores (upstream 0.5.0).
- Vínculo que crece con el tiempo y humor que sigue en el chat (enojada si la tirás).
- Recostarse en el borde de vez en cuando, selector de estilo de ventanas, abrir Roblox por nombre.
- **Animaciones (idea de la comunidad):** animación de música (sentada en la burbuja con audífonos); animaciones de estados de ánimo; reaccionar si la tirás muy seguido; respuesta especial al hacer clic en su cara. Sentarse en las ventanas ya existe.
- **Modo zoom/acercamiento (idea de la comunidad):** no es solo agrandar a Capri: una animación nueva donde se acerca a la pantalla y molesta un poco, a modo de juego. Buscamos animador/a o alguien que dibuje; el detalle exacto se confirma con quien la propuso.

### Ideas de la comunidad (sin fecha, no agendadas)

- **Recordatorios + Google Calendar:** crear eventos y pendientes en el calendario para que también avisen en el celular; los avisos propios de Capri se mantienen.
- **Música en YouTube:** abrir y poner YouTube / YouTube Music como alternativa a Spotify.

## Descartado

- Celos que cierran páginas de otras IAs: cierra pestañas del usuario.

## Ideas e inspiraciones (revisado 2026-11-03)

- **Upstream mochiiwuff** (fork, se puede reutilizar código): mirar la pantalla cuando se le pide (`e09878d`); sentir la PC: CPU, batería, red, USB, juegos (`2024660`); notar lo que conectás: teléfono, control, audífonos, cargador (`f167fd6`); enojarse después de que la tiran o celos de otra IA (`f7685d2`); buscar archivos y abrir la carpeta (`3cd5377`, `7d6cc1b`); chat con modelos cloud gratis de Ollama (`3e6f529`); abrir juegos de Roblox por nombre (`135d6b8`); dos pedidos en una frase (`d6c8070`).
- **dark-anishi/capri-desktop-noir** (referencia): volumen de música sincronizado aparte del sistema (`b959290`); recuperar input del mouse y limpiar overlay de forma segura (`8e6a699`).
- **lachydotmcg** (PolyForm Noncommercial: solo ideas, nada de código): no repetirse en el chat de voz; apodos de juegos ("cs" = Counter-Strike 2); usar el juego ya abierto en vez de abrir otra copia; que el wake word no interfiera con audífonos Bluetooth; dejar YouTube sonando; tamaño configurable; GitHub Pages, aviso SmartScreen, copiar detalles de error, actualizaciones con un clic.
- Los hooks locales de Cursor y el plugin/eventos de OpenCode no necesitan API: avisan a Capri por el WebSocket local.

> **Licencia del upstream:** desde 0.4.4 mochiiwuff/capri-desktop está bajo **PolyForm Noncommercial 1.0.0**. Portar solo lo permitido, con el comentario de atribución en el código y la fila correspondiente en [`THIRD_PARTY.md`](THIRD_PARTY.md).
