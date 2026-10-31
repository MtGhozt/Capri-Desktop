'use strict';

// Who answers her: a local server at home, or a cloud provider with a key. All of them speak the
// OpenAI-compatible API, so the request is built the same way and only the address changes.
// Adapted from mochiiwuff/capri-desktop affea9d, df87ec3, 38c4de7 and bde7b42 (MIT).
// Claude/Anthropic is not here on purpose (not OpenAI-compatible; no new SDK).

const PROVIDERS = {
  local: { label: 'LM Studio', local: true, url: 'http://localhost:1235/v1', model: 'google/gemma-4-e2b' },
  ollama: { label: 'Ollama', local: true, url: 'http://localhost:11434/v1', model: 'llama3.2' },
  nvidia: { label: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct' },
  gemini: { label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-lite-latest' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
};

// Cards in Ajustes › Cerebro (same ids as PROVIDERS; Gemini sits in free and own).
const BRAIN_GROUPS = {
  free: ['nvidia', 'gemini'],
  local: ['local', 'ollama'],
  own: ['openai', 'deepseek', 'gemini', 'openrouter', 'groq', 'mistral'],
};

const FREE_KEY_LINKS = {
  nvidia: { label: 'NVIDIA', url: 'https://build.nvidia.com/' },
  gemini: { label: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' },
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

function defaultBaseUrl(id) {
  return provider(id).url || 'http://localhost:1235/v1';
}

// One shape for all of them. The local server also gets the switch that stops Gemma from thinking
// out loud; a cloud one would only be sent fields it knows.
function requestFor(id, { model, messages, key, baseUrl, stream = true } = {}) {
  const p = provider(id);
  const url = String(p.local ? baseUrl || p.url || 'http://localhost:1235/v1' : p.url).replace(/\/+$/, '');
  return {
    url: `${url}/chat/completions`,
    headers: { 'Content-Type': 'application/json', ...(key && !p.local ? { Authorization: `Bearer ${key}` } : {}) },
    body: {
      model: model || p.model,
      messages,
      stream: Boolean(stream),
      ...(p.local ? { reasoning_effort: 'none' } : {}),
    },
  };
}

// Why it didn't answer, in a sentence she can say. Never the server's JSON, never the key.
function explain(err, id) {
  const name = provider(id).label;
  const status = Number(err?.status) || 0;
  if (status === 401 || status === 403) return `Key inválida o vencida en ${name}. Pégala de nuevo en Cerebro.`;
  if (status === 429) return `${name} está saturada o te pasaste del límite de hoy.`;
  if (status === 404) return `Ese modelo no existe en ${name}. Revisa el nombre exacto en Cerebro.`;
  if (status >= 500) return `${name} está teniendo problemas ahora mismo.`;
  if (err?.code === 'empty') return `${name} no contestó nada.`;
  if (!status) {
    if (id === 'ollama') return 'Ollama no está abierto. Ábrelo y vuelve a probar.';
    if (id === 'local') return 'LM Studio no está abierto. Ábrelo y vuelve a probar.';
    return `No hay conexión con ${name}.`;
  }
  return `${name} contestó algo que no entendí (${status}).`;
}

module.exports = {
  PROVIDERS,
  BRAIN_GROUPS,
  FREE_KEY_LINKS,
  DEFAULT_PROVIDER,
  provider,
  isCloud,
  providerOptions,
  defaultBaseUrl,
  requestFor,
  explain,
};
