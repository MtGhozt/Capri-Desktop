'use strict';

// Who answers her: LM Studio at home, or a cloud provider with a key. All of them speak the
// OpenAI-compatible API, so the request is built the same way and only the address changes.
// Adapted from mochiiwuff/capri-desktop affea9d, df87ec3, 38c4de7 and bde7b42 (MIT).

const PROVIDERS = {
  local: { label: 'LM Studio', local: true, model: 'google/gemma-4-e2b' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  gemini: { label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
};

const DEFAULT_PROVIDER = 'local';

function provider(id) {
  return PROVIDERS[id] || PROVIDERS[DEFAULT_PROVIDER];
}

// Her replies leave this PC only on a cloud provider.
function isCloud(id) {
  return !provider(id).local;
}

function providerOptions() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label }));
}

// One shape for all of them. The local server also gets the switch that stops Gemma from thinking
// out loud; a cloud one would only be sent fields it knows.
function requestFor(id, { model, messages, key, baseUrl } = {}) {
  const p = provider(id);
  const url = String(p.local ? baseUrl || 'http://localhost:1235/v1' : p.url).replace(/\/+$/, '');
  return {
    url: `${url}/chat/completions`,
    headers: { 'Content-Type': 'application/json', ...(key && !p.local ? { Authorization: `Bearer ${key}` } : {}) },
    body: {
      model: model || p.model,
      messages,
      stream: true,
      ...(p.local ? { reasoning_effort: 'none' } : {}),
    },
  };
}

// Why it didn't answer, in a sentence she can say. Never the server's JSON, never the key.
function explain(err, id) {
  const name = provider(id).label;
  const status = Number(err?.status) || 0;
  if (status === 401 || status === 403) return `La clave de ${name} no sirve o ya venció. Revísala en mi menú, en MODELO.`;
  if (status === 429) return `${name} está saturada o te pasaste del límite de hoy.`;
  if (status === 404) return `Ese modelo no existe en ${name}. Revisa el nombre exacto en mi menú, en MODELO.`;
  if (status >= 500) return `${name} está teniendo problemas ahora mismo.`;
  if (err?.code === 'empty') return `${name} no contestó nada.`;
  if (!status) return `No hay conexión con ${name}.`;
  return `${name} contestó algo que no entendí (${status}).`;
}

module.exports = { PROVIDERS, DEFAULT_PROVIDER, provider, isCloud, providerOptions, requestFor, explain };
