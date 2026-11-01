'use strict';

// The plugin installed in ~/.config/opencode/plugins/capri.js must speak both OpenCode v2
// (default export with id + setup) and the older v1 hook object, and map events to the
// bridge events Capri already understands. It is ESM, so import it from its own source.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '../hooks/capri-opencode-plugin.js');
const load = () => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(FILE, 'utf8')).toString('base64'));

function state() {
  return { latest: new Map(), prompts: new Map(), tools: new Map(), idleAt: new Map() };
}

test('v2 plugin exports the shape OpenCode loads', async () => {
  const plugin = await load();
  assert.equal(plugin.default.id, 'capri');
  assert.equal(typeof plugin.default.setup, 'function');
  assert.equal(typeof plugin.CapriPlugin, 'function'); // v1 installs keep working
});

test('v2 tools become PreToolUse / PostToolUse with Claude tool names', async () => {
  const { mapEvent } = await load();
  const s = state();
  const where = { location: { directory: 'C:\\work\\demo' } };

  assert.equal(mapEvent({ type: 'session.tool.input.started', ...where, data: { sessionID: 's1', id: 't1', name: 'write' } }, s), null);
  const before = mapEvent({ type: 'session.tool.called', ...where, data: { sessionID: 's1', id: 't1', input: { path: 'prueba.txt' } } }, s);
  assert.equal(before.hook_event_name, 'PreToolUse');
  assert.equal(before.origin, 'opencode');
  assert.equal(before.tool_name, 'Write');
  assert.equal(before.tool_input.file_path, 'prueba.txt');
  assert.equal(before.session_id, 's1');
  assert.equal(before.cwd, 'C:\\work\\demo');

  const after = mapEvent({ type: 'session.tool.success', ...where, data: { sessionID: 's1', id: 't1' } }, s);
  assert.equal(after.hook_event_name, 'PostToolUse');
  assert.equal(after.tool_name, 'Write');
});

test('v2 execution.succeeded becomes one Stop with the last answer', async () => {
  const { mapEvent } = await load();
  const s = state();
  assert.equal(mapEvent({ type: 'session.text.ended', data: { sessionID: 's1', text: 'Listo, creé prueba.txt' } }, s), null);

  // OpenCode v2 completion is execution.succeeded; idle/status are often never published
  const stop = mapEvent({ type: 'session.execution.succeeded', data: { sessionID: 's1' } }, s);
  assert.equal(stop.hook_event_name, 'Stop');
  assert.equal(stop.last_assistant_message, 'Listo, creé prueba.txt');
  assert.equal(stop.origin, 'opencode');

  // a late idle/status must not say it twice
  assert.equal(mapEvent({ type: 'session.idle', data: { sessionID: 's1' } }, s), null);
  assert.equal(mapEvent({ type: 'session.status', data: { sessionID: 's1', status: { type: 'idle' } } }, s), null);
});

test('v2 prompt, permission, failure, compaction and end map to Capri events', async () => {
  const { mapEvent } = await load();
  const s = state();

  assert.equal(mapEvent({ type: 'session.inbox.enqueued', data: { sessionID: 's1', item: { type: 'user', payload: { text: 'crea prueba.txt' } } } }, s), null);
  const prompt = mapEvent({ type: 'session.execution.started', data: { sessionID: 's1' } }, s);
  assert.equal(prompt.hook_event_name, 'UserPromptSubmit');
  assert.equal(prompt.prompt, 'crea prueba.txt');

  const ask = mapEvent({ type: 'permission.asked', data: { sessionID: 's1', action: 'write', message: 'Allow write?' } }, s);
  assert.equal(ask.hook_event_name, 'Notification');
  assert.equal(ask.notification_type, 'permission_prompt');
  assert.equal(ask.message, 'Allow write?');

  const failed = mapEvent({ type: 'session.execution.failed', data: { sessionID: 's1', error: { message: 'boom' } } }, s);
  assert.equal(failed.hook_event_name, 'StopFailure');
  assert.equal(failed.error, 'boom');

  assert.equal(mapEvent({ type: 'session.compaction.ended', data: { sessionID: 's1' } }, s).hook_event_name, 'PreCompact');
  assert.equal(mapEvent({ type: 'session.created', data: { sessionID: 's1' } }, s).hook_event_name, 'SessionStart');
  assert.equal(mapEvent({ type: 'session.deleted', data: { sessionID: 's1' } }, s).hook_event_name, 'SessionEnd');
});

test('a plugin reload replaces its listener instead of posting twice', async () => {
  const { default: plugin } = await load();
  const signals = [];
  const ctx = {
    location: {},
    event: {
      subscribe: ({ signal }) => {
        signals.push(signal);
        return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
      },
    },
  };
  await plugin.setup(ctx);
  const stop = await plugin.setup(ctx); // OpenCode reloading the file
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  stop();
  assert.equal(signals[1].aborted, true);
});
