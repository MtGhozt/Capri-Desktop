# Integración con Namida (fase 4)

Verificado en esta PC: exe en `C:\Software\Namida\namida\namida.exe`; biblioteca en `%USERPROFILE%\.namida\tracks.db` (SQLite, ~8 MB).

## Enfoque
1. **Qué está sonando + play/pausa/siguiente/anterior:** Windows SMTC (GlobalSystemMediaTransportControls) vía `winrt-Windows.Media.Control` (pywinrt) o `winsdk`. Namida lo publica de serie. Filtrar la sesión por "namida" o por el GUID `94dba250-1e0f-11f0-846e-a101934a6b13` (verificar el `source_app_user_model_id` real). Ojo: el comando play de Namida alterna play/pausa.
2. **"Pon X":** leer `tracks.db` en solo lectura (`file:...?mode=ro`, usa WAL). Tabla `tracks`: `key` = ruta absoluta, `value` = JSON con `title`, `originalArtist`, `originalAlbum`, etc. Búsqueda difusa con `rapidfuzz` y lanzar `namida.exe "<ruta>"`: reutiliza la instancia abierta (single instance). Para varias canciones, generar un `.m3u` temporal.
3. **Opcional:** webhook de Namida (Advanced settings → flags → WEBHOOK; solo en betas desde oct-2026) manda POST JSON en `trackChanged`/`play`/`pause` con la ruta del archivo.

Sin API local de control ni esquema URL propio. Spotify queda como extra (Web API, requiere Premium): en el panel de la app de Spotify Developer, el redirect URI es `http://127.0.0.1:47835/callback` (el 47824 está tomado por el sidecar de voz).