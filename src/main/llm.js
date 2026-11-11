'use strict';

const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const {
  PROVIDERS, BRAIN_GROUPS, isCloud, isAgent, supportsVision, requestFor, explain, provider, activeBrainIds,
} = require('./chat-providers');
const { modelForProvider } = require('./chat-models');
const { createStreamCleaner } = require('./chat-text');
const { stripReplyTags, createMoodStripper, absorbToolCall, ACTION_TAG_HELP } = require('./mood-tag');
const { userContentWithImage } = require('./screen-look');

const HISTORY_LIMIT = 20; // ~10 user+assistant turns
const HISTORY_IDLE_MS = 10 * 60 * 1000; // after this long, old turns are no context
const COMMENT_WINDOW_MS = 60 * 1000; // an unprompted line only counts for its follow-up
const TIMEOUT_MS = 45000;
const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// A zone name Intl accepts, or ''.
function validTimeZone(zone) {
  const value = String(zone || '').trim();
  if (!value) return '';
  try {
    new Intl.DateTimeFormat('es-CR', { timeZone: value });
    return value;
  } catch {
    return '';
  }
}

// '' / invalid saved zone = automatic: this PC's zone, UTC if Windows gives none.
function resolveTimeZone(zone = '') {
  return validTimeZone(zone) || validTimeZone(SYSTEM_TZ) || 'UTC';
}

// 401/403 is a key problem: retrying it costs another wait and fails the same way.
function isAuthError(err) {
  return err?.status === 401 || err?.status === 403;
}

// The provider answering right now: the first active brain, else the configured one (same as chat).
function activeBrain(cfg) {
  return Array.isArray(cfg.llm?.brains)
    ? activeBrainIds(cfg.llm)[0]
    : String(cfg.llm?.provider || 'local');
}

function temporalContext({ now = new Date(), lastTalkAt = null, timeZone = '', extras = '' } = {}) {
  const zone = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('es-CR', {
    timeZone: zone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const hour = Number(get('hour'));
  const period = hour < 6 ? 'madrugada' : hour < 12 ? 'mañana' : hour < 19 ? 'tarde' : 'noche';
  let elapsed = 'sin conversación previa en esta sesión (no menciones fecha ni hora salvo que él lo pida o importe)';
  if (Number.isFinite(lastTalkAt)) {
    const minutes = Math.max(0, Math.round((now.getTime() - lastTalkAt) / 60000));
    if (minutes < 1) elapsed = 'hace menos de 1 minuto';
    else if (minutes < 60) elapsed = `hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
    else {
      const hours = Math.round(minutes / 60);
      elapsed = `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    }
  }
  const base = `Hora local: ${get('weekday')}, ${get('month')} ${get('day')} de ${get('year')} a las ${get('hour')}:${get('minute')} (${zone}). Momento del día: ${period}. Última conversación: ${elapsed}.`;
  const extra = String(extras || '').trim();
  return extra ? `${base} ${extra}` : base;
}

function createLlm({
  loadConfig, personaPath, memoryPath, apiKey, screenContext, onFallback, ensureLocal,
  runAgentChat, localInstalled, temporalExtras, now = () => new Date(),
} = {}) {
  let history = [];
  let abort = null;
  let persona = null;
  let memory = null;
  let lastTalkAt = null;
  let pendingComment = null; // last unprompted line, for a follow-up answer only
  let turnExtras = ''; // weather/holidays for this chat turn only (empty when offline)
  // A key the provider already refused is not asked again this session: every message would pay
  // the same wait.
  const deadProviders = new Set();

  function readFile(file, fallback = '') {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      return fallback;
    }
  }

  function readPersona() {
    return readFile(personaPath, 'You are Capri. Short, chaotic, warm, loyal. 1–3 sentences.');
  }

  function readMemory() {
    // Drop comment-only lines so an empty template doesn't pollute the prompt.
    const raw = readFile(memoryPath, '');
    return raw.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n').trim();
  }

  // Cached so "reload persona" is a real action: the menu re-reads persona.md without a restart.
  function personaText() {
    if (persona == null) persona = readPersona();
    return persona;
  }

  function memoryText() {
    if (memory == null) memory = readMemory();
    return memory;
  }

  function reloadPersona() {
    persona = readPersona();
    memory = readMemory();
    return { ok: fs.existsSync(personaPath), chars: persona.length };
  }

  function reset() {
    cancel();
    history = [];
    lastTalkAt = null;
    pendingComment = null;
    return { ok: true };
  }

  function rememberAssistant(text) {
    if (!String(text || '').trim()) return;
    history = [...history, { role: 'assistant', content: String(text).trim() }].slice(-HISTORY_LIMIT);
  }

  // Unprompted comments stay out of history: only the newest one may answer a follow-up.
  function rememberComment(text, ttlMs = COMMENT_WINDOW_MS) {
    const line = String(text || '').trim();
    if (!line) return;
    pendingComment = { text: line, at: now().getTime(), ttlMs: Number(ttlMs) || 0 };
  }

  function systemPrompt(cfg, cloud, id = activeBrain(cfg)) {
    const base = personaText();
    const lang = String(cfg.lang || 'es');
    const when = temporalContext({
      now: now(), lastTalkAt, timeZone: cfg.timeZone, extras: turnExtras,
    });
    const parts = [`${base}\n\nLanguage setting: ${lang}. Always speak Spanish. ${when} Si pregunta la hora o la fecha, usa esos datos. Si hay clima o feriados arriba, usalos; si no, no inventes.`];
    const model = isAgent(id) ? '' : ` (modelo ${modelFor(cfg, id)})`;
    parts.push(`Tu cerebro ahora es ${provider(id).label}${model}. Si te preguntan qué modelo o IA sos, decí eso; seguís siendo Capri, nunca otra IA ni otra empresa.`);
    const notes = memoryText();
    if (notes) parts.push(`Notas fijas sobre el usuario (memory.md):\n${notes}`);
    const name = String(cfg.userName || '').trim();
    if (name) parts.push(`El usuario se llama ${name}; llamalo así de vez en cuando, sin abusar.`);
    parts.push('Si el mensaje es corto, ambiguo o parece dicho a otra persona, no inventes contexto: preguntá brevemente qué quiso decir o respondé algo neutro. Nunca supongas temas (código, juegos, etc.) que el usuario no mencionó en esta charla.');
    parts.push(ACTION_TAG_HELP);
    // her answer is shown in a terminal box and read out loud: markers would be spelled out
    if (cloud) parts.push('Responde en texto plano, sin Markdown, sin asteriscos ni listas; frases cortas para ser leídas en voz alta. Nada de etiquetas de seguridad ni de tu razonamiento.');
    // Screen images ride on the user turn (screen-look), not the system prompt.
    return parts.join('\n\n');
  }

  // Last ~10 turns travel with every request (local and cloud): follow-ups like "sí, cuéntame"
  // need the question she just asked. Voice uses the same history via chat:send → llm.chat.
  // `image` is a raw JPEG base64 (no data: prefix); history keeps text only.
  function messagesFor(cfg, cloud, user, image, id = activeBrain(cfg)) {
    const at = now().getTime();
    // A fragment after a long silence is not a continuation: drop the old turns.
    if (Number.isFinite(lastTalkAt) && at - lastTalkAt > HISTORY_IDLE_MS) history = [];
    const comment = pendingComment;
    pendingComment = null;
    const freshComment = comment && at - comment.at <= comment.ttlMs ? comment.text : null;
    const messages = [{ role: 'system', content: systemPrompt(cfg, cloud, id) }];
    messages.push(...history);
    if (freshComment) messages.push({ role: 'assistant', content: freshComment });
    const fg = String(screenContext?.() || '').trim();
    const text = image && fg ? `${user}\n\n(Ventana al frente: ${fg})` : user;
    messages.push({ role: 'user', content: userContentWithImage(text, image) });
    return messages;
  }

  // The model for the provider in use: LM Studio keeps its own, so going to the cloud and back
  // doesn't lose it (config.llm.localModel).
  function modelFor(cfg, id) {
    return modelForProvider(cfg.llm || {}, id, PROVIDERS);
  }

  function cancel() {
    abort?.abort();
    abort = null;
  }

  // The free ones (Gemini first) then the paid ones: a saved key answers before LM Studio is
  // booted, which takes minutes. No key, no turn.
  function fallbackChain(from, cfg, image = false) {
    const order = [
      ...activeBrainIds(cfg.llm),
      ...(!Array.isArray(cfg.llm.brains) ? [...(BRAIN_GROUPS.free || []), ...(BRAIN_GROUPS.own || [])] : []),
      'local',
    ];
    return order.filter((id, index) => order.indexOf(id) === index
      && id !== from && !deadProviders.has(id)
      && (!isCloud(id) || apiKey?.(id) || id === 'local')
      && (!image || supportsVision(id, modelFor(cfg, id))));
  }

  function providerLabel(id) {
    return provider(id).label;
  }

  // Who she moved to, in one line. An auth failure says only the key is wrong.
  function movedTo(from, to, err) {
    return isAuthError(err)
      ? `La key de ${providerLabel(from)} no funciona, usando ${providerLabel(to)}.`
      : `${explain(err, from)} Te contesto con ${providerLabel(to)} mientras tanto.`;
  }

  // Message sizes for the timing line: counts only, never the text.
  function promptStats(messages) {
    let sys = 0;
    let hist = 0;
    let req = 0;
    for (const msg of messages || []) {
      const content = msg?.content;
      let n = 0;
      if (typeof content === 'string') n = content.length;
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part?.text === 'string') n += part.text.length;
        }
      }
      req += n;
      if (msg?.role === 'system') sys += n;
      else hist += 1;
    }
    return { sys, hist, req };
  }

  // OpenAI-style streaming (server-sent events): onToken as each piece comes, all of it at the end.
  // stream=1 only when content arrived across more than one network read (a single dump is stream=0).
  async function streamChat(request, onToken, signal) {
    let res;
    try {
      res = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal,
      });
    } catch (err) {
      throw Object.assign(new Error(err.message || 'network'), { offline: true });
    }
    if (!res.ok || !res.body) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });

    let full = '';
    let readsWithContent = 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      let hit = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.error) throw Object.assign(new Error(json.error.message || 'provider error'), { status: res.status });
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) {
          hit = true;
          full += piece;
          onToken(piece);
        }
      }
      if (hit) readsWithContent += 1;
    }
    if (!full.trim()) throw Object.assign(new Error('empty'), { code: 'empty', status: res.status });
    return { text: full, stream: readsWithContent > 1 ? 1 : 0, status: res.status };
  }

  async function chat({ user, image = null, onToken, onDone, onError, onMood, onTiming }) {
    cancel();
    abort = new AbortController();
    const signal = abort.signal;
    let timedOut = false;
    const controller = abort;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    const started = Date.now();
    const chatAt = performance.now();
    // ctx = chat entry -> HTTP (temporalExtras, persona/memory, messagesFor). net = fetch -> first token.
    let reqAt = 0;
    let firstAt = 0;
    let sent = false;
    let attempts = 0;
    let lastHttp = null;
    let lastStream = null;
    let lastStats = null;
    const onRequest = () => {
      const at = performance.now();
      if (!sent) {
        sent = true;
        onTiming?.({ phase: 'request' });
      }
      reqAt = at;
      firstAt = 0;
    };
    const onFirst = () => {
      if (!firstAt) firstAt = performance.now();
    };

    const cfg = loadConfig();
    turnExtras = '';
    if (typeof temporalExtras === 'function') {
      // weather + optional PC info for this user line (cfg, user)
      try { turnExtras = String(await temporalExtras(cfg, user) || '').trim(); } catch { turnExtras = ''; }
    }
    const id = activeBrain(cfg);
    const cloud = isCloud(id);
    const jpeg = image ? String(image) : null;
    let streamed = false;
    let full = '';
    let replyMood = null;
    let replyAction = null;
    // A cloud answer is cleaned as it arrives, sentence by sentence, so what she shows and what she
    // says are the same plain text. The local model is left exactly as it was. Mood tags are
    // stripped before either path reaches the UI or TTS.
    const ask = async (target) => {
      full = '';
      replyMood = null;
      replyAction = null;
      const stripper = createMoodStripper({
        onMood: (name) => {
          replyMood = name;
          onMood?.(name);
        },
        onAction: (act) => {
          replyAction = act;
        },
        onText: (piece) => {
          streamed = true;
          full += piece;
          onToken(piece);
        },
      });
      const show = (piece) => stripper.push(piece);
      const cleaner = isCloud(target)
        ? createStreamCleaner({ onText: show })
        : null;
      const messages = messagesFor(cfg, isCloud(target), user, jpeg, target);
      lastStats = promptStats(messages);
      const wire = await streamChat(requestFor(target, {
        model: modelFor(cfg, target),
        messages,
        key: apiKey?.(target) || '',
        baseUrl: cfg.llm?.baseUrl,
      }), (piece) => {
        onFirst();
        streamed = true; // she started answering, even if the cleaner still holds it: no fallback
        if (cleaner) cleaner.push(piece);
        else show(piece);
      }, signal);
      lastHttp = wire.status;
      lastStream = wire.stream;
      if (cleaner) cleaner.flush();
      stripper.flush();
      replyMood = stripper.mood || replyMood;
      replyAction = stripper.action || replyAction;
      return wire.text;
    };

    const result = (outcome, used = id) => ({
      provider: used,
      model: modelFor(cfg, used),
      outcome,
      ms: Date.now() - started,
      retries: Math.max(0, attempts - 1),
      ...(lastStats || {}),
      ...(lastStream === 0 || lastStream === 1 ? { stream: lastStream } : {}),
      ...(lastHttp != null ? { http: lastHttp } : {}),
      ...(reqAt ? {
        ctx: Math.round(reqAt - chatAt),
        llmFull: Math.round(performance.now() - reqAt),
        ...(firstAt ? { net: Math.round(firstAt - reqAt) } : {}),
      } : {
        ctx: Math.round(performance.now() - chatAt),
      }),
    });

    const done = (text) => {
      clearTimeout(timer);
      const cleaned = stripReplyTags(text);
      const leak = absorbToolCall(cleaned.text);
      const finalText = leak ? leak.text : cleaned.text;
      const mood = leak ? null : (replyMood || cleaned.mood || null);
      const action = leak ? leak.action : (replyAction || cleaned.action || null);
      history = [
        ...history,
        { role: 'user', content: user },
        { role: 'assistant', content: finalText },
      ].slice(-HISTORY_LIMIT);
      lastTalkAt = now().getTime();
      pendingComment = null;
      onDone({
        text: finalText,
        mood,
        action,
        ...(leak ? { toolLeak: leak.raw, toolLeakUnknown: leak.unknown } : {}),
      });
    };

    const fail = (err, who = id) => {
      clearTimeout(timer);
      if (signal.aborted && !timedOut) return; // you stopped her
      onError({ kind: 'offline', text: timedOut ? 'Se tardó demasiado en contestar.' : explain(err, who) });
    };

    // One turn to whoever answers: an agent CLI on this PC, or an OpenAI-compatible server.
    const attempt = async (target) => {
      attempts += 1;
      onRequest();
      if (isAgent(target) && typeof runAgentChat === 'function') {
        if (jpeg) {
          throw Object.assign(new Error('agent vision fallback'), { code: 'no-vision' });
        }
        lastStats = promptStats([
          { role: 'system', content: systemPrompt(cfg, false, target) },
          { role: 'user', content: user },
        ]);
        lastStream = 0;
        lastHttp = null;
        const text = await runAgentChat({
          provider: target,
          user,
          persona: systemPrompt(cfg, false, target),
          signal,
        });
        const cleaned = stripReplyTags(String(text || ''));
        const leak = absorbToolCall(cleaned.text);
        if (!cleaned.text.trim() && !leak) throw Object.assign(new Error('empty'), { code: 'empty' });
        streamed = true;
        onFirst();
        // tool-call JSON must not hit the bubble/TTS; done() absorbs and onDone replaces
        if (!leak) onToken(cleaned.text);
        return cleaned.text;
      }
      return ask(target);
    };

    // A local model only answers when its CLI is installed: booting it takes minutes otherwise.
    const askLocal = async () => {
      if (localInstalled?.() === false) throw Object.assign(new Error('offline'), { offline: true });
      await ensureLocal?.();
      return attempt('local');
    };

    let start = isAgent(id) || cloud ? id : 'local';
    if (jpeg && !supportsVision(start, modelFor(cfg, start))) {
      start = fallbackChain(start, cfg, true)[0] || '';
    }
    if (!start) {
      fail({ code: 'no-vision' }, id);
      return result('failed', id);
    }
    if (deadProviders.has(start) && start !== 'local') {
      // Its key already failed: answer with another saved one, never paying the same wait again.
      const next = fallbackChain(start, cfg, Boolean(jpeg))[0];
      if (next) start = next;
      else {
        try {
          const text = await askLocal();
          done(text);
          return result('fallback', 'local');
        } catch {
          fail({ status: 401 }, id);
          return result('failed', id);
        }
      }
    }

    let error = null;
    try {
      const text = await attempt(start);
      done(text);
      return result(start === id ? 'ok' : 'fallback', start);
    } catch (err) {
      error = err;
      if (Number.isFinite(err?.status)) lastHttp = err.status;
    }
    if (signal.aborted && !timedOut) {
      clearTimeout(timer); // you stopped her: nothing left to say
      return null;
    }
    if (isAuthError(error)) deadProviders.add(start);

    // It gave up before a word (no network, a limit, a dead key): another saved key answers before
    // LM Studio is booted. Nothing streamed yet, or the two answers would mix.
    if (!streamed && start !== 'local') {
      for (const target of fallbackChain(start, cfg, Boolean(jpeg))) {
        try {
          const text = await attempt(target);
          onFallback?.(movedTo(start, target, error));
          done(text);
          return result('fallback', target);
        } catch (err) {
          if (Number.isFinite(err?.status)) lastHttp = err.status;
          if (signal.aborted && !timedOut) {
            clearTimeout(timer);
            return null;
          }
          if (streamed) { // she already said half an answer: never mix in another voice
            fail(err, target);
            return result('failed', target);
          }
          if (isAuthError(err)) deadProviders.add(target);
          error = err;
        }
      }
      // Last resort: the local model, and only when it is installed.
      try {
        const text = await askLocal();
        onFallback?.(movedTo(start, 'local', error));
        done(text);
        return result('fallback', 'local');
      } catch {
        fail(error, start);
        return result('failed', start);
      }
    }
    fail(error, start);
    return result('failed', start);
  }

  return { chat, cancel, reset, rememberAssistant, rememberComment, reloadPersona, personaText };
}

module.exports = { createLlm, temporalContext, resolveTimeZone };
