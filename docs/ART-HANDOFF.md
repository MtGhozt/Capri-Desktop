# Capri — kit de entrega para redibujar

Guía para el artista que va a redibujar a Capri. Cómo generar el reel y las stills:

```bash
pnpm demo:art           # reproduce todo en secuencia con leyendas (para grabar pantalla)
pnpm demo:art -- --shots  # además guarda PNG transparentes en Escritorio\capri-art-kit\shots\
```

Al terminar (también con `--shots`), esta misma guía se copia a `%USERPROFILE%\Desktop\capri-art-kit\ART-HANDOFF.md`.

---

## Assets de imagen

Todo vive bajo `assets/capri/` salvo los iconos.

### Cuerpo / base

| Archivo | Tamaño | Cuándo se usa |
| --- | --- | --- |
| `capri-full.png` | 240×420 | Casi siempre: Capri **de pie / flotando** en el escritorio (sprite WebGL) |
| `capri-cutout.png` | 220×420 | Variante cut-out / silueta del mismo cuerpo |
| `capri-face.png` | 256×256 | Cara por defecto del panel de mensajes (`grin`) cuando no hay otra expresión |

### Caras (retrato del panel de mensajes)

Aparecen en la **caja / panel** junto a ella cuando habla o reacciona a Claude / al chat. El mensaje elige la cara según el tono.

| Archivo | Tamaño | Cuándo se usa |
| --- | --- | --- |
| `face-calm.png` | 256×256 | Mirando, boca cerrada — trabajo / idle tranquilo |
| `face-aside.png` | 256×256 | Mirada de lado / suspiro — compactar, despedida, “me ignoras” |
| `face-smug.png` | 256×256 | Sonrisa con colmillo — permisos, chulería |
| `face-wide.png` | 256×256 | Sorpresa — errores, crashes |
| `face-look.png` | 256×256 | Mirándote de frente — fin de tarea, “done” |
| `face-laugh.png` | 256×256 | Risa boca abierta — fallos caóticos |
| `face-many.png` | 256×256 | Todos sus ojos — alertas / te necesita |

### Cut-ins (primeros planos)

Saltan un momento al lado de su cabeza durante **actuaciones** (reír, zap, satélite, victoria, etc.), no sustituyen el cuerpo.

| Archivo | Tamaño | Cuándo se usa |
| --- | --- | --- |
| `cutin-grin.png` | 360×240 | Durante risas / actos alegres |
| `cutin-laugh.png` | 360×240 | Risa grande |
| `cutin-eyes.png` | 360×240 | Mirada intensa (p. ej. satélite / zap) |
| `cutin-many.png` | 360×240 | “Todos los ojos” en actos de sorpresa |
| `cutin-look.png` | 360×240 | Mirada directa en actos de atención |

### Intro (secuencia al arrancar)

Frames WebP `intro-*.webp` (`grab`, `smear`, `happy`, `mouth1`–`mouth3`, `wave1`–`wave3`).

**Cuándo:** solo al **primer arranque** (o si la intro está activada en ajustes): agarra el borde de la pantalla, saluda, se suelta y cae a su sitio de pie.

### Poses de pie / sentada / tumbada (sprite + `poses/`)

| Estado / pose | Aspecto | Cuándo se usa |
| --- | --- | --- |
| **stand** (de pie / flotando) | `capri-full.png` + animación idle | Estado normal en el escritorio; barra de tareas; tras teletransporte |
| **sit** (sentada en ventana) | Cuerpo sentado + brazos/cara de `parts/` | Se posa en el **borde superior de una ventana**; piernas patean |
| **lieA / lieB** (tumbada) | Hojas `poses/lying_A*.png` / `lying_B*.png` (721×644) | Tumbada en el **borde de una ventana** o en la **caja de mensajes**; loop de piernas |
| **stand/sit en la caja** | Igual que stand/sit pero anclada al chat | Cuando la burbuja de chat está abierta y se sube a ella |
| **peek** (asomada) | De pie, medio fuera del borde de pantalla | A veces tras teletransportarse a un **borde** (hoy rígida; wishlist: agarrar el borde) |
| **fall** | Caída / aterrizaje | Al soltarla al arrastrar, o si la ventana donde estaba se cierra |

Archivos `poses/`:

| Archivo | Uso |
| --- | --- |
| `lying_A.png`, `lying_A_1.png`, `lying_A_2.png` | Pose **lieA** (loop) |
| `lying_B_0.png` … `lying_B_3.png` | Pose **lieB** (loop) |

### Capas de sit (`parts/`)

Solo cuando está **sentada** (`sit`): brazos y cara encima del cuerpo.

| Archivo | Tamaño | Cuándo se usa |
| --- | --- | --- |
| `arm_L.png` / `arm_R.png` | 174×234 / 230×176 | Brazos en pose sit |
| `face-*.png` (7) | 256×256 | Cara en sit (mismas expresiones que el panel) |
| `parts.json` | — | Pivotes de brazos |

### Iconos (`assets/icons/`)

| Archivo | Tamaño | Cuándo se usa |
| --- | --- | --- |
| `capri.png` | 256×256 | Icono de la app |
| `tray.png` | 32×32 | Icono de la **bandeja** del sistema (menú / mostrar) |
| `capri.ico` | multi | Instalador / `.exe` en Windows |

---

## Formas pequeñas: cuándo aparece cada una

Hoy Capri tiene **cuatro formas chicas** además del cuerpo completo. Más abajo te pedimos opinión: la idea es bajarlas a **dos** (una para dormir, una para jugar).

### 1. Cápsula DORMANT (`dormant.js`)

- **Qué se ve:** un widget compacto (estrella / ojo) con texto tipo `CAPRI // DORMANT` (u otro estado: ONLINE, THINKING…).
- **Cuándo aparece:** tras **~5 minutos** sin usarla (sin chat, sin menú, sin estar ocupada). Se “pliega” sola al widget. También si le pides dormir / “duérmete” (fold forzado).
- **Interacciones:** **clic** en el widget → se despierta (vuelve el cuerpo + a veces abre el chat). El cursor encima marca el widget como clickeable.
- **Vuelta a Capri normal:** clic en el widget, o escribirle / despertarla por voz o atajo de chat; pasa por un glitch corto y reaparece de pie.

### 2. Máscara flotante (`Mask` en `chip.js`)

- **Qué se ve:** solo la **máscara verde** con ojos (cerrados / entreabiertos), flotando donde estaba la cara. El cuerpo ya no se dibuja.
- **Cuándo aparece:** si lleva un rato en modo **dormida** (primero se queda “dormida” en su sitio; después de un tiempo extra hace *doze* y se queda en máscara). No es el mismo widget DORMANT.
- **Interacciones:** pasar el **cursor encima** ~0,4 s la remueve (ojos / wake).
- **Vuelta a Capri normal:** hover que la despierta → el cuerpo se vuelve a armar alrededor de la máscara (o en el borde si seguía en una ventana).

### 3. Biochip guardada (`Chip` en `chip.js`)

- **Qué se ve:** un **chip / biochip** en una esquina; los ojitos del chip siguen el cursor si pasas por encima.
- **Cuándo aparece:** atajo **Ctrl+Alt+C** (mostrar / ocultar), o cuando la config la deja “no visible”. Es “guardarla en el chip”, no el sueño idle.
- **Interacciones:** **clic** en el chip → sale otra vez. Hover: los ojos siguen el puntero (no la saca sola).
- **Vuelta a Capri normal:** clic en el chip, otra vez Ctrl+Alt+C, o acciones que la “despliegan” (chat, etc.).

### 4. Dron de modo juego (`drone.js`)

- **Qué se ve:** Capri reducida a un **dron / sonda** pequeño que sigue un poco el cursor; el cuerpo grande se oculta.
- **Cuándo aparece:** entra un **juego a pantalla completa** y el modo juego / dron está activo (auto). Así no tapa el juego.
- **Interacciones:** el dron se mueve hacia el puntero; clic en el dron puede interactuar según el hit del dron. Se puede apagar el dron en ajustes (Comportamiento).
- **Vuelta a Capri normal:** sales del juego a pantalla completa (o desactivas el modo) → desaparece el dron y vuelve el cuerpo (o el widget DORMANT si seguía plegada).

### Pregunta para el artista (importante)

Más adelante queremos **juntar estas formas en solo dos**:

1. **Una forma de “dormir / estar guardada”** (hoy: DORMANT + máscara + biochip).
2. **Una forma de “modo juego”** (hoy: el dron).

**¿Cuál de las tres de sueño/guardado te gusta más como base?** (cápsula DORMANT, máscara flotante, o biochip). ¿O prefieres un diseño nuevo que mezcle lo mejor de las tres? Dínoslo y adaptamos código / sprites.

---

## Dibujado en código (sin PNG de personaje)

Con un boceto o sprite de la idea basta; adaptamos el código o lo sustituimos por sprites.

| Qué | Archivo | Aspecto | Cuándo se usa |
| --- | --- | --- | --- |
| Satélite y estrellas | `acting.js` + `fx.js` | Punto de luz; motas de melena en un “camino”; destello | Mirada al cielo idle, o la secuencia grande (menú / tras un trabajo largo) |
| Chispas y rayos | `fx.js` | Relámpago, chispas, beams | Zap al cursor, abrir/cerrar apps, teletransporte |
| Máscara y biochip | `chip.js` | Ver sección “Formas pequeñas” | Sueño profundo / Ctrl+Alt+C |
| Ojo DORMANT | `dormant.js` | Widget estrella + etiqueta | Idle ~5 min o “duérmete” |
| Rasgado de pantalla | `system-fx.js` | Glitch fuerte de pantalla | Antes de apagar / reiniciar / suspender el PC (comando de sistema) |
| Dron de juego | `drone.js` | Sonda pequeña | Juego a pantalla completa |

---

## Formato preferido

- PNG con **transparencia**
- **Mismo tamaño de canvas** por familia (lying 721×644; caras 256×256; cut-ins 360×240)
- Capas separadas de **brazos** y **cara** si puedes (como en `parts/`)
- Mantén el contacto / pivote aproximado (cadera en el borde al tumbarse; pies al estar de pie)

---

## Aún no hecho / wishlist

1. **Caricias (head pats)** — reacción feliz, pies pateando. *Próximamente* en el README.
2. **Más “vida”** — micro-movimientos en idle, respiración, parpadeo, mirar el cursor, reaccionar a clics.
3. **Pose asomándose (peek)** — agarrar el borde del monitor con las dos manos y asomar la cabeza; variante detrás de una ventana pequeña (manos en el borde + cabeza). Hoy el peek es más “rígida en la esquina”.
4. **Estilo propio a largo plazo** — sustituir el arte original (mochiiwuff / frames del show) por el vuestro.
5. **Unificar formas pequeñas** — ver pregunta arriba (2 formas: dormir + juego).

---

## Créditos

Arte y código base: [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop). Capri es fan art de *Cyberpunk: Edgerunners 2*; no afiliado a CD PROJEKT RED. Ver `CREDITS.md` y `LICENSE`.
