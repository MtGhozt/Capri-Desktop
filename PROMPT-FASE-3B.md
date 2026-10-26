# Fase 3B: Capri habla (TTS local)

Lee AGENTS.md antes de empezar. Proyecto privado, uso personal. Todo local: ni el texto ni el audio salen de la PC. Commits chicos, **sin push**. Al final, `pnpm dist`.

## Objetivo
Cuando Capri responde (por texto o por voz), además del texto en la burbuja, **lo dice en voz alta** con la voz clonada de Capri, en español.

## Contexto que ya existe
- Sidecar Python 3.11 en `voice/` (WebSocket 127.0.0.1:47824 con token). STT con faster-whisper, wake word `hey_jarvis`, VAD de Silero.
- Estado `TALKING` y el glitch del retrato mientras habla ya están en la UI (`state.js`).
- Config: `%APPDATA%\capri-desktop\config.json` (hay que cerrar Capri antes de editarla). Ya tiene `muted` y `volume`.
- VRAM: RTX 4060 de 8 GB. Con Gemma 4 E2B en LM Studio quedan unos **2.5–2.7 GB libres**. Whisper corre en CPU.
- Audio de referencia ya preparado (gitignored, no lo subas): `voice/ref/capri_ref.wav` (25 s, 24 kHz mono) + `capri_ref.txt`, y `voice/ref/capri_ref_short.wav` (10.6 s) + `capri_ref_short.txt`. Español latino.

## Paso 1: interfaz intercambiable + voz genérica (Kokoro)
1. En el sidecar, una interfaz `TTSEngine` con `speak(text) -> audio (PCM float32 + sample rate)`, para poder cambiar de motor sin tocar el resto.
2. Primer motor: **Kokoro** (kokoro-onnx o el paquete `kokoro`), voz en español (p. ej. `ef_dora`), en **CPU**. Sirve para probar todo el flujo ya.
3. Flujo: cuando llega la respuesta del LLM, cortarla por frases y sintetizar la primera frase apenas esté lista (streaming por frase), sin esperar a que termine toda la respuesta. Meta: que empiece a sonar en menos de 1 s.
4. El audio se reproduce en el sidecar (sounddevice) o en Electron; lo que sea más simple. Respetar `muted` y `volume` de la config.
5. Estados: entra a `TALKING` cuando empieza a sonar y vuelve a `ONLINE` cuando termina (y el idle de 5 min cuenta desde ahí).
6. **Que no se escuche a sí misma:** mientras habla, pausar el wake word y el STT (o ignorar lo que detecten), y rearmarlos al terminar.
7. **Interrumpir:** Ctrl+Alt+V, un clic en Capri o un "Hey Jarvis" cortan el audio de inmediato y pasan a `LISTENING`.
8. Limpiar el texto antes de leerlo: sin markdown, sin emojis, sin asteriscos; leer bien números y horas en español ("9:42" → "nueve cuarenta y dos").

Commit y avisame para probarlo antes del paso 2.

## Paso 2: voz clonada de Capri (OmniVoice)
1. Segundo motor: **OmniVoice** (k2-fsa, clonación zero-shot multilingüe) usando `voice/ref/capri_ref_short.wav` + su transcripción. Si `capri_ref.wav` (25 s) da mejor resultado, usar ese. Verificá la instalación oficial y la licencia antes de instalar; si OmniVoice no anda bien en Windows o no entra en la VRAM, proponé alternativa (F5-TTS con checkpoint en español, o XTTS-v2) y preguntame antes de cambiar.
2. En **GPU** si hay VRAM libre (comprobar con nvidia-smi como ya hace el STT); si no, CPU o volver a Kokoro. Nunca debe tumbar a LM Studio por falta de VRAM.
3. Cachear el embedding/condicionamiento de la voz de referencia al arrancar, para no recalcularlo en cada frase.
4. Config nueva en `voice`: `tts: "auto" | "omnivoice" | "kokoro" | "off"` (default `auto`: OmniVoice si se puede, si no Kokoro), `ttsRef` (ruta del wav de referencia), `ttsSpeed`.
5. Log en `voice.log`: motor cargado, VRAM libre, latencia de la primera frase y tiempo de síntesis por frase.
6. Actualizá `docs/voz.md` con cómo cambiar la voz de referencia y el motor.

## Extra pequeño (system prompt)
Capri hoy dice que puede abrir apps y poner música, y todavía no puede (eso es la fase 4). Ajustá el system prompt para que no prometa acciones que aún no existen; si se lo piden, que diga con su estilo que todavía no tiene ese módulo conectado.

## Criterios de listo
- Le hablo o le escribo y Capri responde en voz alta, en español, con voz parecida a la de las referencias.
- Empieza a hablar rápido, se puede interrumpir, y no se despierta con su propia voz.
- LM Studio sigue funcionando con Gemma E2B cargado.
- El glitch de pantalla completa al dormir/despertar sigue igual.
- Commits chicos, sin push, `pnpm dist` al final.