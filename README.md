# Capri

Compañera de escritorio con el personaje **Capri** (*Cyberpunk: Edgerunners 2*): overlay siempre encima, chat, música, apps y (opcional) micrófono. Fan project basado en [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop).

**Gratis para siempre.** No se vende. Donaciones (si las hubiera) no desbloquean nada.

> Fan art. **No** afiliado a CD PROJEKT RED. Licencia PolyForm Noncommercial — [LICENSE](LICENSE), [CREDITS.md](CREDITS.md).

**Versión actual:** `0.1.2` (`Capri-Setup-0.1.2.exe`).

<img src="docs/media/capri-desktop.png" alt="Capri en el escritorio" width="100%">

---

## 1. Qué es

Overlay sin bordes, siempre encima. Vive en tu escritorio: puedes arrastrarla, acariciarle la cabeza, plegarla al widget `CAPRI // DORMANT`, o dejarla en forma de máscara / biochip / dron ligero.

<img src="docs/media/capri-standing.png" alt="Capri de pie" width="480">
<img src="docs/media/capri-chat.png" alt="Caja de chat" width="480">
<img src="docs/media/capri-talking.png" alt="Burbuja hablando" width="480">
<img src="docs/media/capri-menu.png" alt="Menú clic derecho" width="480">

---

## 2. Inicio rápido (sin código)

1. Baja **`Capri-Setup-0.1.2.exe`** desde [Releases](https://github.com/MtGhozt/Capri-Desktop/releases).
2. Si SmartScreen dice *Windows protegió tu PC* → **Más información** → **Ejecutar de todas formas** (el instalador no está firmado con certificado de pago; es normal).
3. Instala y abre **Capri**. No hace falta Node.js ni admin.

**Menú:** clic derecho sobre ella, o el icono de la bandeja (en Windows 11 a menudo está detrás de **^**).

La primera vez, si no hay LM Studio local ni clave en la nube, Capri puede abrir **Ajustes → Modelo y clave** para que elijas un cerebro.

---

## 3. Su cerebro

Elige el proveedor en **clic derecho → Ajustes… → Modelo y clave** (o el atajo de proveedor en el menú rápido).

| Proveedor | Notas |
| --- | --- |
| **LM Studio** (local) | Por defecto. Servidor OpenAI-compatible (en muchas PCs `http://localhost:1235/v1`). Modelo típico de desarrollo: `google/gemma-4-e2b`. |
| **Gemini** | Modelo por defecto `gemini-flash-lite-latest`. Clave gratis: [Google AI Studio](https://aistudio.google.com/apikey). |
| **OpenRouter** | Pegas el id exacto del modelo (p. ej. variantes `:free` o `openrouter/free`). |
| **Groq / OpenAI / Mistral / DeepSeek** | Misma pantalla: eliges proveedor, modelo y clave. |

Las claves se guardan en tu usuario Windows con `safeStorage` (no van al repo ni a los logs).  
**Compartir pantalla / memoria con la nube** está **apagado** por defecto (`shareScreen` / `shareMemory`).

Personalidad y memoria: **Ajustes → Memoria → Abrir personalidad / Abrir memoria** (`persona.md` / `memory.md` en tu carpeta de datos).

---

## 4. Voz (opcional)

El instalador público **no** incluye el sidecar Python (`voice/`), modelos Whisper/OmniVoice ni el audio de referencia clonado.

| Sin sidecar | Con sidecar local (`voice.dir` + `setup.ps1`) |
| --- | --- |
| Chat por texto y **BLIPS** (beeps al escribir) o **SILENCIO** | Wake word, STT, y **VOZ** si activas TTS |
| `Ctrl+Alt+V` no tiene micrófono detrás | `Ctrl+Alt+V` escucha / deja de escuchar |

Con sidecar montado:

- **Wake:** “Hey Capri” (modelo `hey_capri`, si falta cae a `hey_jarvis`) y/o decir **“Capri”** (Whisper).
- **STT:** faster-whisper en **CPU** (deja la GPU al TTS si lo usas).
- **Modos de respuesta** (menú → Modo de respuesta): `VOZ` / `BLIPS` / `SILENCIO`. Por defecto en el build público: **BLIPS**, TTS **off**.
- **Ánimos** (burla, emoción, aburrida, seria): wavs de referencia en `voice/ref/`. **Ese audio clonado no viaja en el Setup.** Sin refs / sin OmniVoice: mientras carga o si TTS está off → **blips**; si OmniVoice falla de verdad → **Kokoro** (voz genérica), no la de Capri.

Guía de montaje local: [`docs/voz.md`](docs/voz.md).

---

## 5. Qué puede hacer (hoy)

- **Chat** en la burbuja (`TÚ > …`), personalidad cyberpunk corta.
- **Abrir / cerrar** apps, juegos y sitios que tengas en su lista **APPS** (“abre Discord”, etc.).
- **Música** (player por defecto **Namida**; **Spotify** opcional): play, pausa, siguiente, “pon \<tema\>”, “pon tu canción”, volumen / mute **solo de la música** (nunca el volumen master del PC).
- **Energía del PC** con confirmación: apagar / reiniciar / suspender.
- **Modo juego:** ante un juego a pantalla completa puede soltar GPU pesada y mostrar un **dron** ligero.
- **Formas:** DORMANT, máscara dormida, biochip, teleports, poses; **agarrar y soltar**; **caricias** en la cabeza (se pueden apagar en comportamiento).
- Comentarios ocasionales, saludo al arrancar / al desbloquear (configurables).

<img src="docs/media/capri-drone.png" alt="Dron en modo juego" width="480">
<img src="docs/media/capri-star.png" alt="Momento estrella" width="480">

---

## 6. Atajos

| Atajo | Qué hace |
| --- | --- |
| **Ctrl+Alt+V** | Hablar / dejar de escuchar (push-to-talk; hace falta sidecar de voz) |
| **Ctrl+Alt+Shift+Q** | Salida de emergencia (sin Sí/No; también corta el sidecar) |
| **Bandeja → Salir** dos veces (&lt; 10 s) | La 1.ª pide confirmación; la 2.ª sale sin esperar el Sí |
| Ctrl+Alt+C | Guardar / sacar (biochip) |
| Ctrl+Alt+T | Abrir chat |
| Ctrl+Alt+M (u otro libre) | Cerrar menú a la fuerza |

---

## 7. Requisitos

- **Windows 10/11, 64-bit**
- **Micrófono:** solo si quieres voz / wake word
- **Cerebro en la nube (Gemini, etc.):** basta con una clave; sirve en PCs modestas
- **LM Studio local:** más RAM/VRAM; orientativo ~Q4:

| Hardware | Ejemplos razonables |
| --- | --- |
| CPU / sin GPU | modelos ~1B–3B |
| ~4 GB VRAM | ~3B–4B |
| ~8 GB VRAM | p. ej. `google/gemma-4-e2b`, ~7–8B |
| ~12 GB+ | modelos más grandes (E4B, 12B–14B, …) |

---

## 8. ¿Es seguro? ¿Qué sale de la PC?

| Modo | Qué sale |
| --- | --- |
| **LM Studio** | El chat no va a internet: `127.0.0.1` |
| **Nube** | Solo el texto del chat (y pantalla/memoria **si** las activas) al proveedor que elegiste |
| **Claves** | Quedan en tu usuario, cifradas. No se suben al repo ni se escriben en logs |
| **Voz / mic** | Procesamiento local en el sidecar; el audio no se manda a un servicio de voz de Capri |

SmartScreen avisa porque el `.exe` **no está firmado**, no porque haya telemetría oculta.  
Código en este repo; el instalador se genera con `pnpm dist`.

**Logs:** `%APPDATA%\capri-desktop\logs\` (p. ej. `voice.log`).  
**Config:** `%APPDATA%\capri-desktop\config.json`.

---

## 9. FAQ / problemas

| Problema | Qué probar |
| --- | --- |
| **No detecta el mic** | Menú → Micrófono **ACTIVO**; elige dispositivo. Sin sidecar de voz no hay lista de mics útiles. |
| **Wake word flojo** | Sube sensibilidad en OÍDO; di “Capri” claro; revisa `voice.log`. |
| **Aviso de VRAM** | Normal si LM Studio + TTS pelean por la GPU: baja el modelo local, o usa Gemini/clave cloud, o deja respuesta en **BLIPS**. |
| **No cierra / overlay trabado** | `Ctrl+Alt+Shift+Q`, o **Salir** dos veces en la bandeja. Menú pegado: bandeja → Cerrar menú. |
| **Pantalla negra detrás** | Menú → render OpenGL o software. |
| **¿Habla en voz alta?** | Por defecto **no** (BLIPS). VOZ solo con sidecar + TTS; sin audio clonado no suena “como Capri”. |
| **¿Mac / Linux?** | Sin instalador aún (Windows x64 primero). |

---

## 10. Créditos y licencia

- Arte y código original: **mochiiwuff** — [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop)
- Este fork: **PolyForm Noncommercial 1.0.0** — [LICENSE](LICENSE), detalle en [CREDITS.md](CREDITS.md)
- Capri es **fan art** de *Cyberpunk: Edgerunners 2*. **No** afiliado a CD PROJEKT RED / Studio Trigger.

---

# Capri (English, short)

Desktop companion overlay as **Capri** (*Cyberpunk: Edgerunners 2*), based on [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop). **v0.1.2** — download `Capri-Setup-0.1.2.exe` from [Releases](https://github.com/MtGhozt/Capri-Desktop/releases); SmartScreen → *More info* → *Run anyway*.

**Brain:** LM Studio locally, or Gemini (`gemini-flash-lite-latest`), OpenRouter, Groq, OpenAI, Mistral, DeepSeek in **Settings → Modelo y clave**. Keys stay on your PC (`safeStorage`).

**Voice (optional):** not in the public installer. Without the local `voice/` sidecar she uses **typing blips** (default) or silence. With a sidecar: wake (“Hey Capri” / “Capri”), **Ctrl+Alt+V**, Whisper STT on CPU; cloned Capri reference audio is **not** shipped — without it you get blips / Kokoro, not her clone. Mood refs live under `voice/ref/` when you set that up yourself.

**Can do:** text chat, open/close apps, music (Namida/Spotify: play/pause/next/search, music-only volume, “pon tu canción”), PC power with confirm, game-mode drone, drag/drop, head pats, dormant/sleep forms.

**Quit stuck:** **Ctrl+Alt+Shift+Q**, or tray **Salir** twice. Logs: `%APPDATA%\capri-desktop\logs\`. Fan project — not affiliated with CD PROJEKT RED. See [CREDITS.md](CREDITS.md) / [LICENSE](LICENSE).
