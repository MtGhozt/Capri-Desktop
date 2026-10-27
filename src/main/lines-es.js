'use strict';

// What she says when a direct command fires (no LLM): sleeping, waking, clips, the mic and
// forgetting. Edit freely: short, in character, and the same pool is used whether the command
// came from her menu, the tray, the chat box or her voice.
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
    'Bueno… a dormir. Soñá conmigo, ¿sí?',
    'Apagando. No me extrañes demasiado.',
    'Está bien, me voy. Pero solo porque yo quiero.',
    'Shhh… modo dormida. Despertame si pasa algo divertido.',
    'Ay, qué aburrido eres. Bueno, nos vemos al rato.',
  ],
  despertar: [
    '¿Me llamaste? Claro que sí, no puedes vivir sin mí.',
    '¡Hola de nuevo, humanito! ¿Me extrañaste?',
    'Bueno, bueno, aquí estoy. ¿Qué quieres ahora?',
    'Ya desperté. ¿Qué travesura hacemos?',
    '¿Otra vez tú? Qué alegría… en serio, ¿eh?',
    'Mmm… ¿qué pasó? ¿Me perdí algo divertido?',
    'Aquí estoy, tontito. Siempre estuve, ¿no?',
    '¿Sí? Dime, dime, te escucho.',
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
    '¿Me extrañaste? Ya puedes hablarme.',
    'Volvió el sonido. Cuidado con lo que decís, ¿eh?',
    'Micrófono abierto. Hablá tranquilo, humanito.',
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
  musica: [
    '¿Otra vez esa canción? Bueno, no está mal, ¿eh?',
    'Mmm, buen gusto… para ser humano.',
    'Súbele, ¿sí?',
    'Esa canción te la dedico. No, mentira. Casi.',
    '¿Bailamos? Digo… vos bailás, yo miro.',
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

/** Forget what she said last (tests, and a fresh start after a reload). */
function resetLines() {
  recent.clear();
}

module.exports = { POOLS, AVOID, pickLine, resetLines };
