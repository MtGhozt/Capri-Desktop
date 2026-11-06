# Soporte

Problemas comunes, de síntoma a arreglo. Antes de escribir en Discord, probá **Ajustes → Acerca de → Diagnóstico → Copiar reporte** (sale sin rutas ni claves) y adjuntá el reporte. Si te piden el log completo, **Acerca de → Abrir log** lo muestra en el Explorador.

## «Instalar voz» falla con 0x80070660 o 1632

**Síntoma:** el instalador de Python que abre Capri (o `voice/setup.ps1`, que usa `py -3.11`) termina con esos códigos.

**Causa:** el instalador de python.org / winget choca con builds de Windows Insider.

**Arreglo:** instalá **Python 3.11** desde la **Microsoft Store** y comprobá en PowerShell:

```powershell
py -3.11 --version
```

Después volvé a **Ajustes → Oído → Instalar voz**.

## «Hey Capri» no pudo arrancar / «DLL load failed»

**Síntoma:** la voz no arranca y `voice.log` muestra un error de DLL (`onnxruntime`, `ctranslate2`, …).

**Causa:** falta el Microsoft Visual C++ Redistributable x64.

**Arreglo:** instalá [VC++ 2015-2022 x64](https://aka.ms/vs/17/release/vc_redist.x64.exe), **reiniciá la PC** y abrí Capri.

## `CERTIFICATE_VERIFY_FAILED`

**Síntoma:** al instalar voces, modelos o claves, Python falla con `CERTIFICATE_VERIFY_FAILED`.

**Causa:** el antivirus está inspeccionando HTTPS y rompe la cadena de certificados.

**Arreglo:** agregá una excepción para Capri y para `python.exe` en el antivirus. **No** desactives la verificación SSL.

## Claude Code aparece como «No instalado»

**Síntoma:** Capri no detecta Claude Code aunque esté instalado.

**Causa:** `%USERPROFILE%\.local\bin` no está en el `PATH`.

**Arreglo:** agregá esa carpeta al `PATH` del usuario y reiniciá Capri (o abrí una consola nueva).

## PC sin GPU: la voz tarda muchísimo la primera vez

**Síntoma:** al activar voz, la primera carga tarda minutos.

**Causa:** sin GPU, Whisper corre en CPU y los modelos se cargan desde disco.

**Arreglo:** esperá la primera carga (puede tardar ~3 minutos); las siguientes son más rápidas. Si no querés esperar, usá **BLIPS**.

## LM Studio no responde

**Síntoma:** Capri dice que no hay cerebro local.

**Causa:** no hay un modelo descargado o el servidor no está levantado.

**Arreglo:** descargá un modelo en LM Studio y arrancá el servidor (`lms server start`, luego `lms load …`). Alternativa sin GPU: una clave gratis de **Gemini** en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) o **Groq**.

## ¿Dónde están los logs?

`%APPDATA%\capri-desktop\logs\voice.log`

Usá **Ajustes → Acerca de → Abrir log** para abrirlo en el Explorador, o **Copiar error** en una burbuja de error para pegar el detalle ya redactado.

Adjuntalo (o el reporte de **Diagnóstico**) cuando reportes en Discord **#bugs**.
