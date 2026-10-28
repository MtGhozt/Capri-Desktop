'use strict';

// Paso 4G: the PC's own power commands, straight from what you said (never the model).
// Shutting down, restarting and suspending ask first, and only a clear "sí", "dale" or
// "confirmo" within ten seconds starts them: her line to the end, the screen falling apart and
// a CRT power-off, and only then the real command. "cancela", "no" or Esc until then stops it
// and nothing runs. Locking and minimizing go at once. Nothing here touches the PC itself:
// `run` is handed in.

const { normalizeCommandText } = require('./command-text');
const { spawn } = require('node:child_process');

const CONFIRM_MS = 10_000;

// "la compu", "la computadora", "el PC" (and how Whisper writes them)
const MACHINE = '(?:compu|computadora|computador|conputadora|pc|pece|pe ce|p c)';
const TARGET = `(?:la |el |mi )?${MACHINE}`;

const HEAD = /^(?:por favor|porfa|plis|please|oye|hey|eh|che|bueno|ok|okay|vale|dale|ya|ahora|entonces|mira|capri|jarvis)\s+/;
const TAIL = /\s+(?:por favor|porfa|plis|please|ya|ahora|ahorita|capri|jarvis|humanito|gracias)$/;

const PATTERNS = [
  ['shutdown', new RegExp(`^(?:apaga(?:la|lo|te|r|me)?|apague|apago|apagas|apaguen) ${TARGET}$`)],
  ['restart', new RegExp(`^(?:reinicia|renicia)(?:la|lo|r|me)? ${TARGET}$`)],
  ['restart', new RegExp(`^(?:reinicie|reinicien|reinicias) ${TARGET}$`)],
  ['suspend', new RegExp(`^(?:suspende(?:la|lo|r|me)?|suspenda|suspenden) ${TARGET}$`)],
  ['suspend', new RegExp(`^pon(?:me|e|er)? ${TARGET} a dormir$`)],
  ['suspend', new RegExp(`^pon a dormir ${TARGET}$`)],
  ['lock', new RegExp(`^(?:bloquea|blokea)(?:la|lo|me|r|do|da)? (?:${TARGET}|la pantalla|pantalla)$`)],
  ['minimize', /^(?:minimiza|minimisa)(?:lo|me|r)? todo$/],
  ['minimize', /^(?:muestrame|mostrame|muestra|mostra|ensename) (?:el )?escritorio$/],
  ['minimize', /^esconde(?:me|lo)? todo$/],
];

// "Capri, prueba el apagado": the whole show, and nothing runs (Paso 4G preview)
const PREVIEWS = [
  ['shutdown', /^(?:prueba|probar|proba|muestrame|ensename) (?:el )?(?:apagado|apagao|apagon)$/],
  ['restart', /^(?:prueba|probar|proba|muestrame|ensename) (?:el )?reinicio$/],
  ['suspend', /^(?:prueba|probar|proba|muestrame|ensename) (?:la )?suspension$/],
];

const YES = new Set(['si', 'sip', 'sii', 'dale', 'confirmo']);
// words that can ride along a yes without changing it
const YES_FILLER = new Set(['por', 'favor', 'capri', 'humanito', 'ya', 'ahora', 'pues', 'hazlo', 'hacelo', 'seguro', 'listo']);
const NO = new Set(['no', 'nop', 'nel', 'cancela', 'cancelalo', 'cancelala', 'cancelar']);

const TERMS = {
  shutdown: 'apagar la compu',
  restart: 'reiniciar la compu',
  suspend: 'suspender la compu',
  lock: 'bloquear la PC',
  minimize: 'minimizar todo',
};
// first person, for her question and the countdown
const PRESENT = {
  shutdown: 'apago la compu',
  restart: 'reinicio la compu',
  suspend: 'suspendo la compu',
};
const DONE = {
  shutdown: 'compu apagándose',
  restart: 'compu reiniciándose',
  suspend: 'compu suspendida',
  lock: 'PC bloqueada',
  minimize: 'todo minimizado',
};

const ASKS = new Set(['shutdown', 'restart', 'suspend']);

// What each action runs: at once (/t 0), because the waiting already happened on her screen.
const PROGRAMS = {
  shutdown: () => ['shutdown', ['/s', '/t', '0']],
  restart: () => ['shutdown', ['/r', '/t', '0']],
  suspend: () => ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
  lock: () => ['rundll32.exe', ['user32.dll,LockWorkStation']],
  minimize: () => ['powershell.exe', ['-NoProfile', '-Command', '(New-Object -ComObject Shell.Application).MinimizeAll()']],
};

function runProgram(file, args) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, error: 'requires Windows' });
    let child;
    try {
      child = spawn(file, args, { windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }
    child.once('error', (err) => resolve({ ok: false, error: err.message }));
    child.once('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: `${file} exited ${code}` }));
  });
}

// The real thing. main.js hands these to createSystemFlow; tests never call them.
function runSystem(action) {
  const program = PROGRAMS[action];
  if (!program) return Promise.resolve({ ok: false, error: `unknown action: ${action}` });
  return runProgram(...program());
}

// "sí", "dale", "confirmo", with a little politeness around them; "no" and cancels; anything
// else is 'other' (and, with a power command waiting, cancels it).
function readAnswer(text) {
  const n = normalizeCommandText(text);
  if (!n) return 'other';
  const words = n.split(' ');
  if (NO.has(words[0]) || /^(?:mejor no|no gracias|ni loco|ni loca|para nada)$/.test(n)) return 'no';
  if (YES.has(words[0]) && words.length <= 4 && words.slice(1).every((w) => YES_FILLER.has(w) || YES.has(w))) return 'yes';
  return 'other';
}

// The order in `text`, or null: { action } with action one of shutdown, restart, suspend,
// lock, minimize. Phrases that only mention the machine ("apaga la música", "reinicia la
// canción", "minimiza Discord", "bloquea a alguien") are not orders.
function parseSystemCommand(text) {
  let n = normalizeCommandText(text);
  for (let i = 0; i < 5 && n; i += 1) {
    const shorter = n.replace(HEAD, '').replace(TAIL, '').trim();
    if (shorter === n) break;
    n = shorter;
  }
  if (!n) return null;
  for (const [action, re] of PREVIEWS) if (re.test(n)) return { action, preview: true };
  for (const [action, re] of PATTERNS) if (re.test(n)) return { action };
  return null;
}

// run(action)         -> { ok, error }  the PC does it (only after the animation is over)
// line(kind, v)       -> a line from lines-es.js
// say(text)           -> says and shows it; resolves when she's done talking (main caps it)
// log(text)           -> "system shutdown asked"
// event(text)         -> the SISTEMA line in the message box
// fx(action, opts)    -> the full-screen fall and CRT power-off; resolves when it's over
// stopFx()            -> drop the animation now (cancelled)
// clearFx()           -> give the screen back (preview over, or the command failed)
// escape(on)          -> take / give back Esc while the sequence runs
function createSystemFlow({
  run,
  line = (kind) => kind,
  say = () => {},
  log = () => {},
  event = () => {},
  fx = () => {},
  stopFx = () => {},
  clearFx = () => {},
  escape = () => {},
  confirmMs = CONFIRM_MS,
} = {}) {
  let pending = null;  // { action, timer }: her question, waiting for your yes
  let sequence = null; // { action, preview, stop }: line, animation, power-off, then the command

  const note = (action, state, detail) => log(`system ${action} ${state}${detail ? `: ${detail}` : ''}`);

  function fail(action, error) {
    note(action, 'failed', error || 'desconocido');
    event(`no pude ${TERMS[action]}`);
    say(line('sistemaFallo', { accion: TERMS[action] }));
  }

  function clearPending() {
    if (!pending) return null;
    clearTimeout(pending.timer);
    const { action } = pending;
    pending = null;
    return action;
  }

  function sayCancelled(action, why) {
    note(action, 'cancelled', why);
    event('cancelado');
    say(line('sistemaCancelado', { accion: PRESENT[action] || TERMS[action] }));
  }

  async function runNow(action) {
    const result = await Promise.resolve()
      .then(() => run(action))
      .catch((err) => ({ ok: false, error: err.message }));
    if (!result?.ok) {
      fail(action, result?.error);
      return { ok: false };
    }
    note(action, 'ok');
    event(TERMS[action]);
    return { ok: true };
  }

  // a. confirmed (or a preview)  b. her line, to the end  c-d. the fall and the CRT power-off
  // e. only then the real command. "cancela", "no" or Esc anywhere in b-d stops it all.
  async function play(action, { preview = false } = {}) {
    let stop;
    const stopped = new Promise((resolve) => { stop = resolve; });
    const me = { action, preview, stop };
    sequence = me;
    escape(true);
    const live = () => sequence === me;
    await Promise.race([
      Promise.resolve().then(() => say(line(preview ? 'sistemaPrueba' : 'sistemaAdios', { accion: PRESENT[action] }))),
      stopped,
    ]);
    if (!live()) return { ok: true, cancelled: true };
    await Promise.race([Promise.resolve().then(() => fx(action, { preview })), stopped]);
    if (!live()) return { ok: true, cancelled: true };
    sequence = null;
    escape(false);
    if (preview) {
      clearFx();
      note(action, 'preview done');
      return { ok: true, preview: true };
    }
    const done = await runNow(action);
    if (!done.ok || action === 'suspend') clearFx(); // back from sleep, or still here: give the screen back
    return done;
  }

  function cancelSequence(why) {
    const me = sequence;
    if (!me) return null;
    sequence = null;
    escape(false);
    stopFx();
    me.stop();
    if (me.preview) {
      note(me.action, 'preview cancelled', why);
      return { ok: true, cancelled: true };
    }
    sayCancelled(me.action, why);
    return { ok: true, cancelled: true };
  }

  function ask(action) {
    clearPending();
    note(action, 'asked');
    say(line('sistemaConfirmar', { accion: PRESENT[action] }));
    pending = {
      action,
      timer: setTimeout(() => {
        pending = null;
        sayCancelled(action, 'timeout');
      }, confirmMs),
    };
  }

  return {
    get pending() { return pending?.action || null; },
    get running() { return sequence?.action || null; },

    // An order for the machine: { ok, asked } or null when it's for the model. The sequence
    // runs on its own; this answers as soon as it has started.
    async command(text) {
      const parsed = parseSystemCommand(text);
      if (!parsed) return null;
      const { action } = parsed;
      if (parsed.preview) {
        if (sequence) return { ok: false, busy: true };
        note(action, 'preview');
        play(action, { preview: true });
        return { ok: true, preview: true };
      }
      if (ASKS.has(action)) {
        if (sequence) return { ok: false, busy: true };
        ask(action);
        return { ok: true, asked: true };
      }
      return runNow(action).then((r) => {
        if (r.ok) say(line('sistemaHecho', { accion: DONE[action] }));
        return r;
      });
    },

    // Your answer while she waits: yes starts the sequence, anything else cancels it. While the
    // sequence runs, "cancela" / "no" stops it; anything else is a new message for the router.
    async answer(text) {
      const asking = clearPending();
      if (asking) {
        if (readAnswer(text) === 'yes') {
          note(asking, 'confirmed');
          play(asking);
          return { ok: true, confirmed: true };
        }
        sayCancelled(asking, 'no');
        return { ok: true, cancelled: true };
      }
      if (sequence && readAnswer(text) === 'no') return cancelSequence('voz');
      return null;
    },

    // Esc while the sequence runs.
    cancel(why = 'esc') {
      return cancelSequence(why);
    },

    // for tests: the running sequence, to await it
    play,
  };
}

module.exports = {
  CONFIRM_MS, parseSystemCommand, readAnswer, createSystemFlow, runSystem,
};
