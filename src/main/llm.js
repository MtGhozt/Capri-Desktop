'use strict';

const fs = require('node:fs');
const { PROVIDERS, isCloud, requestFor, explain } = require('./chat-providers');
const { modelForProvider } = require('./chat-models');
const { createStreamCleaner } = require('./chat-text');
const { stripMoodTag, createMoodStripper } = require('./mood-tag');

const HISTORY_LIMIT = 20; // ~10 user+assistant turns
const TIMEOUT_MS = 45000;
const LOCAL_TZ = 'America/Costa_Rica';

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

function createLlm({ loadConfig, personaPath, memoryPath, apiKey, screenContext, onFallback, ensureLocal, now = () => new Date() } = {}) {
  let history = [];
  let abort = null;
  let persona = null;
  let memory = null;
  let lastTalkAt = null;

  function readFile(file, fallback = '') {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      return fallback;
    }
  }

  function readPersona() {
    return readFile(personaPath, 'You are Capri. Short, sarcastic, loyal. 1–3 sentences.');
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
    // off by default: only what she is told to send leaves this PC
    const screen = cfg.llm?.shareScreen ? String(screenContext?.() || '').trim() : '';
    if (screen) parts.push(`What is open on the user's screen right now: ${screen}`);
    return parts.join('\n\n');
  }

  // Last ~10 turns travel with every request (local and cloud): follow-ups like "sí, cuéntame"
  // need the question she just asked. Voice uses the same history via chat:send → llm.chat.
  function messagesFor(cfg, cloud, user) {
    const messages = [{ role: 'system', content: systemPrompt(cfg, cloud) }];
    messages.push(...history);
    messages.push({ role: 'user', content: user });
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

  async function chat({ user, onToken, onDone, onError, onMood }) {
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
    let streamed = false;
    let full = '';
    let replyMood = null;
    // A cloud answer is cleaned as it arrives, sentence by sentence, so what she shows and what she
    // says are the same plain text. The local model is left exactly as it was. Mood tags are
    // stripped before either path reaches the UI or TTS.
    const ask = async (target) => {
      full = '';
      replyMood = null;
      const stripper = createMoodStripper({
        onMood: (name) => {
          replyMood = name;
          onMood?.(name);
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
        messages: messagesFor(cfg, isCloud(target), user),
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
      return full;
    };

    const result = (outcome) => ({
      provider: id,
      model: modelFor(cfg, id),
      outcome,
      ms: Date.now() - started,
    });

    const done = (text) => {
      clearTimeout(timer);
      const cleaned = stripMoodTag(text);
      const finalText = cleaned.text;
      const mood = replyMood || cleaned.mood || null;
      history = [
        ...history,
        { role: 'user', content: user },
        { role: 'assistant', content: finalText },
      ].slice(-HISTORY_LIMIT);
      lastTalkAt = now().getTime();
      onDone({ text: finalText, mood });
    };

    const fail = (err) => {
      clearTimeout(timer);
      if (signal.aborted && !timedOut) return; // you stopped her
      onError({ kind: 'offline', text: timedOut ? 'Se tardó demasiado en contestar.' : explain(err, id) });
    };

    let error = null;
    try {
      const text = await ask(cloud ? id : 'local');
      done(text);
      return result('ok');
    } catch (err) {
      error = err;
    }
    if (signal.aborted && !timedOut) {
      clearTimeout(timer); // you stopped her: nothing left to say
      return null;
    }

    // The cloud is down (no network, a limit, a dead key): the local model answers instead, and she
    // says so in her message box. Nothing streamed yet, or the two answers would mix.
    if (cloud && !streamed) {
      const why = explain(error, id);
      onFallback?.(`${why} Te contesto con ${PROVIDERS.local.label} mientras tanto.`);
      try {
        await ensureLocal?.();
        const text = await ask('local');
        done(text);
        return result('fallback');
      } catch {
        fail(error);
        return result('failed');
      }
    }
    fail(error);
    return result('failed');
  }

  return { chat, cancel, reset, rememberAssistant, reloadPersona, personaText };
}

module.exports = { createLlm, temporalContext };
