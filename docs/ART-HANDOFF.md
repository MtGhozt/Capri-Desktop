# Capri — kit de entrega para redibujar

Guía para el artista que va a redibujar a Capri. Cómo generar el reel y las stills:

```bash
pnpm demo:art           # reproduce todo en secuencia con leyendas (para grabar pantalla)
pnpm demo:art -- --shots  # además guarda PNG transparentes en Escritorio\capri-art-kit\shots\
```

Al terminar, esta misma guía se copia a `%USERPROFILE%\Desktop\capri-art-kit\ART-HANDOFF.md`.

---

## Assets de imagen

Todo vive bajo `assets/capri/` salvo los iconos.

### Cuerpo / base

| Archivo | Tamaño | Dónde se usa |
| --- | --- | --- |
| `capri-full.png` | 240×420 | Sprite principal de pie (WebGL / cut-out) |
| `capri-cutout.png` | 220×420 | Variante cut-out / silueta |
| `capri-face.png` | 256×256 | Cara por defecto del panel (`grin`) |

### Caras (retrato del panel)

| Archivo | Tamaño | Uso |
| --- | --- | --- |
| `face-calm.png` | 256×256 | Mirando, boca cerrada |
| `face-aside.png` | 256×256 | Mirada de lado / suspiro |
| `face-smug.png` | 256×256 | Sonrisa con colmillo |
| `face-wide.png` | 256×256 | Sorpresa |
| `face-look.png` | 256×256 | Mirándote de frente |
| `face-laugh.png` | 256×256 | Risa boca abierta |
| `face-many.png` | 256×256 | Todos sus ojos |

### Cut-ins (primeros planos)

| Archivo | Tamaño | Uso |
| --- | --- | --- |
| `cutin-grin.png` | 360×240 | Primer plano sonrisa |
| `cutin-laugh.png` | 360×240 | Primer plano risa |
| `cutin-eyes.png` | 360×240 | Primer plano ojos |
| `cutin-many.png` | 360×240 | Primer plano muchos ojos |
| `cutin-look.png` | 360×240 | Primer plano mirada |

### Intro (secuencia al arrancar)

Frames WebP en `assets/capri/intro-*.webp`: `grab`, `smear`, `happy`, `mouth1`–`mouth3`, `wave1`–`wave3`. Se reproducen en la intro (agarra el borde de la pantalla, saluda, se suelta).

### Poses tumbadas (`poses/`)

Canvas **721×644** (mismas medidas en todas):

| Archivo | Uso |
| --- | --- |
| `lying_A.png`, `lying_A_1.png`, `lying_A_2.png` | Pose lieA (loop de piernas) |
| `lying_B_0.png` … `lying_B_3.png` | Pose lieB |

Se usan en la **caja de mensajes** y al tumbarse en el borde de una **ventana**.

### Capas de sit (`parts/`)

| Archivo | Tamaño | Uso |
| --- | --- | --- |
| `arm_L.png` | 174×234 | Brazo izquierdo (sit) |
| `arm_R.png` | 230×176 | Brazo derecho (sit) |
| `face-*.png` (7) | 256×256 | Caras superpuestas al sentarse |
| `parts.json` | — | Pivotes / cajas de recorte de brazos |

### Iconos (`assets/icons/`)

| Archivo | Tamaño | Uso |
| --- | --- | --- |
| `capri.png` | 256×256 | Icono de app |
| `tray.png` | 32×32 | Bandeja del sistema |
| `capri.ico` | multi | Instalador / exe Windows |

---

## Dibujado en código (sin PNG de personaje)

Con un boceto o sprite de la idea basta; adaptamos código o lo sustituimos por sprites.

| Qué | Archivo | Aspecto |
| --- | --- | --- |
| Satélite y estrellas | `src/renderer/js/acting.js` + `fx.js` | Punto de luz que cruza el cielo; motas de la melena que se alinean en un “camino”; destello al responder |
| Chispas y rayos | `fx.js` | Relámpago rojo/cian desde la mano; chispas al abrir/cerrar apps; beams de teletransporte |
| Máscara y biochip | `chip.js` | Al dormir: máscara verde + ojos; al guardar: chip con ojos que siguen el cursor |
| Ojo DORMANT | `dormant.js` | Widget compacto con estrella/ojo y etiqueta `CAPRI // DORMANT` |
| Rasgado de pantalla | `system-fx.js` | Glitch fuerte antes de apagar / reiniciar el PC |
| Dron de juego | `drone.js` | Capri reducida a un dron ligero mientras hay un juego a pantalla completa |

---

## Formato preferido

- PNG con **transparencia**
- **Mismo tamaño de canvas** por familia de poses (p. ej. todas las lying 721×644; caras 256×256; cut-ins 360×240)
- Capas separadas de **brazos** y **cara** si puedes (como en `parts/`)
- Mantén el contacto / pivote aproximado (cadera en el borde al tumbarse; pies al estar de pie)

---

## Aún no hecho / wishlist

1. **Caricias (head pats)** — reacción feliz, pies pateando. Marcado *próximamente* en el README.
2. **Más “vida”** — micro-movimientos en idle, respiración, parpadeo, mirar el cursor, reaccionar a clics.
3. **Pose asomándose (peek)** — en vez de quedarse rígida en una esquina tras teletransportarse: agarrar el borde del monitor con las dos manos y asomar la cabeza; variante asomándose detrás de una ventana pequeña (manos en el borde + cabeza).
4. **Estilo propio a largo plazo** — sustituir el arte original (mochiiwuff / frames del show) por el vuestro.

---

## Créditos

Arte y código base: [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop). Capri es fan art de *Cyberpunk: Edgerunners 2*; no afiliado a CD PROJEKT RED. Ver `CREDITS.md` y `LICENSE`.
