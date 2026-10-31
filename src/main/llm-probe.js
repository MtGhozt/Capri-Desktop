'use strict';

// Minimal real request to check a provider works. Never logs the key; errors go through explain().

const { provider, requestFor, explain, isCloud } = require('./chat-providers');

async function probeProvider({
  id,
  model,
  key = '',
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = 10000,
} = {}) {
  const p = provider(id);
  if (isCloud(id) && !String(key || '').trim()) {
    return { ok: false, message: `Falta la key de ${p.label}.` };
  }

  const req = requestFor(id, {
    model: model || p.model,
    key,
    baseUrl,
    stream: false,
    messages: [{ role: 'user', content: 'Responde solo: ok' }],
  });
  req.body.max_tokens = 8;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, message: explain({ status: res.status }, id) };
    let data = null;
    try {
      data = await res.json();
    } catch {
      return { ok: false, message: explain({ code: 'empty' }, id) };
    }
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) return { ok: false, message: explain({ code: 'empty' }, id) };
    return { ok: true, message: `Listo. ${p.label} contesta.` };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, message: `${p.label} tardó demasiado en contestar.` };
    return { ok: false, message: explain({ offline: true }, id) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { probeProvider };
