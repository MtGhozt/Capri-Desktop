'use strict';

// MEMORIA: reloading persona.md without a restart, and forgetting the conversation.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLlm } = require('../src/main/llm');

function tempPersona(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-persona-'));
  const file = path.join(dir, 'persona.md');
  fs.writeFileSync(file, text);
  return file;
}

function stubFetch() {
  const bodies = [];
  const real = global.fetch;
  global.fetch = async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return {
    bodies,
    restore: () => { global.fetch = real; },
  };
}

const run = (llm, user) => llm.chat({ user, onToken() {}, onDone() {}, onError() {} });

test('persona.md is cached until "reload persona"', () => {
  const file = tempPersona('FIRST PERSONA');
  const llm = createLlm({ loadConfig: () => ({ lang: 'es' }), personaPath: file });

  assert.match(llm.personaText(), /^FIRST PERSONA$/);
  fs.writeFileSync(file, 'SECOND PERSONA');
  assert.match(llm.personaText(), /^FIRST PERSONA$/);

  const result = llm.reloadPersona();
  assert.equal(result.ok, true);
  assert.equal(result.chars, 'SECOND PERSONA'.length);
  assert.match(llm.personaText(), /^SECOND PERSONA$/);
});

test('system prompt warns against inventing context from ambiguous fragments', async () => {
  const stub = stubFetch();
  try {
    const llm = createLlm({ loadConfig: () => ({ lang: 'es' }), personaPath: tempPersona('PERSONA') });
    await run(llm, '¿por qué no me deja?');
    const system = stub.bodies[0].messages[0].content;
    assert.match(system, /no inventes contexto/i);
    assert.match(system, /código, juegos/i);
  } finally {
    stub.restore();
  }
});

test('reload persona also works when persona.md is missing', () => {
  const file = path.join(os.tmpdir(), 'capri-missing-persona', 'persona.md');
  const llm = createLlm({ loadConfig: () => ({ lang: 'es' }), personaPath: file });
  const result = llm.reloadPersona();
  assert.equal(result.ok, false); // nothing to re-read: she keeps the fallback
  assert.match(llm.personaText(), /You are Capri/);
});

test('forget conversation drops the history sent to the LLM', async () => {
  const stub = stubFetch();
  try {
    const file = tempPersona('PERSONA');
    const llm = createLlm({ loadConfig: () => ({ lang: 'es' }), personaPath: file });

    await run(llm, 'hola');
    await run(llm, 'otra cosa');
    assert.equal(stub.bodies[1].messages.length, 4); // system, hola, ok, otra cosa

    llm.reset();
    await run(llm, 'nueva');
    assert.equal(stub.bodies[2].messages.length, 2); // system, nueva
  } finally {
    stub.restore();
  }
});

test('history is dropped after ten minutes of silence and kept before', async () => {
  const stub = stubFetch();
  try {
    let t = new Date('2026-10-29T12:00:00.000Z');
    const llm = createLlm({
      loadConfig: () => ({ lang: 'es' }), personaPath: tempPersona('PERSONA'), now: () => t,
    });

    await run(llm, 'hola');
    t = new Date(t.getTime() + 5 * 60 * 1000);
    await run(llm, 'sigo acá');
    assert.equal(stub.bodies[1].messages.length, 4); // system, hola, ok, sigo acá

    t = new Date(t.getTime() + 11 * 60 * 1000);
    await run(llm, '¿por qué no me deja?');
    assert.equal(stub.bodies[2].messages.length, 2); // system, fragmento
  } finally {
    stub.restore();
  }
});

test('unprompted comments never pile up in history', async () => {
  const stub = stubFetch();
  try {
    const llm = createLlm({
      loadConfig: () => ({ lang: 'es' }), personaPath: tempPersona('PERSONA'),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
    });
    llm.rememberComment('comentario viejo', 60_000);
    llm.rememberComment('¿sabés qué pasó hoy?', 60_000);

    await run(llm, 'sí, contame');
    const first = stub.bodies[0].messages;
    assert.equal(first.length, 3); // system, only the newest comment, user
    assert.equal(first[1].content, '¿sabés qué pasó hoy?');

    await run(llm, 'otra cosa');
    const second = stub.bodies[1].messages;
    assert.equal(second.some((m) => m.content === 'comentario viejo'), false);
    assert.equal(second.some((m) => m.content === '¿sabés qué pasó hoy?'), false);
  } finally {
    stub.restore();
  }
});
