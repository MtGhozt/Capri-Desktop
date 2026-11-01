'use strict';

// The Agentes tab installs one adapter per agent. Each test starts from a config that
// already has somebody else's hook, then checks install -> status -> uninstall leaves that
// file exactly as it was.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAssistants } = require('../src/main/assistants');
const { codexMap } = require('../hooks/capri-codex-hook');
const { antigravityMap } = require('../hooks/capri-antigravity-hook');
const { cursorMap } = require('../hooks/capri-cursor-hook');

const ROOT = path.resolve(__dirname, '..');
const OLD_CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR;
delete process.env.CLAUDE_CONFIG_DIR;
after(() => {
  if (OLD_CLAUDE_DIR == null) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = OLD_CLAUDE_DIR;
});

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-agents-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

const JSON_FIXTURES = {
  claude: {
    file: (home) => path.join(home, '.claude', 'settings.json'),
    data: { theme: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'foreign-hook' }] }] } },
  },
  codex: {
    file: (home) => path.join(home, '.codex', 'hooks.json'),
    data: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'foreign-hook' }] }] } },
  },
  antigravity: {
    file: (home) => path.join(home, '.gemini', 'config', 'hooks.json'),
    data: { foreign: { Stop: [{ type: 'command', command: 'foreign-hook' }] } },
  },
  cursor: {
    file: (home) => path.join(home, '.cursor', 'hooks.json'),
    data: { version: 1, hooks: { stop: [{ command: 'foreign-hook' }] } },
  },
};

for (const [id, fixture] of Object.entries(JSON_FIXTURES)) {
  test(`${id}: install, status and uninstall keep foreign hooks`, (t) => {
    const home = tempHome(t);
    const file = fixture.file(home);
    writeJson(file, fixture.data);
    const before = readJson(file);
    const assistants = createAssistants({ root: ROOT, home });

    const initial = assistants.statusAll().find((a) => a.id === id);
    assert.equal(initial.found, true);
    assert.equal(initial.installed, false);

    const installed = assistants.install(id);
    assert.equal(installed.ok, true, installed.message);
    const afterInstall = assistants.statusAll().find((a) => a.id === id);
    assert.equal(afterInstall.installed, true);
    assert.match(fs.readFileSync(file, 'utf8'), /capri-/);

    // installing twice must not duplicate our hooks
    assert.equal(assistants.install(id).ok, true);
    assert.equal(count(fs.readFileSync(file, 'utf8'), 'foreign-hook'), 1);

    const removed = assistants.uninstall(id);
    assert.equal(removed.ok, true, removed.message);
    assert.equal(assistants.statusAll().find((a) => a.id === id).installed, false);
    assert.deepEqual(readJson(file), before);
  });
}

test('opencode: install, status and uninstall leave foreign plugins alone', (t) => {
  const home = tempHome(t);
  const dir = path.join(home, '.config', 'opencode', 'plugins');
  const foreign = path.join(dir, 'foreign.js');
  const ours = path.join(dir, 'capri.js');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(foreign, 'export const Foreign = 1;\n');
  const assistants = createAssistants({ root: ROOT, home });

  const initial = assistants.statusAll().find((a) => a.id === 'opencode');
  assert.equal(initial.found, true);
  assert.equal(initial.installed, false);

  assert.equal(assistants.install('opencode').ok, true);
  assert.equal(assistants.statusAll().find((a) => a.id === 'opencode').installed, true);
  assert.match(fs.readFileSync(ours, 'utf8'), /CapriPlugin/);

  assert.equal(assistants.uninstall('opencode').ok, true);
  assert.equal(assistants.statusAll().find((a) => a.id === 'opencode').installed, false);
  assert.equal(fs.existsSync(ours), false);
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'export const Foreign = 1;\n');
});

test('an empty home reports every agent as not found', (t) => {
  const home = tempHome(t);
  const assistants = createAssistants({ root: ROOT, home });
  for (const agent of assistants.statusAll()) {
    assert.equal(agent.found, false, `${agent.id} should not be found`);
    assert.equal(agent.installed, false);
  }
});

test('invalid JSON is never overwritten', (t) => {
  const home = tempHome(t);
  const file = path.join(home, '.codex', 'hooks.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  const assistants = createAssistants({ root: ROOT, home });

  const result = assistants.install('codex');
  assert.equal(result.ok, false);
  assert.match(result.message, /not valid JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
});

test('adapters map each agent to the bridge events Capri already knows', () => {
  assert.equal(codexMap({ hook_event_name: 'PermissionRequest', tool_input: { description: 'run it' } }).hook_event_name, 'Notification');
  assert.equal(codexMap({ hook_event_name: 'Interrupt' }).hook_event_name, 'PostToolUseFailure');
  assert.equal(codexMap({ hook_event_name: 'Stop' }).hook_event_name, 'Stop');

  assert.equal(antigravityMap({ toolCall: { name: 'run_command', args: {} } }, 'PreToolUse').hook_event_name, 'PreToolUse');
  assert.equal(antigravityMap({ error: 'boom' }, 'Stop').hook_event_name, 'StopFailure');
  assert.equal(antigravityMap({ invocationNum: 1 }, 'PreInvocation'), null);

  assert.equal(cursorMap({ hook_event_name: 'preToolUse', tool_name: 'Shell' }).hook_event_name, 'PreToolUse');
  assert.equal(cursorMap({ hook_event_name: 'stop' }).hook_event_name, 'Stop');
  assert.equal(cursorMap({ hook_event_name: 'sessionEnd' }).hook_event_name, 'SessionEnd');
});
