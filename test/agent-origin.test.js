'use strict';

// Every adapter tells Capri who did it. With an OpenCode/Cursor/Codex event she must name
// that agent instead of always saying "Claude", reusing the same reactions.

const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const load = () => import('../src/renderer/js/brain.js');

function harness() {
  const said = [];
  const panel = {
    current: null,
    say: (msg) => said.push(msg),
    hide() {},
    setTicker() {},
    clearKind() {},
    updateLog() {},
  };
  const capri = {
    mode: 'idle',
    pos: { x: 0 },
    windows: { fg: null, wins: [] },
    wake() {},
    attend() {},
    setMode() {},
    pulse() {},
    spark() {},
    goToWork() {},
    towardCenter: () => 1,
    perform() {},
    celebrate({ onSpeak }) { onSpeak(); },
    hurt() {},
    stopPointing() {},
    teleport: async () => {},
    spot: () => '',
    earnUplink() {},
    canPoint: () => false,
    pointAt: async () => false,
    summon: async () => {},
  };
  const spoken = [];
  const host = { cursor: async () => ({ inside: false }), speak: (t) => spoken.push(t), spoken };
  return { said, panel, capri, host };
}

test('OpenCode finishing names OpenCode and keeps the short summary', async () => {
  const { Brain } = await load();
  const { said, panel, capri, host } = harness();
  const brain = new Brain({ capri, panel, voice: { play() {} }, host, lang: 'es' });
  const at = { origin: 'opencode', session_id: 'opencode-1', cwd: 'C:\\work\\demo' };

  brain.handle({ ...at, hook_event_name: 'SessionStart', source: 'startup' });
  brain.handle({ ...at, hook_event_name: 'UserPromptSubmit', prompt: 'crea prueba.txt' });
  brain.handle({ ...at, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'prueba.txt' } });
  brain.handle({ ...at, hook_event_name: 'Stop', last_assistant_message: 'Listo, creé prueba.txt' });

  const done = said.filter((m) => m.kind === 'done').pop();
  assert.ok(done, 'she says something when the job is done');
  assert.match(done.line, /^OpenCode terminó: /);
  assert.match(done.line, /1 acción/);
  assert.equal(done.line.includes('Claude'), false);
  assert.equal(done.tag, 'demo'); // the project, not the agent
});

test('Cursor asking for permission is named, not Claude', async () => {
  const { Brain } = await load();
  const { said, panel, capri, host } = harness();
  const brain = new Brain({ capri, panel, voice: { play() {} }, host, lang: 'es' });

  await brain.handle({
    origin: 'cursor', session_id: 'cursor-1', cwd: 'C:\\work\\app',
    hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Allow write?',
  });

  const alert = said.find((m) => m.kind === 'alert');
  assert.ok(alert);
  assert.match(alert.line, /Cursor te está pidiendo permiso/);
  assert.match(alert.line, /Entrá y dáselo/);
  assert.equal(alert.badge, 'PERMISO');
  assert.equal(alert.hold, null);
  assert.equal(alert.line.includes('Claude'), false);
  assert.deepEqual(host.spoken, [alert.line]);
});

test('Codex crashing is named, not Claude', async () => {
  const { Brain } = await load();
  const { said, panel, capri, host } = harness();
  const brain = new Brain({ capri, panel, voice: { play() {} }, host, lang: 'es' });

  brain.handle({
    origin: 'codex', session_id: 'codex-1', cwd: 'C:\\work\\lib',
    hook_event_name: 'StopFailure', error: 'build failed',
  });

  const error = said.find((m) => m.kind === 'error');
  assert.ok(error);
  assert.match(error.line, /Codex/);
  assert.equal(error.line.includes('Claude'), false);
});

test('Claude events still read like before', async () => {
  const { Brain } = await load();
  const { said, panel, capri, host } = harness();
  const brain = new Brain({ capri, panel, voice: { play() {} }, host, lang: 'es' });
  const at = { origin: 'claude', session_id: 'claude-1', cwd: 'C:\\work\\old' };

  brain.handle({ ...at, hook_event_name: 'UserPromptSubmit', prompt: 'hola' });
  brain.handle({ ...at, hook_event_name: 'Stop', last_assistant_message: 'hecho' });

  const done = said.filter((m) => m.kind === 'done').pop();
  assert.ok(done);
  assert.equal(done.line.includes('OpenCode'), false);
});
