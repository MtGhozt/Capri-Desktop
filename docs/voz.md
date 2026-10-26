# Voz (fase 3A) — micrófono a texto

Capri escucha en local. El audio no sale de la PC. La respuesta sigue siendo texto en la burbuja; TTS es la fase 3B.

## Setup

Hace falta **Python 3.11** (`py -3.11`). En la carpeta del repo:

```powershell
cd C:\Programacion\Capri\Capri-Desktop\voice
.\setup.ps1
```

Crea `voice/.venv` e instala las dependencias. Los modelos (faster-whisper, Silero VAD, openWakeWord) se bajan **la primera vez** que arranca el sidecar, a `voice/models/` (está en `.gitignore`).

El instalador NSIS **no** incluye Python, el venv ni los modelos. Después de `pnpm dist`, seguí usando este `voice/` del checkout.

## Config

Archivo real: **`%APPDATA%\capri-desktop\config.json`** (no `%APPDATA%\Capri`).

```json
"voice": {
  "enabled": true,
  "dir": null,
  "pushToTalk": "Ctrl+Alt+V",
  "wakeWord": true,
  "wakeModel": "hey_jarvis",
  "sttModel": "small",
  "language": "auto",
  "inputDevice": null
}
```

- **dev** (`pnpm start` / `pnpm dev`): si `dir` es `null`, Electron usa `<repo>/voice`.
- **exe instalado**: poné una ruta absoluta al sidecar, por ejemplo `"dir": "C:\\Programacion\\Capri\\Capri-Desktop\\voice"`. Si falta, Capri sigue con chat de texto y deja un log `voice sidecar skipped`.

`sttModel`: `base`, `small` (default) o `medium`. Whisper corre en **CPU int8**; la GPU queda para el LLM (y el TTS de 3B).

Idioma: no hay autodetección libre. Whisper elige solo **es** o **en** (`task=transcribe`, nunca translate). Si detecta otro idioma, usa **es**. Prompt fijo `Capri, choom, Matias` para los nombres. Wake word: umbral `0.25` (hey_jarvis suele puntuar ~0.3–0.4; 0.5 se lo come). En `pnpm dev` el sidecar loguea `wake score=...`.

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
