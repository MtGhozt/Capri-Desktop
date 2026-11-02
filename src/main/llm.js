'use strict';

const fs = require('node:fs');
const { PROVIDERS, BRAIN_GROUPS, isCloud, isAgent, requestFor, explain, provider } = require('./chat-providers');
const { modelForProvider } = require('./chat-models');
const { createStreamCleaner } = require('./chat-text');
const { stripReplyTags, createMoodStripper } = require('./mood-tag');
const { userContentWithImage } = require('./screen-look');

const HISTORY_LIMIT = 20; // ~10 user+assistant turns
const TIMEOUT_MS = 45000;
const LOCAL_TZ = 'America/Costa_Rica';

// 401/403 is a key problem: retrying it costs another wait and fails the same way.
function isAuthError(err) {
  return err?.status === 401 || err?.status === 403;
}

function temporalContext({ now = new Date(), lastTalkAt = null } = {}) {
  const parts = new Intl.DateTimeFormat('es-CR', {
    timeZone: LOCAL_TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
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
  return `Hora local: ${get('weekday')}, ${get('month')} ${get('day')} de ${get('year')} a las ${get('hour')}:${get('minute')} (${LOCAL_TZ}). Momento del día: ${period}. Última conversación: ${elapsed}.`;
}

function createLlm({
  loadConfig, personaPath, memoryPath, apiKey, screenContext, onFallback, ensureLocal,
  runAgentChat, localInstalled, now = () => new Date(),
} = {}) {
  let history = [];
  let abort = null;
  let persona = null;
  let memory = null;
  let lastTalkAt = null;
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
    return { ok: true };
  }

  function rememberAssistant(text) {
    if (!String(text || '').trim()) return;
    history = [...history, { role: 'assistant', content: String(text).trim() }].slice(-HISTORY_LIMIT);
  }

  function systemPrompt(cfg, cloud) {
    const base = personaText();
    const lang = String(cfg.lang || 'es');
    const parts = [`${base}\n\nLanguage setting: ${lang}. Always speak Spanish. ${temporalContext({ now: now(), lastTalkAt })} Si pregunta la hora o la fecha, usa esos datos.`];
    const notes = memoryText();
    if (notes) parts.push(`Notas fijas sobre el usuario (memory.md):\n${notes}`);
    // her answer is shown in a terminal box and read out loud: markers would be spelled out
    if (cloud) parts.push('Responde en texto plano, sin Markdown, sin asteriscos ni listas; frases cortas para ser leídas en voz alta. Nada de etiquetas de seguridad ni de tu razonamiento.');
    // Screen images ride on the user turn (screen-look), not the system prompt.
    return parts.join('\n\n');
  }

  // Last ~10 turns travel with every request (local and cloud): follow-ups like "sí, cuéntame"
  // need the question she just asked. Voice uses the same history via chat:send → llm.chat.
  // `image` is a raw JPEG base64 (no data: prefix); history keeps text only.
  function messagesFor(cfg, cloud, user, image) {
    const messages = [{ role: 'system', content: systemPrompt(cfg, cloud) }];
    messages.push(...history);
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
  function fallbackChain(from) {
    const order = [...(BRAIN_GROUPS.free || []), ...(BRAIN_GROUPS.own || [])];
    return order.filter((id, index) => order.indexOf(id) === index
      && id !== from && !isAgent(id) && !deadProviders.has(id) && apiKey?.(id));
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

  // OpenAI-style streaming (server-sent events): onToken as each piece comes, all of it at the end.
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
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
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
        if (json.error) throw new Error(json.error.message || 'provider error');
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) {
          full += piece;
          onToken(piece);
        }
      }
    }
    if (!full.trim()) throw Object.assign(new Error('empty'), { code: 'empty' });
    return full;
  }

  async function chat({ user, image = null, onToken, onDone, onError, onMood }) {
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

    const cfg = loadConfig();
    const id = String(cfg.llm?.provider || 'local');
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
      await streamChat(requestFor(target, {
        model: modelFor(cfg, target),
        messages: messagesFor(cfg, isCloud(target), user, jpeg),
        key: apiKey?.(target) || '',
        baseUrl: cfg.llm?.baseUrl,
      }), (piece) => {
        streamed = true; // she started answering, even if the cleaner still holds it: no fallback
        if (cleaner) cleaner.push(piece);
        else show(piece);
      }, signal);
      if (cleaner) cleaner.flush();
      stripper.flush();
      replyMood = stripper.mood || replyMood;
      replyAction = stripper.action || replyAction;
      return full;
    };

    const result = (outcome, used = id) => ({
      provider: used,
      model: modelFor(cfg, used),
      outcome,
      ms: Date.now() - started,
    });

    const done = (text) => {
      clearTimeout(timer);
      const cleaned = stripReplyTags(text);
      const finalText = cleaned.text;
      const mood = replyMood || cleaned.mood || null;
      const action = replyAction || cleaned.action || null;
      history = [
        ...history,
        { role: 'user', content: user },
        { role: 'assistant', content: finalText },
      ].slice(-HISTORY_LIMIT);
      lastTalkAt = now().getTime();
      onDone({ text: finalText, mood, action });
    };

    const fail = (err, who = id) => {
      clearTimeout(timer);
      if (signal.aborted && !timedOut) return; // you stopped her
      onError({ kind: 'offline', text: timedOut ? 'Se tardó demasiado en contestar.' : explain(err, who) });
    };

    // One turn to whoever answers: an agent CLI on this PC, or an OpenAI-compatible server.
    const attempt = async (target) => {
      if (isAgent(target) && typeof runAgentChat === 'function') {
        const text = await runAgentChat({
          provider: target,
          user,
          persona: systemPrompt(cfg, false),
          signal,
        });
        const cleaned = stripReplyTags(String(text || ''));
        if (!cleaned.text.trim()) throw Object.assign(new Error('empty'), { code: 'empty' });
        streamed = true;
        onToken(cleaned.text);
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
    if (deadProviders.has(start) && start !== 'local') {
      // Its key already failed: answer with another saved one, never paying the same wait again.
      const next = fallbackChain(start)[0];
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
    }
    if (signal.aborted && !timedOut) {
      clearTimeout(timer); // you stopped her: nothing left to say
      return null;
    }
    if (isAuthError(error)) deadProviders.add(start);

    // It gave up before a word (no network, a limit, a dead key): another saved key answers before
    // LM Studio is booted. Nothing streamed yet, or the two answers would mix.
    if (!streamed && start !== 'local') {
      for (const target of fallbackChain(start)) {
        try {
          const text = await attempt(target);
          onFallback?.(movedTo(start, target, error));
          done(text);
          return result('fallback', target);
        } catch (err) {
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

  return { chat, cancel, reset, rememberAssistant, reloadPersona, personaText };
}

module.exports = { createLlm, temporalContext };
