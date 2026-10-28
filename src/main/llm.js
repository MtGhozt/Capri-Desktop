'use strict';

const fs = require('node:fs');
const { PROVIDERS, isCloud, requestFor, explain } = require('./chat-providers');
const { createStreamCleaner } = require('./chat-text');

const HISTORY_LIMIT = 16;
const TIMEOUT_MS = 45000;
const LOCAL_TZ = 'America/Costa_Rica';

function createLlm({ loadConfig, personaPath, apiKey, screenContext, onFallback, ensureLocal } = {}) {
  let history = [];
  let abort = null;
  let persona = null;

  function readPersona() {
    try {
      return fs.readFileSync(personaPath, 'utf8').trim();
    } catch {
      return 'You are Capri. Short, sarcastic, loyal. 1–3 sentences.';
    }
  }

  // Cached so "reload persona" is a real action: the menu re-reads persona.md without a restart.
  function personaText() {
    if (persona == null) persona = readPersona();
    return persona;
  }

  function reloadPersona() {
    persona = readPersona();
    return { ok: fs.existsSync(personaPath), chars: persona.length };
  }

  function reset() {
    cancel();
    history = [];
    return { ok: true };
  }

  function localClock() {
    const parts = new Intl.DateTimeFormat('es-CR', {
      timeZone: LOCAL_TZ,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${get('weekday')}, ${get('month')} ${get('day')}, ${get('year')} ${get('hour')}:${get('minute')} (${LOCAL_TZ})`;
  }

  function systemPrompt(cfg, cloud) {
    const base = personaText();
    const lang = String(cfg.lang || 'es');
    const parts = [`${base}\n\nLanguage setting: ${lang}. Always speak Spanish. Local date and time for Matias right now: ${localClock()}. If he asks the time or date, use that.`];
    // her answer is shown in a terminal box and read out loud: markers would be spelled out
    if (cloud) parts.push('Responde en texto plano, sin Markdown, sin asteriscos ni listas; frases cortas para ser leídas en voz alta. Nada de etiquetas de seguridad ni de tu razonamiento.');
    // off by default: only what she is told to send leaves this PC
    const screen = cfg.llm?.shareScreen ? String(screenContext?.() || '').trim() : '';
    if (screen) parts.push(`What is open on Matias' screen right now: ${screen}`);
    return parts.join('\n\n');
  }

  // Her memory of the conversation travels to a cloud provider only when the switch says so.
  function messagesFor(cfg, cloud, user) {
    const messages = [{ role: 'system', content: systemPrompt(cfg, cloud) }];
    if (!cloud || cfg.llm?.shareMemory) messages.push(...history);
    messages.push({ role: 'user', content: user });
    return messages;
  }

  // The model for the provider in use: LM Studio keeps its own, so going to the cloud and back
  // doesn't lose it (config.llm.localModel).
  function modelFor(cfg, id) {
    if (id !== 'local') return String(cfg.llm?.model || PROVIDERS[id]?.model || '');
    return String(cfg.llm?.localModel || cfg.llm?.model || PROVIDERS.local.model);
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

  async function chat({ user, onToken, onDone, onError }) {
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
    const show = (piece) => {
      streamed = true;
      full += piece;
      onToken(piece);
    };
    // A cloud answer is cleaned as it arrives, sentence by sentence, so what she shows and what she
    // says are the same plain text. The local model is left exactly as it was.
    const ask = async (target) => {
      const cleaner = isCloud(target)
        ? createStreamCleaner({ onText: show })
        : null;
      const raw = await streamChat(requestFor(target, {
        model: modelFor(cfg, target),
        messages: messagesFor(cfg, isCloud(target), user),
        key: apiKey?.(target) || '',
        baseUrl: cfg.llm?.baseUrl,
      }), (piece) => {
        streamed = true; // she started answering, even if the cleaner still holds it: no fallback
        if (cleaner) cleaner.push(piece);
        else show(piece);
      }, signal);
      if (cleaner) {
        cleaner.flush();
        return full;
      }
      return raw;
    };

    const result = (outcome) => ({
      provider: id,
      model: modelFor(cfg, id),
      outcome,
      ms: Date.now() - started,
    });

    const done = (text) => {
      clearTimeout(timer);
      history = [
        ...history,
        { role: 'user', content: user },
        { role: 'assistant', content: text },
      ].slice(-HISTORY_LIMIT);
      onDone({ text });
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

  return { chat, cancel, reset, reloadPersona, personaText };
}

module.exports = { createLlm };
