'use strict';

// Paso 4G: the PC's own power commands, straight from what you said (never the model).
// Shutting down, restarting and suspending ask first, and only a clear "sí", "dale" or
// "confirmo" within ten seconds runs them; shutting down and restarting then leave five
// seconds to change your mind (shutdown /a, or Esc). Locking and minimizing go at once.
// Nothing here touches the PC itself: `run` and `cancel` are handed in.

const { normalizeCommandText } = require('./command-text');
const { spawn } = require('node:child_process');

const CONFIRM_MS = 10_000;
const COUNTDOWN_MS = 5_000;

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
const COUNTS = new Set(['shutdown', 'restart']);
const GLITCHES = new Set(['shutdown', 'restart', 'suspend']);

// What each action runs. A countdown, five seconds, so "cancela" or Esc can still stop it.
const PROGRAMS = {
  shutdown: () => ['shutdown', ['/s', '/t', '5']],
  restart: () => ['shutdown', ['/r', '/t', '5']],
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

function abortSystem() {
  return runProgram('shutdown', ['/a']);
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
  for (const [action, re] of PATTERNS) if (re.test(n)) return { action };
  return null;
}

// run(action)     -> { ok, error }  the PC does it
// cancel()        -> { ok, error }  shutdown /a
// line(kind, v)   -> a line from lines-es.js
// say(text)       -> says and shows it
// log(text)       -> "system shutdown asked"
// event(text)     -> the SISTEMA line in the message box
// fx(action)      -> the full-screen glitch (shutdown, restart, shorter for suspend)
// escape(on)      -> take / give back Esc while the countdown runs
function createSystemFlow({
  run,
  cancel,
  line = (kind) => kind,
  say = () => {},
  log = () => {},
  event = () => {},
  fx = () => {},
  escape = () => {},
  confirmMs = CONFIRM_MS,
  countdownMs = COUNTDOWN_MS,
} = {}) {
  let pending = null;   // { action, timer }
  let countdown = null; // { action, timer }

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

  function clearCountdown() {
    if (!countdown) return null;
    clearTimeout(countdown.timer);
    const { action } = countdown;
    countdown = null;
    escape(false);
    return action;
  }

  function sayCancelled(action, why) {
    note(action, 'cancelled', why);
    event('cancelado');
    say(line('sistemaCancelado', { accion: PRESENT[action] || TERMS[action] }));
  }

  async function start(action) {
    if (GLITCHES.has(action)) fx(action);
    const result = await run(action).catch((err) => ({ ok: false, error: err.message }));
    if (!result?.ok) {
      fail(action, result?.error);
      return { ok: false };
    }
    note(action, 'ok');
    event(TERMS[action]);
    if (COUNTS.has(action)) {
      escape(true);
      countdown = {
        action,
        timer: setTimeout(() => {
          countdown = null;
          escape(false);
        }, countdownMs),
      };
      say(line('sistemaCuenta', { accion: PRESENT[action] }));
    } else {
      say(line('sistemaHecho', { accion: DONE[action] }));
    }
    return { ok: true };
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

  async function cancelCountdown(why) {
    const action = clearCountdown();
    if (!action) return null;
    const result = await cancel().catch((err) => ({ ok: false, error: err.message }));
    if (result?.ok) {
      sayCancelled(action, why);
      return { ok: true, cancelled: true };
    }
    note(action, 'failed', `cancel failed: ${result?.error || '?'}`);
    event('no pude cancelar');
    say(line('sistemaNoCancelado'));
    return { ok: false };
  }

  return {
    get pending() { return pending?.action || null; },
    get countdown() { return countdown?.action || null; },

    // An order for the machine: { ok, asked } or null when it's for the model.
    async command(text) {
      const parsed = parseSystemCommand(text);
      if (!parsed) return null;
      const { action } = parsed;
      if (ASKS.has(action)) {
        ask(action);
        return { ok: true, asked: true };
      }
      return start(action);
    },

    // Your answer while she waits: yes runs it, anything else cancels it. During the countdown,
    // "cancela" / "no" stops it (shutdown /a); anything else is a new message for the router.
    async answer(text) {
      const asking = clearPending();
      if (asking) {
        if (readAnswer(text) === 'yes') {
          note(asking, 'confirmed');
          return start(asking);
        }
        sayCancelled(asking, 'no');
        return { ok: true, cancelled: true };
      }
      if (countdown && readAnswer(text) === 'no') return cancelCountdown('voz');
      return null;
    },

    // Esc during the countdown.
    cancel(why = 'esc') {
      return cancelCountdown(why);
    },
  };
}

module.exports = {
  CONFIRM_MS, COUNTDOWN_MS, parseSystemCommand, readAnswer, createSystemFlow, runSystem, abortSystem,
};
