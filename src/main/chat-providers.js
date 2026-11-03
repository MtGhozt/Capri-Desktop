'use strict';

// Who answers her: a local server at home, or a cloud provider with a key. All of them speak the
// OpenAI-compatible API, so the request is built the same way and only the address changes.
// Adapted from mochiiwuff/capri-desktop affea9d, df87ec3, 38c4de7 and bde7b42 (MIT).
// Agent-* providers shell out to an installed CLI (see agent-brain.js); no Capri-managed tokens.

const PROVIDERS = {
  local: { label: 'LM Studio', local: true, url: 'http://localhost:1235/v1', model: 'google/gemma-4-e2b', vision: 'model' },
  ollama: { label: 'Ollama', local: true, url: 'http://localhost:11434/v1', model: 'llama3.2', vision: 'model' },
  nvidia: { label: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct', vision: false },
  gemini: { label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-lite-latest', vision: true },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', vision: true },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', vision: false },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', vision: true },
  anthropic: { label: 'Anthropic', url: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5-20251001', vision: true },
  xai: { label: 'Grok (xAI)', url: 'https://api.x.ai/v1', model: 'grok-4-1-fast-non-reasoning', vision: true },
  mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', vision: false },
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', vision: false },
  'agent-auto': { label: 'Automático', local: true, agent: 'auto', model: 'agent', vision: false },
  'agent-claude': { label: 'Claude Code (CLI)', local: true, agent: 'claude', model: 'agent', vision: false },
  'agent-cursor': { label: 'Cursor (CLI)', local: true, agent: 'cursor-agent', model: 'agent', vision: false },
  'agent-opencode': { label: 'OpenCode (CLI)', local: true, agent: 'opencode', model: 'agent', vision: false },
  'agent-codex': { label: 'Codex (CLI)', local: true, agent: 'codex', model: 'agent', vision: false },
  'agent-gemini': { label: 'Gemini CLI', local: true, agent: 'gemini', model: 'agent', vision: false },
};

// Local LM Studio / Ollama: only if the model name looks multimodal.
const LOCAL_VISION_RE = /llava|bakllava|vision|moondream|minicpm-v|qwen2?\.?5?-?vl|qwen-vl|pixtral|gemma-3|gpt-4o|claude-3|claude-4/i;

// Cards in Ajustes › Cerebro (same ids as PROVIDERS; Gemini sits in free and own).
const BRAIN_GROUPS = {
  free: ['gemini', 'nvidia'], // Gemini first = recommended free path
  local: ['local', 'ollama'],
  own: ['openai', 'anthropic', 'xai', 'deepseek', 'gemini', 'openrouter', 'groq', 'mistral'],
  agent: ['agent-auto', 'agent-claude', 'agent-cursor', 'agent-opencode', 'agent-codex', 'agent-gemini'],
  cards: ['gemini', 'nvidia', 'openai', 'anthropic', 'deepseek', 'openrouter', 'xai', 'local'],
};

const FREE_KEY_LINKS = {
  gemini: { label: 'Google AI Studio', url: 'https://aistudio.google.com/apikey', recommended: true },
  nvidia: { label: 'NVIDIA', url: 'https://build.nvidia.com/' },
};

const OWN_KEY_LINKS = {
  anthropic: { label: 'console.anthropic.com', url: 'https://console.anthropic.com/' },
  xai: { label: 'console.x.ai', url: 'https://console.x.ai/' },
  openai: { label: 'platform.openai.com', url: 'https://platform.openai.com/api-keys' },
  deepseek: { label: 'platform.deepseek.com', url: 'https://platform.deepseek.com/api_keys' },
  openrouter: { label: 'openrouter.ai', url: 'https://openrouter.ai/keys' },
};

const DEFAULT_PROVIDER = 'local';

// Who answers after a key is removed from the provider that was answering: the first other one
// that still has a key, else LM Studio. Removing someone else's key changes nothing.
function providerAfterKeyRemoved(active, removed, hasKey) {
  if (active !== removed) return active;
  const order = [...(BRAIN_GROUPS.free || []), ...(BRAIN_GROUPS.own || [])];
  return order.find((id) => id !== removed && hasKey(id)) || DEFAULT_PROVIDER;
}

function provider(id) {
  return PROVIDERS[id] || PROVIDERS[DEFAULT_PROVIDER];
}

function activeBrainIds(llm = {}) {
  const raw = Array.isArray(llm.brains) ? llm.brains : [llm.provider || DEFAULT_PROVIDER];
  const ids = raw.filter((id, index) => PROVIDERS[id] && raw.indexOf(id) === index);
  return ids.length ? ids : [DEFAULT_PROVIDER];
}

// Her replies leave this PC only on a cloud provider.
function isCloud(id) {
  return !provider(id).local;
}

// Only LM Studio is booted and waited for: Ollama has its own server and the agent CLIs run themselves.
function usesLms(id) {
  return (PROVIDERS[id] ? id : DEFAULT_PROVIDER) === 'local';
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
  const headers = { 'Content-Type': 'application/json' };
  if (key && !p.local) {
    headers.Authorization = `Bearer ${key}`;
    if (id === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  }
  return {
    url: `${url}/chat/completions`,
    headers,
    body: {
      model: model || p.model,
      messages,
      stream: Boolean(stream),
      ...(p.local && !p.agent ? { reasoning_effort: 'none' } : {}),
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

function isAgent(id) {
  return Boolean(provider(id).agent);
}

// Phase 6C: can this provider/model take a screenshot as an image part?
function supportsVision(id, model) {
  const p = provider(id);
  if (p.agent || p.vision === false) return false;
  if (p.vision === true) return true;
  const name = String(model || p.model || '');
  return LOCAL_VISION_RE.test(name);
}

module.exports = {
  PROVIDERS,
  BRAIN_GROUPS,
  FREE_KEY_LINKS,
  OWN_KEY_LINKS,
  DEFAULT_PROVIDER,
  LOCAL_VISION_RE,
  provider,
  activeBrainIds,
  providerAfterKeyRemoved,
  isCloud,
  usesLms,
  isAgent,
  supportsVision,
  providerOptions,
  defaultBaseUrl,
  requestFor,
  explain,
};
