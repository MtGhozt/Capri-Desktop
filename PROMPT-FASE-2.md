# Fase 2 - Widget DORMANT, glitch VHS y máquina de estados

Lee `AGENTS.md` primero. Fase 1 y 1.5 ya están hechas (chat Ctrl+Alt+T, LM Studio con auto-arranque, menú HTML, instalador). **Antes de tocar código, muéstrame un plan y espera mi OK.**

## Objetivo
Que Capri se sienta "viva": cuando no la uso se duerme en un widget compacto, y al llamarla se despierta con un glitch VHS hacia la burbuja de chat. Referencia visual: el video de CursedMan (widget `CAPRI // DORMANT` que se expande a la terminal cian).

## Qué construir
1. **Widget DORMANT** (componente nuevo, por ejemplo `src/renderer/js/dormant.js`):
   - Cápsula compacta estilo terminal: fondo negro, borde cian con muescas, JetBrains Mono, texto `CAPRI // DORMANT`.
   - Icono: estrella/rombo rojo y verde con un ojo azul que parpadea lento (dibujado con CSS/SVG/canvas, sin assets con copyright nuevos).
   - Detalle sutil de vida: scanlines o un leve flicker cada pocos segundos (barato en CPU).
   - Arrastrable, y recuerda su posición en config.
2. **Cuándo se duerme / despierta:**
   - Se duerme tras `idle.dormantAfterMs` sin interacción (default 5 min, configurable; 0 = nunca), y también desde una opción del menú ("Dormir").
   - No dormirse mientras el chat esté abierto, esté generando una respuesta o haya actividad de agentes.
   - Despierta con clic en el widget, con **Ctrl+Alt+T** (despierta y abre el chat) o cuando llegue un evento importante.
   - **Ctrl+Alt+C y el biochip actuales no cambian.** Proponé en el plan si DORMANT reutiliza código de `chip.js` o es aparte, pero sin romper el biochip.
3. **Transición glitch VHS** (reutilizar `fx.js` donde se pueda):
   - Dormir: Capri/burbuja se "colapsa" con aberración cromática cian/magenta, tearing horizontal y ruido, hasta quedar el widget (~400-700 ms).
   - Despertar: el inverso, del widget a Capri + burbuja.
   - Respetar `prefers-reduced-motion` o una opción `fx.glitch: false` para apagarlo.
4. **Máquina de estados central** (por ejemplo `src/renderer/js/state.js`, una sola fuente de verdad):
   - Estados: `DORMANT`, `ONLINE`, `LISTENING`, `THINKING`, `TALKING`, más `BOOTING` y `OFFLINE` que ya existen por LM Studio.
   - `LISTENING` queda definido pero sin uso hasta la fase 3 (voz).
   - La etiqueta `CAPRI // <ESTADO>` de la burbuja y del widget sale de ese estado; bubble.js y el boot de LM Studio deben usarla en vez de manejar su propio texto.
   - Transiciones inválidas se ignoran (y se loguean en dev).
5. **Retrato con glitch al hablar:** mientras el estado es `TALKING`, el retrato/sprite de Capri tiene un glitch suave intermitente (reutilizar `fx.js`/`sprite.js`), que se apaga al volver a `ONLINE`.

## Reglas
- No tocar `voice/`, Namida, Spotify, `bridge.js` ni `hooks/`.
- Rendimiento: en DORMANT el uso de CPU/GPU debe ser casi cero (nada de animaciones pesadas en loop; pausar lo que no se vea).
- Config nueva con defaults y merge profundo como en fase 1 (`idle.dormantAfterMs`, `fx.glitch`, posición del widget).
- Commits pequeños con Conventional Commits, sin push. Al final, regenerar `pnpm dist`.

## Verificación
- Tras el tiempo de inactividad (probar con 10 s en dev) Capri se duerme con glitch y queda el widget `CAPRI // DORMANT`.
- Clic en el widget la despierta; Ctrl+Alt+T la despierta y abre el chat con foco en el input.
- Ctrl+Alt+C sigue guardándola en el biochip como antes.
- Los estados se ven bien en el chat: `ONLINE` -> `THINKING` -> `TALKING` -> `ONLINE`, y el retrato glitchea solo en `TALKING`.
- Con el widget dormido, el Administrador de tareas muestra uso casi nulo.