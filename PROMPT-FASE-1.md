Lee AGENTS.md completo y revisa el código en src/ antes de empezar. Vamos con la FASE 1: chat por texto con Capri usando LM Studio.

Objetivo:
1. Correr el proyecto tal cual (`pnpm install` y `pnpm start`; migra de package-lock a pnpm con `pnpm import` y borra package-lock.json) y confirmar que funciona.
2. Crear una burbuja estilo terminal cyberpunk (borde cian con muescas, fondo negro, fuente monoespaciada) encima del retrato de Capri, reutilizando lo que sirva de panel.js:
   - Historial: `> you: ...` y `CAPRI > ...` (con efecto de escritura).
   - Input: `YOU > say something...` que se pueda enfocar y escribir (usar el IPC overlay:interactive para que la ventana acepte clicks solo en esa zona).
   - Etiqueta de estado `CAPRI // ONLINE | THINKING | TALKING`, con THINKING mostrando `decrypting ### %` animado.
3. Nuevo módulo en el proceso main (por ejemplo src/main/llm.js) que llame a LM Studio en `http://localhost:1235/v1/chat/completions` con `stream: true` y `reasoning_effort: "none"` (ver sección LM Studio de AGENTS.md: puerto 1235, modelo google/gemma-4-e2b) y mande los tokens al renderer por IPC. URL y modelo configurables en config.js.
4. System prompt de personaje: Capri, construct de Project Capricorn, habla con jerga de Cyberpunk (choom, gonk, nova, preem), sarcástica pero leal, respuestas de 1–3 frases. Guárdalo en un archivo editable (por ejemplo src/main/persona.md).
5. Si LM Studio no está corriendo, Capri muestra un mensaje en personaje en vez de romperse.
6. Atajo para abrir/cerrar el chat (reusar Ctrl+Alt+C si tiene sentido).

No toques todavía la voz, música ni los hooks. Antes de programar, muéstrame un plan corto con los archivos que vas a crear o cambiar y espera mi OK.