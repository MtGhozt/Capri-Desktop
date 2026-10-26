# Fase 3A - Que Capri te escuche (micrófono -> texto)

Lee `AGENTS.md` primero. Fases 1, 1.5 y 2 ya están hechas (chat, LM Studio, DORMANT, máquina de estados con `LISTENING` reservado). **Antes de tocar código, muéstrame un plan y espera mi OK.**

En esta fase Capri solo **escucha y transcribe**; responde por escrito en la burbuja como ahora. La voz de Capri (TTS) es la fase 3B, no la toques.

## Arquitectura
- Proceso Python 3.11 aparte en `voice/` con su propio venv (`voice/.venv`) y `voice/requirements.txt`. Un script `voice/setup.ps1` que crea el venv e instala todo.
- Electron (main) lanza y cierra ese proceso (`windowsHide: true`), y se comunica por **WebSocket solo en 127.0.0.1** con un token compartido aleatorio (pasado por variable de entorno). Si Python no está o falla, la app sigue funcionando solo con texto.
- El micrófono lo captura Python (`sounddevice`), no el renderer.

## Pipeline
1. **Activación:**
   - **Push-to-talk primero:** mantener **Ctrl+Alt+V** (o tocar una vez: empieza a escuchar, corta sola al detectar silencio). Es lo que debe funcionar sí o sí.
   - **Wake word opcional (`voice.wakeWord`, apagado por defecto):** openWakeWord. "Hey Capri" no existe pre-entrenado; usa por ahora un modelo incluido (p. ej. `hey_jarvis`) solo para probar, y deja documentado en `docs/voz.md` cómo entrenar uno propio de "hey capri" con la herramienta de openWakeWord.
2. **VAD:** Silero VAD para saber cuándo empecé y terminé de hablar (corte tras ~700 ms de silencio, máximo ~15 s).
3. **STT:** faster-whisper en **CPU** (int8), modelo `small` por defecto (configurable `base`/`small`/`medium`), idioma automático español/inglés. La GPU queda para el LLM y el TTS de la fase 3B.
4. El texto transcrito entra al mismo flujo del chat (como si lo hubiera escrito), se ve como `> you: ...` en la burbuja.

## Estados y UI
- Al activar: si está DORMANT, despierta (con el glitch de siempre) y abre la burbuja.
- `LISTENING` mientras grabo (contorno amarillo del ojo, etiqueta `CAPRI // LISTENING`, un indicador simple de nivel de micrófono), luego `THINKING` -> `TALKING` -> `ONLINE` como ya existe.
- Opción en el menú: "Micrófono: on/off" y elegir dispositivo de entrada.

## Config (merge profundo como siempre)
`voice: { enabled: true, pushToTalk: 'Ctrl+Alt+V', wakeWord: false, wakeModel: 'hey_jarvis', sttModel: 'small', language: 'auto', inputDevice: null }`

## Reglas
- Nada sale de la PC: ni audio ni texto a servicios externos. No guardar grabaciones en disco (salvo un modo debug explícito).
- Los modelos se descargan una sola vez en `voice/models/` (en `.gitignore`).
- No tocar Namida, Spotify, `bridge.js` ni `hooks/`. No romper el chat de texto.
- Commits chicos con Conventional Commits, sin push. Al final regenerar `pnpm dist` y explicar si el instalador incluye o no la parte de Python (está bien que por ahora requiera correr `voice/setup.ps1`).

## Verificación
- `voice/setup.ps1` instala sin errores con Python 3.11.
- Con Capri dormida, mantengo Ctrl+Alt+V, digo "hola Capri, ¿qué hora es?" y suelto: se despierta, aparece mi frase transcrita y responde por escrito.
- Funciona en español y en inglés.
- Si cierro Capri, el proceso Python también se cierra (nada colgado en el Administrador de tareas).
- Con el micrófono apagado en el menú, no se graba nada.