# Changelog

## 0.1.2

- Wake: "Hey Capri" / mangled forms already stripped before the LLM; wake-only opens a follow-up listen window
- Salir: confirm window stays solid (no click-through); Sí always quits; e2e clicks Sí once
- Volumen / mute solo de la música (API de Spotify o sesión de Windows del player), nunca el master
- Persona: teasing más juguetón, insultos raros
- TTS: avisa si falta un transcript de mood/ref; OmniVoice más determinista (`position_temperature` 0)
- Perf: poll de ventanas 300 ms; caricias menos IPC; rAF del dron/Capri pausados al ocultar; idle del sidecar más lento

## 0.1.1

- Ánimos de voz automáticos (burla, emoción, aburrida, seria)
- Despierta diciendo "Capri" (Whisper), además de "Hey Capri"; Ctrl+Alt+V para escuchar/detener
- Filtro de silencio: ya no "oye" cosas cuando nadie habla
- "Pon tu canción", y puede abrir apps / poner música desde el chat
- Memoria de los últimos mensajes del chat
- Pausas naturales al hablar
- Te pregunta antes de cerrarse; salida de emergencia Ctrl+Alt+Shift+Q
- Arreglos: micrófono que no abría, menú/Salir que se trababan, cuelgue al acariciarla, aviso de VRAM
- Recuperación automática si la ventana falla
