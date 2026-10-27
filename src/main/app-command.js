'use strict';

// "abre Discord", "ciérrame Spotify", "abre Discord y YouTube", "abre la página de Google":
// opening and closing her apps (apps-config.js) without the model (Paso 4C).
//
// Only an order counts, and only for things in her table: the phrase starts with the verb
// (after "oye", "porfa", "me puedes"…), and every target has to be one of her apps, near enough.
// Talk about apps ("¿qué app usas?", "abrí Discord ayer") and anything else that isn't one of
// them ("cierra los ojos") goes to the model. A target that is only close ("abre Spotifai…"
// that reads as nothing sure) gets a "¿quisiste decir…?".

const { normalizeCommandText } = require('./command-text');
const { plainKey } = require('./apps-config');

const SURE = 0.84;  // this close to a name or alias: it's that one
const MAYBE = 0.55; // this close: she asks
const MARGIN = 0.05; // two sure ones this close to each other: she asks which

const OPEN = new Set([
  'abre', 'abri', 'abrime', 'abreme', 'abrelo', 'abrela', 'abrilo', 'abrila', 'abres', 'abris', 'abrir', 'abrirme',
  'pon', 'ponme', 'poneme', 'pone', 'pones', 'poner', 'ponerme',
  'inicia', 'inicia', 'iniciame', 'iniciar', 'lanza', 'lanzame', 'lanzar', 'ejecuta', 'ejecutame', 'ejecutar',
  'arranca', 'arrancame', 'arrancar', 'open', 'launch', 'start',
  // how Whisper writes "abre" / "ábrele" now and then
  'abra', 'abras', 'abran', 'abrame', 'abrel', 'abrele', 'abrenos', 'habre',
]);
const CLOSE = new Set([
  'cierra', 'cerra', 'cierrame', 'cerrame', 'cierralo', 'cierrala', 'cerralo', 'cerrala', 'cierras', 'cerras',
  'cerrar', 'cerrarme', 'close',
  // "cierre", and Whisper's favourite: "Sierra Discord"
  'cierre', 'cierres', 'cierren', 'sierra', 'sierre',
]);
// open verbs that are app words for sure: an unknown Capitalized name after them is "not found"
const STRONG_OPEN = new Set(['abre', 'abri', 'abrime', 'abreme', 'abres', 'abris', 'abrir', 'abrirme', 'inicia', 'iniciame', 'iniciar', 'lanza', 'lanzame', 'lanzar', 'ejecuta', 'ejecutame', 'ejecutar', 'arranca', 'arrancame', 'arrancar', 'open', 'launch']);

// said before the order: "oye", "porfa", "me puedes", "¿podrías?"…
const HEAD = /^(?:oye|oi|hey|ey|che|eh|y|e|capri|jarvis|bueno|ok|okay|okey|vale|dale|ya|entonces|mira|a\s+ver|ahora|porfa|por\s+favor|humanito|me|tu|vos|puedes|podes|podrias|pudieras|quieres|queres|podrias|necesito\s+que|quiero\s+que)\s+/;
// said after it
const TAIL = /\s+(?:porfa|por\s+favor|plis|please|ya|ahora|ahorita|rapido|capri|jarvis|humanito|gracias|si|dale|va|vale|ok|okay|un\s+momento|de\s+una)$/;
// it already happened: "abrí Discord ayer", "cerré Spotify hace un rato"
const PAST = /\b(?:ayer|anoche|antier|anteayer|antes|hace\s+(?:un\s+)?(?:rato|ratito|poco|dias|horas|minutos|semanas)|la\s+otra\s+vez|el\s+otro\s+dia|esta\s+manana|hoy\s+temprano|la\s+semana\s+pasada|el\s+finde)\b/;
// "la página de X", "X en el navegador": a link
const PAGE_HEAD = /^(?:la|una)\s+(?:pagina|web|pestana)\s+(?:de\s+|del\s+)?|^el\s+(?:sitio|link|enlace)\s+(?:de\s+|del\s+)?/;
const PAGE_TAIL = /\s+en\s+(?:el\s+|mi\s+)?(?:navegador|browser|internet|chrome|opera|la\s+web)$/;
// "la app X", "el programa X", "el juego X": it's meant as an app, known or not
const NOUN_HEAD = /^(?:la|una|el|un|mi)\s+(?:app|aplicacion|programa|juego|jueguito)\s+(?:de\s+|del\s+)?/;
const ARTICLE = /^(?:el|la|los|las|lo|mi|mis|un|una|al|del|a)\s+/;
const SPLIT = /\s+(?:y\s+tambien|y\s+luego|y\s+despues|y|e|mas|tambien)\s+/;

// Optimal string alignment distance (Levenshtein with swapped neighbours as one edit).
function osa(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

// 1 = the same, 0 = nothing alike (spaces and accents don't count).
function similarity(a, b) {
  const x = plainKey(a);
  const y = plainKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // short words only count when exact: "la" is not "lol"
  if (Math.min(x.length, y.length) < 4) return 0;
  const plain = 1 - osa(x, y) / Math.max(x.length, y.length);
  return Math.max(plain, soundsLike(x, y));
}

// An English name the way a Spanish ear (and Whisper in Spanish) writes it: "Hollow Knight"
// comes out "Holunite", "jolo nait" or "hola unite". Both sides go to a rough sound key (no h/j,
// "ight" = "ait", w = u, v = b, o = u, no doubles, no silent final e) and are compared there,
// a bit below a spelled match so a real spelling always wins.
function soundKey(key) {
  return key
    .replace(/ight/g, 'ait').replace(/kn/g, 'n').replace(/ph/g, 'f').replace(/th/g, 't').replace(/sh/g, 's')
    .replace(/ck|qu/g, 'k').replace(/c(?=[ei])/g, 's').replace(/c/g, 'k').replace(/z/g, 's')
    .replace(/v/g, 'b').replace(/w/g, 'u').replace(/y/g, 'i').replace(/[hj]/g, '').replace(/u/g, 'o')
    .replace(/(.)\1+/g, '$1').replace(/[ae]i/g, 'i').replace(/([^aeiou])e$/, '$1');
}

function soundsLike(x, y) {
  const a = soundKey(x);
  const b = soundKey(y);
  if (Math.min(a.length, b.length) < 5) return 0;
  const near = 1 - osa(a, b) / Math.max(a.length, b.length);
  // only a near sound counts: loose sounds made "la puerta" sound like Opera
  return near >= 0.8 ? 0.97 * near : 0;
}

// How well `phrase` names `app` (its name or one of its aliases).
function scoreApp(app, phrase) {
  let best = 0;
  for (const name of [app.name, ...(app.aliases || [])]) best = Math.max(best, similarity(name, phrase));
  return best;
}

// The app `phrase` names: { status: 'sure' | 'maybe' | 'none', app, score }.
// `links`: a page was asked for, so her links go first.
function matchApp(apps, phrase, { links = false } = {}) {
  const ranked = (apps || [])
    .map((app) => ({ app, score: scoreApp(app, phrase) + (links && app.type === 'link' ? 0.001 : 0) }))
    .sort((a, b) => b.score - a.score);
  const [top, second] = ranked;
  if (!top || top.score < MAYBE) return { status: 'none', app: null, score: top?.score || 0 };
  if (top.score >= SURE) {
    const tie = second && second.app !== top.app && second.score >= SURE && top.score - second.score < MARGIN && top.score < 1;
    return { status: tie ? 'maybe' : 'sure', app: top.app, score: top.score };
  }
  return { status: 'maybe', app: top.app, score: top.score };
}

function strip(text, patterns) {
  let n = text;
  for (let changed = true; changed && n;) {
    changed = false;
    for (const re of patterns) {
      const shorter = n.replace(re, '').trim();
      if (shorter !== n) {
        n = shorter;
        changed = true;
      }
    }
  }
  return n;
}

// Words of `original` written with a capital past its first word: names ("abre Fortnite").
function namedWords(original) {
  const words = String(original || '').replace(/^[^\p{L}\p{N}]+/u, '').split(/\s+/).slice(1);
  return new Set(words.filter((w) => /^[^\p{L}]*\p{Lu}/u.test(w) && !/^(?:capri|jarvis)/i.test(w)).map(plainKey));
}

// One target as said: page/noun markers off, then the article.
function readTarget(raw) {
  let said = raw.trim();
  let page = false;
  let noun = false;
  if (PAGE_HEAD.test(said)) { said = said.replace(PAGE_HEAD, ''); page = true; }
  if (PAGE_TAIL.test(said)) { said = said.replace(PAGE_TAIL, ''); page = true; }
  if (NOUN_HEAD.test(said)) { said = said.replace(NOUN_HEAD, ''); noun = true; }
  said = strip(said, [ARTICLE, TAIL]);
  return { said, page, noun };
}

// The order in `text`, or null when it isn't one:
// { action: 'open' | 'close', page, items: [{ said, status, app, score, noun, named }], verb }
function parseAppCommand(text, apps) {
  const original = String(text || '');
  // calling her first ("oye Capri, abre…") is not a target; other commas split targets, and the
  // normalizing below would drop them
  const called = original.replace(/^[\s¡¿]*(?:(?:oye|hey|ey|eh|oi|che|bueno|ok|okay|okey|vale|dale|ya|ahora|entonces|mira|y)[\s,.]+)*(?:(?:capri|jarvis)\b[\s,:]*)?/i, '');
  let n = strip(normalizeCommandText(called.replace(/\s*[,;]\s*/g, ' y ')), [HEAD, TAIL]);
  if (!n || PAST.test(n)) return null;
  const [verb, ...rest] = n.split(' ');
  const action = OPEN.has(verb) ? 'open' : CLOSE.has(verb) ? 'close' : null;
  if (!action || !rest.length) return null;
  n = rest.join(' ').replace(/^(?:y|e)\s+/, ''); // "Sierra, Holunite": the comma became "y"
  if (!n) return null;
  const named = namedWords(original);
  const written = new Map(String(original).split(/\s+/).map((w) => [plainKey(w), w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')]));
  const asWritten = (said) => said.split(' ').map((w) => written.get(plainKey(w)) || w).join(' ');
  const whole = readTarget(n);
  const read = (t) => {
    const m = matchApp(apps, t.said, { links: t.page });
    const isNamed = t.said.split(' ').some((w) => named.has(plainKey(w)));
    return { said: asWritten(t.said), page: t.page, noun: t.noun, named: isNamed, ...m };
  };
  // the whole rest as one name first ("Opera GX", a name with "y" in it), else split
  let items = [read(whole)];
  let glued = null;
  if (items[0].status !== 'sure' && /[,;]/.test(called)) {
    // Whisper puts commas inside names too ("Sierra, hola, Unite"): read it once without them
    const plain = strip(normalizeCommandText(called.replace(/[,;]/g, ' ')), [HEAD, TAIL]).split(' ').slice(1).join(' ');
    glued = plain ? read(readTarget(plain)) : null;
    if (glued?.status === 'sure') return { action, verb, page: glued.page, items: [glued] };
  }
  if (items[0].status !== 'sure' && SPLIT.test(n)) {
    const parts = n.split(SPLIT).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1 && parts.length <= 6) {
      const page = whole.page;
      items = parts.map((p) => {
        const t = readTarget(p);
        return read({ ...t, page: t.page || page });
      });
    }
  }
  // nothing in the pieces, but the whole thing without commas was close: ask about that
  if (glued?.status === 'maybe' && items.every((i) => i.status === 'none')) items = [glued];
  items = items.filter((i) => i.said);
  if (!items.length) return null;
  return { action, verb, page: items.some((i) => i.page), items };
}

// What to do about it:
//   { kind: 'do', action, apps, missing }   every target found (missing: the ones not found at all)
//   { kind: 'ask', action, apps, suggest }  some only close: "¿quisiste decir…?" first
//   { kind: 'notFound', action, missing }   none found, but clearly meant as apps
//   null                                     not about her apps: the model answers
function planAppCommand(parsed) {
  if (!parsed) return null;
  const { action, verb, items } = parsed;
  const sure = items.filter((i) => i.status === 'sure');
  const maybe = items.filter((i) => i.status === 'maybe');
  const none = items.filter((i) => i.status === 'none');
  const meant = (i) => i.noun || i.page || i.named;
  const unique = (list) => [...new Set(list)];
  if (!sure.length && !maybe.length) {
    // "abre Fortnite", "abre la app de Fortnite": she says she doesn't have it
    const strong = action === 'open' ? STRONG_OPEN.has(verb) : true;
    if (strong && none.length && none.every(meant)) return { kind: 'notFound', action, missing: none.map((i) => i.said) };
    return null;
  }
  // a single unknown word among sure ones that isn't meant as an app: still not an order
  if (none.length && !none.every(meant) && !sure.length) return null;
  if (maybe.length) {
    if (none.length && !none.every(meant)) return null;
    return {
      kind: 'ask',
      action,
      apps: unique(items.filter((i) => i.app && i.status !== 'none').map((i) => i.app)),
      suggest: unique(maybe.map((i) => i.app)),
      missing: none.map((i) => i.said),
    };
  }
  if (none.length && !none.every(meant)) {
    // "abre Discord y los ojos": half an order is not an order
    return null;
  }
  return { kind: 'do', action, apps: unique(sure.map((i) => i.app)), missing: none.map((i) => i.said) };
}

// "Discord, Spotify y YouTube"
function joinNames(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
}

const KIND = { program: 'programa', steam: 'juego de Steam', link: 'enlace' };
const MODE = { graceful: 'con cuidado', force: 'a la fuerza', ask: 'preguntando antes' };

// Her menu's "Probar comando": what she would do, done nothing.
function describePlan(plan) {
  if (!plan) return 'No es una orden de apps: se lo paso al modelo.';
  const who = (list) => joinNames(list.map((a) => (plan.action === 'open'
    ? `${a.name} (${KIND[a.type] || a.type})`
    : `${a.name} (${MODE[a.close] || a.close})`)));
  if (plan.kind === 'notFound') return `Diría que no encuentro ${joinNames(plan.missing.map((m) => `«${m}»`))}.`;
  if (plan.kind === 'ask') return `Preguntaría: «¿Quisiste decir ${joinNames(plan.suggest.map((a) => a.name))}?» y, si dices que sí, ${plan.action === 'open' ? 'abriría' : 'cerraría'} ${who(plan.apps)}.`;
  const missing = plan.missing?.length ? ` No encontraría ${joinNames(plan.missing.map((m) => `«${m}»`))}.` : '';
  return `${plan.action === 'open' ? 'Abriría' : 'Cerraría'} ${who(plan.apps)}.${missing}`;
}

module.exports = {
  SURE, MAYBE, osa, similarity, soundKey, scoreApp, matchApp, parseAppCommand, planAppCommand, joinNames, describePlan,
};
