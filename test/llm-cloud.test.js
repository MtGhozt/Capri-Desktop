'use strict';

// Paso 4K: her chat on a cloud provider, with a fake fetch (nothing leaves this PC). What goes out
// per provider, what the privacy switches keep in, and the fallback to Gemma when the cloud fails.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLlm, temporalContext } = require('../src/main/llm');
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
    apiKey: (id) => (id === 'local' ? '' : KEY),
    screenContext: () => screen,
    onFallback: (line) => { state.fallback += line; },
    ensureLocal: async () => 'ready',
  });
  const say = async (user = 'hola') => {
    state.tokens = '';
    state.done = null;
    state.error = null;
    await llm.chat({
      user,
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

test('with the memory switch off, a cloud provider only gets this one question', async () => {
  const h = harness({ cfg: cfgOf({ provider: 'mistral' }) });
  await h.say('me llamo Matias');
  await h.say('¿cómo me llamo?');
  const messages = h.calls[1].body.messages;
  assert.equal(messages.length, 2); // persona + the question in front of it
  assert.equal(messages.at(-1).content, '¿cómo me llamo?');
  assert.ok(!JSON.stringify(messages).includes('me llamo Matias'));
});

test('with the memory switch on, she takes what she remembers along', async () => {
  const h = harness({ cfg: cfgOf({ provider: 'mistral', shareMemory: true }) });
  await h.say('me llamo Matias');
  await h.say('¿cómo me llamo?');
  const messages = h.calls[1].body.messages;
  assert.deepEqual(messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(messages[1].content, 'me llamo Matias');
});

test('the screen only goes out with its switch on', async () => {
  const off = harness({ cfg: cfgOf({ provider: 'openai' }), screen: 'chrome.exe «GitHub»' });
  await off.say();
  assert.ok(!JSON.stringify(off.calls[0].body.messages).includes('GitHub'));

  const on = harness({ cfg: cfgOf({ provider: 'openai', shareScreen: true }), screen: 'chrome.exe «GitHub»' });
  await on.say();
  assert.match(on.calls[0].body.messages[0].content, /chrome\.exe «GitHub»/);
  assert.match(on.calls[0].body.messages[0].content, /Capri/); // her persona still goes first
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
