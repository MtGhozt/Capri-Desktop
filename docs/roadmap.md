# Capri — Roadmap (actualizado 2026-10-26)

Upstream de referencia: mochiiwuff/capri-desktop v0.4.0 (`bde7b42`). Nunca push a upstream. Traer cosas por partes (port manual o cherry-pick), no merge completo.

## Fase 3 — Voz y overlay ✅ (cerrar con 3D–3F)
- [x] OmniVoice clon + Kokoro fallback, blips, wake "Hey Jarvis", sleep, persona Edgerunners.
- [x] 3C menú por secciones estilo CP2077 + clips NVIDIA (Alt+F10).
- [ ] 3D liberar recursos: descargar OmniVoice/Kokoro en BLIPS/SILENCIO y en DORMANT largo; mute pausa el stream.
- [ ] 3E temas del menú: CYBERPUNK / CAPRI.
- [ ] 3F traer de upstream:
  - Volver tras suspensión de la PC (`9abd955`: main.js, preload.js, app.js, sprite.js).
  - Barra de tareas (`1a783af`, `91dce66` parte taskbar, `24d91b2`, `bbd8b02`): apoyarse sobre la barra; si la barra cambia de altura/aparece (tecla Windows), Capri sube con ella en vez de quedar tapada.
  - Intro nueva (`57abd51`): saludo de 3 poses, brazo "smear", ojos felices (intro-happy/smear/wave3.webp + fx.js).
  - "Iniciar con Windows" en el menú overlay (COMPORTAMIENTO). Ya existe en el tray (`setLoginItemSettings`), solo exponerlo.

## Fase 4 — Acciones en la PC
- Base: upstream `5ecbae7` (src/main/launch.js, chat.js, apps.js): abrir apps, juegos, sitios y música desde el chat.
- Adaptar a: comandos directos en español, confirmación antes de abrir, Namida + Spotify.
- Apagar PC con confirmación.
- Quitar "módulo no conectado" de persona.md para lo que ya funcione.

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