'use strict';

// The bridge writes exactly one line per event: origin + kind, never the prompt, a path or
// tool content. That is what tells you whether an adapter is actually reaching Capri.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createBridge } = require('../src/main/bridge');

function post(port, body) {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: '/event', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(text);
  });
}

async function bridge(t, options = {}) {
  const server = createBridge({ port: 0, onEvent: () => {}, ...options });
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test('one log line per event: origin and type, no content', async (t) => {
  const logged = [];
  const seen = [];
  const port = await bridge(t, { onEvent: (evt) => seen.push(evt), log: (line) => logged.push(line) });

  assert.equal(await post(port, {
    origin: 'opencode',
    hook_event_name: 'Stop',
    prompt: 'crea un archivo secreto.txt',
    last_assistant_message: 'listo, lo creé',
  }), 200);

  assert.equal(seen.length, 1);
  assert.deepEqual(logged, ['event origin=opencode type=Stop']);
  assert.equal(logged[0].includes('secreto'), false);

  assert.equal(await post(port, { hook_event_name: 'Notification' }), 200);
  assert.deepEqual(logged[1], 'event origin=unknown type=Notification');
});

test('an event without hook_event_name is rejected and not logged', async (t) => {
  const logged = [];
  const port = await bridge(t, { log: (line) => logged.push(line) });
  assert.equal(await post(port, { origin: 'cursor' }), 400);
  assert.deepEqual(logged, []);
});
