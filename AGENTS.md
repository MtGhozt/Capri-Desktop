# AGENTS.md — Capri Desktop (versión personal de Matias)

Proyecto **privado y personal** (no se publica). Asistente de escritorio con el personaje Capri (Cyberpunk: Edgerunners 2). Base: fork de [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop) (remote `upstream`). Referencia de lo que queremos lograr: el proyecto "Capri Desktop" de CursedMan (aún no publicado; ver `docs/referencia/` si existe).

Si algo no está claro, **pregunta**. Haz cambios quirúrgicos, simples y verificables.

## Objetivo final
- Overlay sin bordes, siempre encima.
- Widget compacto `CAPRI // DORMANT` (estrella roja/verde con ojo azul) que se expande con glitch VHS (aberración cian/magenta) a una burbuja estilo terminal (borde cian con muescas, fuente monoespaciada, fondo negro).
- Máquina de estados visible: `DORMANT → LISTENING → THINKING (decrypting ### %) → TALKING → ONLINE`.
- Retrato de Capri animado con glitch mientras habla.
- Chat por texto (`YOU > say something...`) y por voz ("Hello Capri").
- Personalidad Cyberpunk (choom, gonk, nova), respuestas cortas, puede ser sarcástica.
- Control de música: **Namida** (reproductor principal, datos en `%USERPROFILE%\.namida`) y Spotify como extra.
- Reaccionar a lo que hacen mis agentes de código (Cursor y OpenCode).

## Stack
- **App de escritorio:** Electron + JS (migrar gradualmente a TypeScript). Gestor de paquetes: **pnpm**.
- **LLM:** LM Studio local, API compatible con OpenAI en `http://localhost:1235/v1` (chat completions con streaming). Modelo 3–8B en Q4.
- **Voz (fase 3, proceso Python 3.11 aparte en `voice/`):** openWakeWord (wake word), Silero VAD, faster-whisper (STT, en CPU), TTS intercambiable con interfaz `speak(text) -> audio` (OmniVoice con voz clonada de Capri; Kokoro como fallback). Comunicación con Electron por WebSocket solo en `127.0.0.1`.
- **Hardware:** RTX 4060 8 GB VRAM, 32 GB RAM, Ryzen 7 5700X3D, Windows 11. La VRAM es el límite: LLM + TTS en GPU, STT en CPU.

## Mapa del código heredado
- `src/main/main.js` — ventana overlay, IPC (`overlay:interactive` ya existe).
- `src/main/bridge.js` — servidor HTTP en `127.0.0.1:47823` (eventos de hooks). Rechaza peticiones con `Origin`.
- `src/main/config.js` — config en `%APPDATA%\Capri\config.json`.
- `src/renderer/js/` — `sprite.js` (retrato), `fx.js` (glitch/RGB shader), `panel.js` (panel de transmisión, base para la burbuja), `chip.js` (base para el widget DORMANT), `brain.js` (interpreta eventos de Claude Code), `voice.js` (sonidos Web Audio), `lines.js` (frases).
- `hooks/capri-hook.js` — hook de Claude Code.

## Reglas
- Todo local: nada de telemetría ni servicios externos salvo LM Studio local y, opcionalmente, Spotify.
- Servidores solo en `127.0.0.1`. Si se agrega WebSocket, usar un token compartido.
- No romper lo que ya funciona del upstream sin preguntar.
- Código, nombres y commits en inglés; textos de la UI pueden estar en inglés/español.
- Commits pequeños con Conventional Commits. No hacer push sin que yo lo pida.

## Fases
1. **Chat por texto + LM Studio** (actual) — ver `PROMPT-FASE-1.md`.
2. **(actual, ver `PROMPT-FASE-2.md`)** Widget DORMANT + transición glitch + máquina de estados completa.
3. Voz: wake word, STT, TTS con voz clonada.
4. Música: Namida (now playing, play/pause/next, "pon X") y Spotify (Web API, requiere Premium).
5. Adaptadores para Cursor (`~/.cursor/hooks.json`) y OpenCode (plugin), usando como referencia el diseño de clawd-on-desk (AGPL: no copiar código).
## LM Studio (verificado 25-oct-2026)
- Servidor: `http://localhost:1235/v1` (en esta PC LM Studio levantó en el puerto **1235**, no 1234). Hacerlo configurable en config.js.
- Modelo: `google/gemma-4-e2b` (Q4_K_M, ~2.9 GB en VRAM con contexto 8192; respuestas en ~0.4 s). Alternativa más lista pero pesada: `google/gemma-4-e4b` (~4.5 GB). Windows y otras apps ya usan ~2.2 GB de VRAM.
- **Enviar `"reasoning_effort": "none"`** en cada request: Gemma 4 piensa por defecto y gasta tokens/latencia. Con eso responde en ~2-3 s.
- Arrancar desde terminal: `lms server start` y `lms load google/gemma-4-e2b --context-length 8192 --gpu max -y` (lms está en `%USERPROFILE%\.lmstudio\bin\lms.exe`).
- VRAM: con E2B cargado se usan ~5.1 GB de 8, quedan ~3 GB para el TTS de voz (OmniVoice ~2 GB). El backend del LLM debe ser intercambiable (cualquier endpoint compatible con OpenAI) para poder usar un modelo en la nube más adelante.