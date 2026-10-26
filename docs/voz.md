# Voz — micrófono a texto y TTS (Kokoro)

Capri escucha y habla en local. El audio no sale de la PC.

## Setup

Hace falta **Python 3.11** (`py -3.11`). En la carpeta del repo:

```powershell
cd C:\Programacion\Capri\Capri-Desktop\voice
.\setup.ps1
```

Crea `voice/.venv` e instala las dependencias. Los modelos (faster-whisper, Silero VAD, openWakeWord, Kokoro) se bajan **la primera vez** que arranca el sidecar, a `voice/models/` (está en `.gitignore`).

Kokoro trae **espeak-ng** vía `espeakng-loader` (no hace falta instalarlo a mano). Si el loader falla, queda el fallback del espeak-ng de sistema.

El instalador NSIS **no** incluye Python, el venv ni los modelos. Después de `pnpm dist`, seguí usando este `voice/` del checkout.

## Config

Archivo real: **`%APPDATA%\capri-desktop\config.json`** (no `%APPDATA%\Capri`).

```json
"voice": {
  "enabled": true,
  "dir": null,
  "pushToTalk": "Ctrl+Alt+V",
  "wakeWord": true,
  "wakeThreshold": 0.2,
  "wakeModel": "hey_jarvis",
  "sttModel": "auto",
  "language": "es",
  "inputDevice": null,
  "tts": "kokoro"
}
```

- **dev** (`pnpm start` / `pnpm dev`): si `dir` es `null`, Electron usa `<repo>/voice`.
- **exe instalado**: poné una ruta absoluta al sidecar, por ejemplo `"dir": "C:\\Programacion\\Capri\\Capri-Desktop\\voice"`. Si falta `dir` o el `.venv`, Capri avisa en el panel (badge `VOICE`) y sigue con chat de texto. Logs: `%APPDATA%\capri-desktop\logs\voice.log`.

`sttModel`: `auto` (default) intenta **medium en CUDA float16** si hay ≥ ~2.8 GB de VRAM libre; si no, **small en CPU int8**. Siempre `language=es`, `task=transcribe`, `beam_size=5`. Prompt fijo `Capri, choom, Matias`. Wake word: `voice.wakeThreshold` (default **0.2**). En `pnpm dev` el sidecar loguea `wake score=...`.

`tts`: `"kokoro"` (default) o `"off"`. Mute y volumen del menú (`muted`, `volume` en la raíz del JSON) aplican al parlante del sidecar.

## Hablar (TTS, fase 3B paso 1)

Cuando el LLM responde, el sidecar sintetiza **por frase** con Kokoro ONNX en CPU, voz `ef_dora` (español), y reproduce con `sounddevice`. La primera frase no espera a que termine toda la respuesta.

- Estado `TALKING` cuando empieza el audio; `ONLINE` cuando termina (el idle de 5 min cuenta desde ahí).
- Mientras habla no corre STT (no se transcribe a sí misma). El wake word sigue activo con umbral **0.5** (vuelve a `wakeThreshold` al terminar).
- Cortar: `Ctrl+Alt+V`, clic en Capri, o “Hey Jarvis”. Corta el audio del stream de salida (sin tocar el mic), tira la cola y el LLM de esa respuesta, y la burbuja cierra el texto (completo o con `…`). Pasa a `LISTENING`.
- Si el TTS no arranca en ~2 s, o la cola de audio queda vacía, vuelve a `ONLINE` y el wake word a umbral 0.2.
- “Capri, andá a dormir” (dormite, a mimir, sleep) la manda a DORMANT con el glitch, sin pasar por el LLM.
- Kokoro se carga y hace un calentamiento al arrancar el sidecar para que la primera frase no pague el freeze de ONNX.
- `"tts": "off"` o mute: solo texto en la burbuja.

La voz clonada (OmniVoice) es el paso 2.

## Uso

- **Push-to-talk:** `Ctrl+Alt+V`. Mantener: graba hasta soltar (o silencio). Tocar una vez: corta sola tras ~700 ms de silencio (máximo ~15 s).
- **Wake word:** `hey_jarvis` (modelo incluido de openWakeWord), encendido por defecto. No hay un “hey capri” pre-entrenado.
- Menú: **Micrófono: on/off** y dispositivo de entrada. Con el mic off no se captura nada.
- Al cerrar Capri se mata el proceso Python (árbol completo en Windows).

## Entrenar “hey capri”

openWakeWord no trae esa frase. Para un modelo propio:

1. Seguí la guía oficial: [Training a custom wake word](https://github.com/dscripka/openWakeWord#training-new-models) y el repo [openwakeword/notebooks](https://github.com/dscripka/openWakeWord/tree/main/notebooks) (`automatic_model_training.ipynb`).
2. Generá clips sintéticos / grabá “hey capri” y entrená un `.onnx`.
3. Copiá el `.onnx` a `voice/models/` y en config:

```json
"wakeModel": "hey_capri"
```

El sidecar busca `voice/models/*<wakeModel>*.onnx`. El nombre del archivo debe contener `hey_capri`.

## Debug

`"debugSave": true` en `voice` escribe WAV en `voice/models/debug/`. Dejalo apagado: no se guardan grabaciones en disco en uso normal.
