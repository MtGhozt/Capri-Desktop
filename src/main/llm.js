'use strict';

const fs = require('node:fs');

const HISTORY_LIMIT = 16;
const TIMEOUT_MS = 45000;
const LOCAL_TZ = 'America/Costa_Rica';

function createLlm({ loadConfig, personaPath }) {
  let history = [];
  let abort = null;

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

  function systemPrompt() {
    let base;
    try {
      base = fs.readFileSync(personaPath, 'utf8').trim();
    } catch {
      base = 'You are Capri. Short, sarcastic, loyal. 1–3 sentences.';
    }
    const lang = String(loadConfig().lang || 'es');
    return `${base}\n\nLanguage setting: ${lang}. Always speak Spanish. Local date and time for Matias right now: ${localClock()}. If he asks the time or date, use that.`;
  }

  function cancel() {
    abort?.abort();
    abort = null;
  }

  async function chat({ user, onToken, onDone, onError }) {
    cancel();
    abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, TIMEOUT_MS);

    const cfg = loadConfig();
    const baseUrl = String(cfg.llm?.baseUrl || 'http://localhost:1235/v1').replace(/\/$/, '');
    const model = cfg.llm?.model || 'google/gemma-4-e2b';
    const messages = [
      { role: 'system', content: systemPrompt() },
      ...history,
      { role: 'user', content: user },
    ];

    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          reasoning_effort: 'none',
        }),
        signal: abort.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        if (timedOut) onError({ kind: 'offline' });
        return;
      }
      onError({ kind: 'offline' });
      return;
    }

    if (!res.ok || !res.body) {
      clearTimeout(timer);
      onError({ kind: 'offline' });
      return;
    }

    let full = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
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
          const piece = json.choices?.[0]?.delta?.content;
          if (piece) {
            full += piece;
            onToken(piece);
          }
        }
      }
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        if (timedOut) onError({ kind: 'offline' });
        return;
      }
      onError({ kind: 'offline' });
      return;
    }

    clearTimeout(timer);
    if (!full.trim()) {
      onError({ kind: 'offline' });
      return;
    }

    history = [
      ...history,
      { role: 'user', content: user },
      { role: 'assistant', content: full },
    ].slice(-HISTORY_LIMIT);
    onDone({ text: full });
  }

  return { chat, cancel };
}

module.exports = { createLlm };
