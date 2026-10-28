# Third-party notices — Capri Desktop

Este fork toma ideas y fragmentos de código de
[mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop) (el remoto `upstream`),
adaptados a mano. Nunca se copió arte, intros, webp ni ningún asset: solo código, releído y
ajustado a este proyecto.

## Licencias de upstream

- Hasta `f839580` (0.4.3), capri-desktop era **MIT**.
- Desde `023d10a` ("Free, never for sale: PolyForm Noncommercial license") es
  **PolyForm Noncommercial 1.0.0**. Lo que venga de ahí en adelante lleva en el código el
  comentario `Adapted from mochiiwuff/capri-desktop (PolyForm Noncommercial 1.0.0)`.

## Fase 4K (2026-10-27)

| Qué se adaptó | Commit de upstream | Licencia | Dónde quedó |
| --- | --- | --- | --- |
| Proveedores de chat (LM Studio, OpenRouter, Groq, Gemini, OpenAI, Mistral, DeepSeek), request compatible con OpenAI y errores en palabras simples | `affea9d`, `df87ec3`, `38c4de7`, `bde7b42` | MIT | `src/main/chat-providers.js`, `src/main/llm.js` |
| Elegir proveedor y modelo, pegar la clave cifrada y los interruptores de privacidad | `c58b36a` | MIT | `src/main/main.js`, `src/renderer/js/menu.js` |
| Volver a ser clickeable cuando el puntero está encima de ella | `59c5c5a` | PolyForm Noncommercial 1.0.0 | `src/renderer/js/app.js` |
| Opción "Pantalla" (OpenGL / sin tarjeta gráfica) para PCs donde su ventana sale negra | `4096696` | MIT | `src/main/render-mode.js`, `src/renderer/js/menu.js`, `src/main/config.js` |

## Fases anteriores (ya en el repo)

| Qué se adaptó | Commit de upstream | Licencia | Dónde quedó |
| --- | --- | --- | --- |
| Volver tras la suspensión: hook del mouse, siempre encima, sprite tras un reinicio de la GPU | `9abd955` | MIT | `src/main/main.js`, `src/main/windows.js`, `src/renderer/js/app.js`, `src/renderer/js/sprite.js` |
| Descansar en la barra de tareas, delante de ella, sin contar como app a pantalla completa | `1a783af`, `91dce66`, `24d91b2`, `bbd8b02` | MIT | `src/main/main.js`, `src/main/windows.js`, `src/main/windows.ps1` |
| La intro de tres poses | `57abd51` | MIT | `src/renderer/js/fx.js`, `src/renderer/js/capri.js` |
