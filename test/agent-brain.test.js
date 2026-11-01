'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectAgents, pickAuto, openAgentIds, runAgent } = require('../src/main/agent-brain');

test('detectAgents marks PATH hits and leaves unwired CLIs as not ready', () => {
  const list = detectAgents({
    execFileSync: (cmd, [bin]) => {
      if (bin === 'claude' || bin === 'opencode') return `C:\\bin\\${bin}.exe\n`;
      throw new Error('not found');
    },
    platform: 'win32',
  });
  const by = Object.fromEntries(list.map((a) => [a.id, a]));
  assert.equal(by.claude.installed, true);
  assert.equal(by.claude.ready, true);
  assert.equal(by.opencode.ready, true);
  assert.equal(by.codex.installed, false);
  assert.equal(by['cursor-agent'].ready, false); // detected later; not wired in 0.1.3
});

test('pickAuto prefers an open ready agent, else the preferred, else the first ready', () => {
  const installed = [
    { id: 'claude', ready: true },
    { id: 'opencode', ready: true },
  ];
  assert.equal(pickAuto({ installed, openIds: ['opencode'], preferred: 'claude' }), 'opencode');
  assert.equal(pickAuto({ installed, openIds: [], preferred: 'claude' }), 'claude');
  assert.equal(pickAuto({ installed, openIds: ['codex'], preferred: null }), 'claude');
});

test('openAgentIds reads window titles/process names', () => {
  assert.deepEqual(
    openAgentIds([{ title: 'OpenCode — demo' }, { process: 'claude.exe' }]).sort(),
    ['claude', 'opencode'],
  );
});

test('runAgent spawns the CLI with -p / run and returns stdout', async () => {
  const installed = [{ id: 'claude', label: 'Claude Code', bin: 'claude', path: 'claude.exe', ready: true }];
  let saw;
  const text = await runAgent({
    id: 'claude',
    prompt: 'hola',
    installed,
    spawnImpl: (file, args) => {
      saw = { file, args };
      const handlers = {};
      const child = {
        stdout: { on: (ev, fn) => { if (ev === 'data') queueMicrotask(() => fn('hola choom')); } },
        stderr: { on() {} },
        on: (ev, fn) => { handlers[ev] = fn; if (ev === 'close') queueMicrotask(() => fn(0)); },
        kill() {},
      };
      return child;
    },
  });
  assert.deepEqual(saw, { file: 'claude.exe', args: ['-p', 'hola'] });
  assert.equal(text, 'hola choom');
});
