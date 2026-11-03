'use strict';

// Paso 4K: her chat on a cloud provider, with a fake fetch (nothing leaves this PC). What goes out
// per provider, what the privacy switches keep in, and the fallback to Gemma when the cloud fails.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLlm, temporalContext } = require('../src/main/llm');
const { usesLms } = require('../src/main/chat-providers');
const { createTokenStore } = require('../src/main/spotify');

const KEY = 'sk-test-do-not-log-123';
const LOCAL = 'http://localhost:1235/v1';

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
const ok = (text) => ({ ok: true, status: 200, body: new Response(sse(text)).body });
const bad = (status) => ({ ok: false, status, body: new Response('{}').body });

test('temporal context names Costa Rica time, Spanish day period and elapsed silence', () => {
  const now = new Date('2026-10-29T02:30:00.000Z');
  const text = temporalContext({ now, lastTalkAt: now.getTime() - 3 * 60 * 60 * 1000 });
  assert.match(text, /hora local/i);
  assert.match(text, /noche/i);
  assert.match(text, /hace 3 horas/i);
});

test('the first minute of a session does not invite a date or time greeting', () => {
  const text = temporalContext({ now: new Date('2026-10-29T02:30:00.000Z') });
  assert.equal(/primera conversación/i.test(text), false);
  assert.match(text, /sin conversación previa/i);
  assert.match(text, /no menciones fecha ni hora/i);
});

function cfgOf(patch = {}) {
  return {
    lang: 'es',
    llm: {
      provider: 'local',
      model: 'google/gemma-4-e2b',
      localModel: 'google/gemma-4-e2b',
      baseUrl: LOCAL,
      shareScreen: false,
      shareMemory: false,
      ...patch,
    },
  };
}

// A fake network: `reply(call, n)` decides what each request gets.
function harness({ cfg = cfgOf(), reply = () => ok('Listo, choom.'), screen = '' } = {}) {
  const calls = [];
  const state = { tokens: '', done: null, error: null, fallback: '' };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers, signal: init.signal });
    return reply({ url, body, headers: init.headers }, calls.length);
  };
  const llm = createLlm({
    loadConfig: () => cfg,
    personaPath: 'no-such-persona.md',
    apiKey: (id) => (id === 'local' || id !== cfg.llm.provider ? '' : KEY),
    screenContext: () => screen,
    onFallback: (line) => { state.fallback += line; },
    ensureLocal: async () => 'ready',
  });
  const say = async (user = 'hola', opts = {}) => {
    state.tokens = '';
    state.done = null;
    state.error = null;
    await llm.chat({
      user,
      image: opts.image || null,
      onToken: (piece) => { state.tokens += piece; },
      onDone: (payload) => { state.done = payload; },
      onError: (payload) => { state.error = payload; },
    });
    return state;
  };
  return { calls, llm, say, state };
}

test('on a cloud provider her question goes there, with the key only in the header', async () => {
  const h = harness({ cfg: cfgOf({ provider: 'groq', model: 'llama-3.3-70b-versatile' }) });
  const out = await h.say('¿quién sos?');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(h.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(h.calls[0].body.model, 'llama-3.3-70b-versatile');
  assert.equal(out.done.text, 'Listo, choom.');
  assert.equal(out.tokens, 'Listo, choom.');
  assert.ok(!JSON.stringify(h.calls[0].body).includes(KEY));
});

test('on LM Studio nothing changes: her old port, and no key', async () => {
  const h = harness({ cfg: cfgOf({ model: 'google/gemma-4-e2b' }) });
  await h.say();
  assert.equal(h.calls[0].url, `${LOCAL}/chat/completions`);
  assert.equal(h.calls[0].headers.Authorization, undefined);
  assert.equal(h.calls[0].body.reasoning_effort, 'none');
  assert.equal(h.calls[0].body.model, 'google/gemma-4-e2b');
});

test('going to the cloud and back keeps the local model she had', async () => {
  const cfg = cfgOf({ provider: 'openai', model: 'gpt-4o-mini', localModel: 'google/gemma-4-e4b' });
  const h = harness({ cfg });
  await h.say();
  assert.equal(h.calls[0].body.model, 'gpt-4o-mini');
  cfg.llm.provider = 'local';
  await h.say('otra vez');
  assert.equal(h.calls[1].body.model, 'google/gemma-4-e4b');
});

test('a cloud that fails hands it to Gemma, and she says so in Spanish', async () => {
  const h = harness({
    cfg: cfgOf({ provider: 'openai', model: 'gpt-4o-mini' }),
    reply: (call) => (call.url.startsWith(LOCAL) ? ok('Sigo acá, con mi modelo de casa.') : bad(500)),
  });
  const out = await h.say('¿me escuchás?');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].url, `${LOCAL}/chat/completions`);
  assert.equal(h.calls[1].body.model, 'google/gemma-4-e2b');
  assert.equal(out.done.text, 'Sigo acá, con mi modelo de casa.');
  assert.match(out.fallback, /OpenAI está teniendo problemas/);
  assert.match(out.fallback, /LM Studio/);
  assert.ok(!out.fallback.includes(KEY));
  assert.equal(out.error, null);
});

test('an agent brain with a screenshot falls back to vision-capable Gemini', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return ok('Veo la pantalla.');
  };
  let agentCalls = 0;
  const cfg = cfgOf({ provider: 'agent-gemini', model: 'agent' });
  const llm = createLlm({
    loadConfig: () => cfg,
    personaPath: 'no-such-persona.md',
    apiKey: (id) => (id === 'gemini' ? KEY : ''),
    runAgentChat: async () => { agentCalls += 1; return 'No puedo ver imágenes.'; },
  });
  let done = null;
  await llm.chat({
    user: 'Mirá mi pantalla',
    image: 'jpeg-base64',
    onToken: () => {},
    onDone: (payload) => { done = payload; },
    onError: (payload) => { throw new Error(payload.text); },
  });
  assert.equal(agentCalls, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /generativelanguage/);
  assert.equal(done.text, 'Veo la pantalla.');
});

test('no network at all: the same fallback, said plainly', async () => {
  const h = harness({
    cfg: cfgOf({ provider: 'deepseek' }),
    reply: (call) => {
      if (call.url.startsWith(LOCAL)) return ok('Acá estoy.');
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });
  const out = await h.say();
  assert.equal(out.done.text, 'Acá estoy.');
  assert.match(out.fallback, /No hay conexión con DeepSeek/);
  assert.ok(!out.fallback.includes('ENOTFOUND'));
});

test('a limit (429) is not retried on the cloud: straight to Gemma', async () => {
  const h = harness({
    cfg: cfgOf({ provider: 'gemini' }),
    reply: (call) => (call.url.startsWith(LOCAL) ? ok('Dale.') : bad(429)),
  });
  const out = await h.say();
  assert.equal(h.calls.length, 2);
  assert.match(out.fallback, /Gemini está saturada/);
  assert.equal(out.done.text, 'Dale.');
});

test('a dead Anthropic key: Gemini answers, LM Studio is never booted nor waited on', async () => {
  const calls = [];
  let booted = 0;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return url.includes('anthropic') ? bad(401) : ok('Acá estoy, choom.');
  };
  let fallback = '';
  const llm = createLlm({
    loadConfig: () => cfgOf({ provider: 'anthropic' }),
    personaPath: 'no-such-persona.md',
    apiKey: (id) => ({ anthropic: KEY, gemini: KEY }[id] || ''),
    onFallback: (line) => { fallback += line; },
    ensureLocal: async () => { booted += 1; return 'ready'; },
  });
  const say = async (user) => {
    let done = null;
    let error = null;
    await llm.chat({
      user,
      onToken: () => {},
      onDone: (payload) => { done = payload; },
      onError: (payload) => { error = payload; },
    });
    return { done, error };
  };
  const first = await say('hola');
  assert.equal(first.error, null);
  assert.equal(first.done.text, 'Acá estoy, choom.');
  assert.match(fallback, /La key de Anthropic no funciona, usando Gemini/);
  assert.equal(booted, 0);
  assert.ok(calls[0].includes('anthropic'));
  assert.ok(calls[1].includes('generativelanguage'));

  const second = await say('otra');
  assert.equal(second.done.text, 'Acá estoy, choom.');
  assert.equal(calls.filter((url) => url.includes('anthropic')).length, 1); // not asked again
});

test('when she already started answering, a late failure is not retried (two voices)', async () => {
  const h = harness({
    cfg: cfgOf({ provider: 'openai' }),
    reply: () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(sse('A media')));
        },
        pull(c) {
          c.error(new Error('connection reset'));
        },
      }),
    }),
  });
  const out = await h.say();
  assert.equal(h.calls.length, 1);
  assert.equal(out.error?.kind, 'offline');
  assert.match(out.error.text, /No hay conexión con OpenAI/);
  assert.equal(out.fallback, '');
});

test('every provider gets the last chat turns, including follow-ups and voice-style lines', async () => {
  for (const provider of ['local', 'gemini', 'openrouter', 'groq']) {
    const h = harness({ cfg: cfgOf({ provider, shareMemory: false }) });
    await h.say('¿quieres que te cuente algo?');
    await h.say('sí, cuéntame'); // same path as a voice transcript via chat:send
    const messages = h.calls[1].body.messages;
    assert.deepEqual(messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user'], provider);
    assert.equal(messages[1].content, '¿quieres que te cuente algo?', provider);
    assert.equal(messages.at(-1).content, 'sí, cuéntame', provider);
  }
});

test('rolling history keeps about the last 10 turns on every request', async () => {
  const h = harness({ cfg: cfgOf({ provider: 'gemini', shareMemory: false }) });
  for (let i = 0; i < 12; i += 1) await h.say(`turno ${i}`);
  const messages = h.calls.at(-1).body.messages;
  const turns = messages.slice(1); // drop system
  assert.equal(turns.length, 21); // 10 prior turns (20 msgs) + this user line
  assert.equal(turns[0].content, 'turno 1'); // turno 0 dropped (pair was beyond the 20-msg window)
  assert.equal(turns.at(-1).content, 'turno 11');
});

test('screen exe/title is not stuffed into every system prompt anymore', async () => {
  // Phase 6C: looking sends a JPEG on the user turn; shareScreen no longer leaks fg text each chat.
  const on = harness({ cfg: cfgOf({ provider: 'openai', shareScreen: true }), screen: 'chrome.exe «GitHub»' });
  await on.say();
  assert.ok(!JSON.stringify(on.calls[0].body.messages).includes('GitHub'));
  assert.match(on.calls[0].body.messages[0].content, /Capri/); // her persona still goes first
});

test('a look with image attaches a multimodal user part', async () => {
  const h = harness({ cfg: cfgOf({ provider: 'gemini', shareScreen: true }), screen: 'chrome.exe «Docs»' });
  await h.say('mirá mi pantalla', { image: 'qqqq' });
  const user = h.calls[0].body.messages.at(-1);
  assert.equal(Array.isArray(user.content), true);
  assert.equal(user.content[0].type, 'text');
  assert.match(user.content[0].text, /pantalla/);
  assert.match(user.content[0].text, /Docs/);
  assert.match(user.content[1].image_url.url, /jpeg;base64,qqqq/);
});

test('agent-claude with no LM Studio: the agent answers, LM Studio is never waited for', async () => {
  const cfg = cfgOf({ provider: 'agent-claude', model: 'agent' });
  let waited = 0;
  let asked = null;
  const lms = { whenReady: async () => { waited += 1; return 'failed'; } };
  const llm = createLlm({
    loadConfig: () => cfg,
    personaPath: 'no-such-persona.md',
    apiKey: () => '',
    runAgentChat: async ({ provider, user, persona }) => {
      asked = { provider, user, persona };
      return 'Nova, choom.';
    },
    ensureLocal: async () => { throw new Error('lms not found'); },
  });
  // v0.1.3 fix: the guard main.js runs before answering, with LM Studio missing
  if (usesLms(cfg.llm.provider)) await lms.whenReady();
  let said = '';
  let error = null;
  await llm.chat({
    user: 'hola',
    onToken: (piece) => { said += piece; },
    onDone: () => {},
    onError: (payload) => { error = payload; },
  });
  assert.equal(waited, 0);
  assert.equal(asked.provider, 'agent-claude');
  assert.equal(asked.user, 'hola');
  assert.match(asked.persona, /Capri/);
  assert.equal(said, 'Nova, choom.');
  assert.equal(error, null);
});

test('her key is encrypted on disk, never plain text, never in config', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-keys-'));
  const file = path.join(dir, 'llm-keys');
  // the same store Spotify uses, with a stand-in for Windows' safeStorage
  const store = createTokenStore({
    file,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from([...text].map((c) => c.charCodeAt(0) ^ 0x5a)),
      decryptString: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString(),
    },
  });
  store.write({ openai: KEY });
  assert.equal(store.read().openai, KEY);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(KEY));
  assert.ok(!raw.includes('openai')); // not even the provider in plain sight
  store.clear();
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
