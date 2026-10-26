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
