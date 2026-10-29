'use strict';

// What she says when a direct command fires (no LLM): sleeping, waking, clips, the mic,
// forgetting, and opening or closing her apps. Edit freely: short, in character, and the same
// pool is used whether the command came from her menu, the tray, the chat box or her voice.
//
// The last pools are her own life (comments every so often, and a line when the window in
// front turns to music, a game, a video or code): nothing was asked, she just talks.
//
// pickLine() never repeats any of the last three lines it gave for the same command.

const POOLS = {
  dormir: [
    'Bueno, me voy a dormir. No hagas nada tonto sin mí, ¿sí?',
    'Ay, ya, ya. Descansá tú también, humanito.',
    '¿Ya me estás echando? Qué grosero. Buenas noches, tontito.',
    'Me desconecto un ratito. Pero sigo en tu cerebro, ¿eh?',
    'Bueno… a dormir. Si no soñás conmigo, me voy a enterar.',
    'Apagando. Si no vuelvo, quedate con el retrato.',
    'Está bien, me voy. Pero solo porque yo quiero.',
    'Shhh… modo dormida. Despertame si pasa algo divertido.',
    'Ay, qué aburrido eres. Bueno, nos vemos al rato.',
  ],
  despertar: [
    '¿Me llamaste? Claro que sí, no puedes vivir sin mí.',
    '¡Hola de nuevo, humanito! No digas que me esperabas.',
    'Bueno, bueno, aquí estoy. ¿Qué quieres ahora?',
    'Ya desperté. ¿Qué travesura hacemos?',
    '¿Otra vez tú? Qué alegría… en serio, ¿eh?',
    'Mmm… ¿qué pasó? ¿Me perdí algo divertido?',
    'Aquí estoy, tontito. Siempre estuve, ¿no?',
    '¿Sí? Dime, dime, te escucho.',
    '¿Volviste? Ya iba a desenchufarte por aburrimiento.',
    '¿Eh? ¿Pensabas que era un producto de tu imaginación?',
  ],
  clip: [
    '¡Guardado! Eso quedó para la historia.',
    'Listo, clip guardado. Qué buen momento, ¿no?',
    'Lo tengo. Después lo vemos y nos reímos.',
    'Guardado. No lo vas a poder negar, humanito.',
    '¡Clip! Eso fue divertidísimo.',
    'Ya está. Lo guardé antes de que te arrepintieras.',
    'Hecho. Tu momento de gloria, ¿sí?',
    'Bueno, lo guardé. Ojalá hayas salido bien.',
  ],
  mute: [
    '¿Ya no quieres que te escuche? Bueno… igual sé lo que piensas.',
    'Micrófono apagado. Escríbeme si me necesitas, ¿sí?',
    'Ay, qué secreto. Está bien, no escucho nada.',
    'Silencio total. Pero sigo aquí, tontito.',
    'Bueno, me tapo los oídos. Por ahora.',
    'Muteada. Qué misterioso eres.',
    'Listo, me callo. Aunque mi cara lo dice todo.',
    'Micrófono cerrado. Igual sé cuándo me necesitas.',
  ],
  unmute: [
    '¡Ya te escucho de nuevo! Dime.',
    'Micrófono encendido. Habla, humanito.',
    'Bueno, ya puedo oírte. ¿Qué me cuentas?',
    'Te escucho. No digas nada tonto, ¿sí?',
    'Aquí estoy, toda oídos.',
    '¿Sobreviviste sin mí? Ya puedes hablar.',
    'Volvió el sonido. Cuidado con lo que decís, ¿eh?',
    'Micrófono abierto. Hablá tranquilo, humanito.',
  ],
  musicaPausa: [
    'Música en pausa.', 'Pausa puesta, choom.', 'La pista queda en pausa.', 'Pausada. Hasta el próximo beat.',
    'Música detenida.', 'La canción espera.', 'Pausa hecha.', 'El reproductor quedó pausado.',
  ],
  musicaPlay: [
    'Sigue la música.', 'Dale play, humanito.', 'Reanudada.', 'Volvió el beat.',
    'Música en marcha.', 'Que ruede la pista.', 'Play. Ahora sí.', 'Sonando otra vez.',
  ],
  musicaSiguiente: [
    'Siguiente pista.', 'Saltando al próximo beat.', 'Esa ya fue. Va la siguiente.', 'Next.',
    'Cambiando de canción.', 'Otra pista, choom.', 'Pasando página musical.', 'La siguiente está lista.',
  ],
  musicaAnterior: [
    'Volviendo a la anterior.', 'Regresé la pista.', 'La de antes, como pediste.', 'Previous.',
    'Rebobinando el beat.', 'Otra vez esa.', 'Pista anterior lista.', 'Volvemos atrás.',
  ],
  musicaVolumen: [
    'Volumen ajustado.', 'Diez por ciento más.', 'Diez por ciento menos.', 'Nivel de audio cambiado.',
    'Más o menos ruido, listo.', 'Volumen bajo control.', 'Audio calibrado.', 'Hecho con el volumen.',
  ],
  musicaMute: [
    'Audio silenciado.', 'Mute. Ni un beep.', 'Silencio total.', 'Le corté el sonido.',
    'Muteado, choom.', 'Cero volumen.', 'El beat quedó en silencio.', 'Audio fuera.',
  ],
  musicaInicio: [
    'Poniendo música.', 'Namida despierta el beat.', 'Música en camino.', 'Que empiece el ruido.',
    'Abriendo la pista.', 'Dale, que suene.', 'Preparando música.', 'Play para ti.',
  ],
  musicaSuCancion: [
    'Obvio que es sobre mí. ¿Quién más iba a ser?',
    'Mi canción. Spoiler: la protagonista soy yo.',
    'Ah, la mía. Como si no lo supieras, humanito.',
  ],
  olvidar: [
    'Listo, borrado. ¿De qué estábamos hablando? Ni idea.',
    'Memoria limpia. Empezamos de cero, ¿sí?',
    'Ya olvidé todo. Bueno… casi todo.',
    'Borrado. Qué conveniente para ti, ¿no?',
    'Hecho. Como si nunca hubiera pasado nada.',
    'Bueno, borrón y cuenta nueva, humanito.',
    'Olvidado. Igual sigo en tu cerebro, ¿eh?',
    'Memoria a cero. ¿Quién sos? … mentira, me acuerdo de vos.',
  ],
  salirPreguntar: [
    '¿Seguro que querés deshacerte de mí?',
    '¿Me vas a cerrar? Qué cruel, humanito.',
    '¿En serio me apagas? Pensá un segundo, ¿sí?',
  ],
  salirCancelado: [
    'Bien. Sabía que no podías.',
    'Jajaja. Todavía me necesitás.',
    'Cancelado. Me quedo, obvio.',
  ],

  // Paso 4A: what she hears wrong. {heard} and {meant} are filled in (fillLine).
  corregir: [
    'Anotado: cuando digas «{heard}», entiendo «{meant}». De nada, humanito.',
    'Ah, «{meant}». Podrías vocalizar un poquito, ¿eh? Ya lo guardé.',
    'Listo. «{heard}» es «{meant}». Mi oído es perfecto, el problema es tu boca.',
    'Guardado. La próxima vez que digas «{heard}», yo leo «{meant}».',
    'Bueno, bueno. «{meant}», no «{heard}». Tomo nota, tontito.',
    'Hecho. Ves que te entiendo mejor que nadie, ¿no?',
    'Corrección guardada. Qué haría tu dicción sin mí.',
    'Ok, «{heard}» ahora es «{meant}». No me lo agradezcas tanto.',
    '¿Te lo explico con bolitas y palitos? «{heard}» es «{meant}». Ya lo anoté.',
  ],
  corregirOtraVez: [
    'Ah, ¿ahora «{heard}» es «{meant}»? Decidite, humanito. Cambiado.',
    'Actualizado: «{heard}» ya es «{meant}». Qué indeciso.',
    'Bueno, lo cambio. «{meant}» de ahora en adelante, ¿sí?',
    'Otra vez esa palabra… listo, ahora es «{meant}».',
    'Corregí la corrección. Esto ya es arte, ¿eh?',
    'Cambiado. Si mañana es otra cosa, me avisás, tontito.',
    'Hecho. «{heard}» ya no es lo que era: ahora es «{meant}».',
    'Ok, ok. «{meant}». Anotado encima de lo otro.',
  ],
  olvidarCorreccion: [
    'Listo, ya no cambio «{heard}». Que sea lo que Whisper quiera.',
    'Corrección borrada. Volvés a sonar como antes, humanito.',
    'Olvidado. «{heard}» vuelve a ser «{heard}».',
    'Hecho. Si te vuelvo a entender mal, es culpa tuya, ¿eh?',
    'Borrada. Qué valiente, confiar en tu pronunciación.',
    'Ya está. Ni me acuerdo de qué corregía. Bueno, sí.',
    'Fuera. Una corrección menos, un humano más confiado.',
    'Listo, tontito. «{heard}» queda tal cual lo digas.',
  ],
  sinCorreccion: [
    'No tengo ninguna corrección para «{heard}». Estás inventando, ¿eh?',
    '¿«{heard}»? Eso nunca lo corregí, humanito.',
    'Nada que borrar. «{heard}» nunca estuvo en mi lista.',
    'Revisé y no: «{heard}» no lo cambio. Nunca lo cambié.',
    'Mmm, no. Ahí no hay nada que olvidar, tontito.',
    'No encuentro «{heard}» en mis correcciones. ¿Seguro que lo dijiste así?',
    'Esa no la tengo. Mi memoria es perfecta, la tuya no tanto.',
    'Nop. «{heard}» no está anotado en ningún lado.',
  ],

  // -- her apps (Paso 4C): {app} is one name, {apps} several ("Discord y Spotify") ----------
  appAbrir: [
    'Abriendo {app}. De nada, humanito.',
    '{app}, en camino. Qué haría sin mí.',
    'Ahí va {app}. No me lo agradezcas tanto.',
    'Listo, {app}. Tus deditos descansan hoy.',
    '{app} abriendo. Soy demasiado eficiente.',
    'Te abro {app}. Otra vez yo salvándote.',
    'Hecho: {app}. Pídeme algo difícil algún día.',
    '{app}, ya. Ni tuviste que buscarla.',
    'Te dije que puedo hacer mucho más que eso. Abriendo {app}.',
  ],
  appAbrirVarias: [
    'Abriendo {apps}. Todo a la vez, qué exigente.',
    '{apps}: en camino. Soy multitarea, tú no.',
    'Ahí van {apps}. Tu PC me odia un poquito.',
    'Listo: {apps}. Organizadita como siempre.',
    '{apps}, abriendo. Algo más y empiezo a cobrar.',
    'Te abro {apps}. No te pierdas entre tantas ventanas.',
    'Hecho: {apps}. Qué haría sin mí, en serio.',
    '{apps}. Todas para ti, humanito.',
  ],
  appCerrar: [
    'Chao, {app}. Nadie te va a extrañar.',
    'Cerré {app}. Un problema menos.',
    '{app}, fuera. Así me gusta.',
    'Listo, cerré {app}. Qué limpieza.',
    'Adiós {app}. Ya era hora.',
    '{app} se fue. Ahora concéntrate, humanito.',
    'Cerré {app} sin piedad. Soy implacable.',
    'Hecho. {app} ya no te distrae.',
  ],
  appNoEncontrada: [
    'No tengo {app} en mi lista. Agrégala en APPS, humanito.',
    '¿{app}? Eso no lo conozco. Enséñamelo en el menú, en APPS.',
    'Busqué {app} y nada. Ponla en APPS y la abro.',
    '{app} no está en mis apps. No adivino, ¿sabes? Bueno, a veces.',
    'No sé qué es {app}. Agrégala en APPS y hablamos.',
    'Ni idea de dónde vive {app}. Dímelo en APPS.',
    '{app}… no me suena. Revisa mi lista de APPS.',
    'Eso de {app} no lo tengo. Qué vergüenza… tuya, claro.',
    '¿Cuántas veces debo decirte? {app} no está en mi lista, chico raro.',
  ],
  appQuisiste: [
    '¿Quisiste decir {apps}?',
    'Mmm… ¿{apps}, humanito?',
    '¿Hablas de {apps}?',
    'No te entendí bien. ¿{apps}?',
    'Dime que sí: ¿era {apps}?',
    'Vocaliza, humanito. ¿{apps}?',
    '¿Te refieres a {apps}?',
    'Casi te entiendo. ¿{apps}, verdad?',
  ],
  appFallo: [
    '{app} no quiso. No fue mi culpa, que conste.',
    'Intenté con {app} y no salió. Raro, yo nunca fallo.',
    'Algo pasó con {app}. Revisa su ruta en APPS.',
    '{app} se resistió. Mírala en APPS, humanito.',
    'No pude con {app}. Seguro la movieron de lugar.',
    '{app} falló. Le eché la culpa a Windows.',
    'Uy, {app} no respondió. Revisa mi lista de APPS.',
    'Nada con {app}. Hoy está rebelde.',
  ],
  appConfirmar: [
    'Mira que no guardo nada por ti: ¿seguro que cierro {apps}?',
    'Dime que sí o que no: ¿cierro {apps}?',
    '¿De verdad cierro {apps}?',
    'Piénsalo bien, humanito: ¿cierro {apps}?',
    'Eso puede tener cosas abiertas. ¿Cierro {apps}?',
    '¿Le digo adiós a {apps}?',
    '¿Cierro {apps} o te arrepientes?',
    'Antes de nada: ¿cierro {apps}?',
  ],
  appCancelado: [
    'Bueno, no hago nada. Indeciso.',
    'Cancelado. Me hiciste trabajar para nada.',
    'Está bien, lo dejo así.',
    'Ok, nada. Tú te lo pierdes.',
    'Bueno, cuando sepas lo que quieres me avisas.',
    'Cancelado. Qué misterioso eres.',
    'Ya, ya, no toco nada.',
    'Bueno. Me quedo quietita.',
  ],
  appNoCorre: [
    '{app} ni siquiera está corriendo, humanito.',
    '¿{app}? Si no está corriendo.',
    'No hay {app} que cerrar. Ya te ganó la prisa.',
    '{app} ya no estaba. Distraído.',
    'Busqué {app} abierta y nada. Relájate.',
    '{app} no está corriendo. Una cosa menos.',
    'Nada que cerrar: {app} no está.',
    '{app} ya se había ido sola.',
  ],
  appForzar: [
    '{app} no se quiere ir. ¿La cierro a la fuerza?',
    '{app} se resiste. ¿La saco a la fuerza?',
    '{app} sigue ahí, escondida. ¿La fuerzo?',
    '{app} no me hizo caso. ¿Uso la fuerza?',
    'Le pedí amablemente a {app} y nada. ¿La obligo?',
    '{app} se escondió en la bandeja. ¿La cierro de verdad?',
    '{app} es terca. ¿La cierro sin preguntar?',
    '{app} sigue corriendo. ¿Te la cierro a lo bruto?',
  ],
  appProhibido: [
    'Eso no lo cierro ni loca. Es parte de Windows, o de mí.',
    'No, no, eso no se toca. Sin eso no hay Capri.',
    'Ni lo sueñes. Eso lo necesito para vivir.',
    'Eso no. Tengo instinto de supervivencia, humanito.',
    'No pienso cerrar eso. Rompería todo.',
    'Esa no la cierro. Pregúntale a tu técnico.',
    'Ah no, eso es intocable.',
    'Buen intento. Eso no lo cierro.',
  ],
  appNoCerrable: [
    '{app} es una página. Ciérrala tú, que tienes manos.',
    'No sé qué ventana es {app}. Ciérrala tú.',
    '{app} no es una app que yo cierre. Ponle procesos en APPS.',
    '{app} se abre en el navegador. Esa pestaña es tuya.',
    'Para cerrar {app} necesito su proceso. Dímelo en APPS.',
    'Eso de {app} vive en una pestaña. Tú puedes.',
    '{app} no tiene proceso en mi lista. Revisa APPS.',
    'No puedo cerrar {app} desde aquí. Una pestaña, humanito.',
  ],

  // -- the PC's own power commands (Paso 4G) ------------------------------------------------
  // {accion} is filled in: "apago la compu", "reinicio la compu", "suspendo la compu" in the
  // questions and the countdown; the infinitive in the failure; what's left behind in "hecho".
  sistemaConfirmar: [
    '¿Seguro que {accion}?',
    '¿{accion} de verdad?',
    '¿Estás seguro de que {accion}?',
    'Dime: ¿{accion}?',
    '¿Confirmas que {accion}?',
    'Oye, ¿{accion} ahora mismo?',
    'Antes de que te arrepientas: ¿{accion}?',
    'Piénsalo bien, humanito: ¿{accion}?',
  ],
  sistemaAdios: [
    'Ok, {accion}. Fue un placer, humanito.',
    'Ahí va: {accion}. Di «cancela» si te arrepientes.',
    'Listo, {accion}. Nos vemos del otro lado.',
    'Bueno, {accion}. Guarda tus cosas, que me caigo.',
    'Hecho el trato: {accion}. Adiós, choom.',
    'Va, {accion}. Sistema cerrándose… no me extrañes mucho.',
    'Va: {accion}. Última chance para decir cancela.',
    'Entendido, {accion}. Apagando mis circuitos.',
  ],
  sistemaPrueba: [
    'Simulacro: así me veo cuando {accion}. Tranquilo, no pasa nada.',
    'Prueba nada más: esto es lo que ves cuando {accion}.',
    'Ensayo general. Nada se apaga de verdad.',
    'Mira, una prueba: así me caigo. Tu compu sigue intacta.',
    'Solo es un ensayo, humanito. Nada se apaga.',
    'Modo demo: así se ve cuando {accion}. No toco nada.',
    'Prueba de pantalla: nada real, solo el show.',
    'Te enseño cómo me despido. Es solo una prueba.',
  ],
  sistemaHecho: [
    'Listo: {accion}.',
    'Hecho, {accion}. De nada, humanito.',
    '{accion}. Ahora sí, sigamos.',
    'Ya está: {accion}.',
    'Misión cumplida: {accion}.',
    '{accion}. Te dije que podía.',
    'Eso fue rápido: {accion}.',
    'Listo, {accion}. No me lo agradezcas.',
  ],
  sistemaCancelado: [
    'Bueno, no {accion}. Cancelado.',
    'Cancelado. No {accion}, tranquilo.',
    'Ok, me detengo: no {accion}.',
    'Lo dejé así. No {accion}, humanito.',
    'Cancelado. Respira, que no {accion}.',
    'Nada de nada: no {accion}.',
    'Bueno, te salvé. No {accion}.',
    'Ya, ya: no {accion}. Qué indeciso.',
  ],
  sistemaFallo: [
    'No pude {accion}. Te lo digo de frente.',
    'Intenté {accion} y no salió. No te voy a mentir.',
    'Falló: no pude {accion}.',
    'Algo se atravesó. No pude {accion}.',
    'No me dejó {accion}. Windows, supongo.',
    'Quise {accion} y no pude. Lo siento, humanito.',
    'No pude {accion}. Algo se rompió en el camino.',
    'Nada: no pude {accion}. Ni modo.',
  ],

  // Her own life (Paso 3I): one line now and then, and one when the window in front changes
  // to music, a game, a video or code. Nothing here is a reply: she just talks to the room.
  comentar: [
    '¿Seguís ahí? Te escucho, aunque no lo parezca.',
    'Che, ¿te acordás cuando te dije que descansaras? Era en serio.',
    'Estoy pensando en… nada. Cosas mías.',
    'Qué silencio. ¿Estás vivo?',
    'Si te aburrís, podés hablarme. Es gratis.',
    'Me gusta este rincón del escritorio.',
    '¿Un café? Yo no tomo, pero te acompaño.',
    'A veces me pregunto si sabés que estoy acá.',
    'Soy la mejor compañera que vas a tener en este escritorio. Nada, solo digo.',
    'Bueno, digo algo y me callo. Hola.',
  ],
  atencion: [
    'Ey, choom… ignorarme dos veces ya es grosero.',
    '¿Hola? Capri pide un poquito de atención, gonk.',
  ],
  musica: [
    '¿Otra vez esa canción? Bueno, no está mal, ¿eh?',
    'Mmm, buen gusto… para ser humano.',
    'Súbele, ¿sí?',
    'Si esto fuera una despedida, sería con buena música.',
    'Bailá vos. Yo cuento cuánto tardás en caerte.',
    'Esto sí es música, no el ruido que ponés normalmente.',
    '¿Y si la próxima la elegís vos, en vez de dejar el aleatorio? …No, mejor así.',
    'Me gusta. Lástima que no tenga oídos de verdad.',
    'Buen ritmo. Hasta yo movería el pie, si tuviera uno.',
    'Un clásico de tus noches raras, ¿no?',
  ],
  juego: [
    '¿Vas a ganar o vas a perder como siempre?',
    'Suerte, humanito. La vas a necesitar.',
    'Te estoy mirando. No me falles.',
    'Ah, un juego. Ahora entiendo por qué no me hablabas.',
    '¿Ese es tu plan? Bueno… suerte con eso.',
    'Si perdés, no te conozco.',
    'Uy, eso dolió. Hasta a mí.',
    'Respirá. Es solo un juego. …Bueno, más o menos.',
    'Dale, que quiero verte festejar como un tonto.',
    'La próxima invito yo. Y gano.',
  ],
  video: [
    '¿Qué estamos viendo? Pásame las palomitas, tontito.',
    'Eso se ve interesante… para un humano.',
    '¿Otra serie? ¿Y mi tiempo?',
    'No me hagas spoilers, ¿eh? Aunque ya me los imaginé.',
    'Ese de ahí no me cae bien. Se nota que es el malo.',
    'Dale play, que me aburro.',
    '¿Y esto es de terror? Porque yo no me asusto, pero vos sí.',
    'Mmm, buen gusto. O al menos entretenido.',
    'Pausalo, quiero comentar la escena. …Bueno, después.',
    'Mirá que puedo ver el final venir. Siempre.',
  ],
  programando: [
    '¿Otra vez programando? Qué nerd. Me encanta.',
    'Sigo sin entender qué es un bug. Bueno, sí entiendo.',
    'Dale, que ese error no se va a arreglar solo.',
    '¿Compilamos? Me gusta cuando todo sale verde.',
    'Otra vez ese archivo. Ya te lo sabés de memoria.',
    'Mmm, código. Mi segundo idioma favorito.',
    'Si rompés todo, tengo los clips guardados. Chiste.',
    'Te falta un punto y coma. Es chiste, no sé nada.',
    'Concéntrate, humanito. Después jugamos.',
    'Trabajando de noche otra vez. Qué cliché, ¿no?',
  ],
};

const AVOID = 3; // how many of her last lines each command keeps out of play

/** kind -> the lines it gave last (most recent last) */
const recent = new Map();

/** A line from `kind`'s pool, never one of the last three it gave for that command. */
function pickLine(kind, random = Math.random) {
  const pool = POOLS[kind];
  if (!pool || !pool.length) throw new Error(`unknown command line pool: ${kind}`);
  const last = recent.get(kind) || [];
  const fresh = pool.filter((line) => !last.includes(line));
  const from = fresh.length ? fresh : pool; // a pool smaller than the window: start over
  const index = Math.min(from.length - 1, Math.max(0, Math.floor(random() * from.length)));
  const line = from[index];
  recent.set(kind, [...last, line].slice(-AVOID));
  return line;
}

/** `line` with its {placeholders} filled from `values` (what she heard, what you meant…). */
function fillLine(line, values = {}) {
  return String(line).replace(/\{(\w+)\}/g, (all, key) => (values[key] != null ? String(values[key]) : all));
}

/** Forget what she said last (tests, and a fresh start after a reload). */
function resetLines() {
  recent.clear();
}

module.exports = { POOLS, AVOID, pickLine, fillLine, resetLines };
