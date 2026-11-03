'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  AGENTS, detectAgents, pickAuto, openAgentIds, runAgent, wrapPrompt,
} = require('../src/main/agent-brain');

test('detectAgents marks PATH hits; all five CLIs are wired when present', () => {
  let calls = 0;
  const execFileSync = (cmd, [bin]) => {
    calls += 1;
    if (cmd === 'where' && (bin === 'claude' || bin === 'opencode')) return `C:\\bin\\${bin}.exe\n`;
    if ((cmd === 'C:\\bin\\claude.exe' || cmd === 'C:\\bin\\opencode.exe') && bin === '--version') return '1.0';
    throw new Error('not found');
  };
  const list = detectAgents({ execFileSync, platform: 'win32' });
  const by = Object.fromEntries(list.map((a) => [a.id, a]));
  assert.equal(by.claude.installed, true);
  assert.equal(by.claude.ready, true);
  assert.equal(by.opencode.ready, true);
  assert.equal(by.codex.installed, false);
  assert.equal(by['cursor-agent'].ready, false);
  assert.ok(by.codex.installHow);
  assert.ok(by.gemini.installHow);
  detectAgents({ execFileSync, platform: 'win32' }); // mocks never use the production cache
  assert.equal(calls, 14); // two scans × (5 PATH checks + 2 executable checks)
});

test('detectAgents only marks CLIs found by where on PATH', () => {
  const list = detectAgents({
    platform: 'win32',
    execFileSync: (cmd, [bin]) => {
      if (cmd === 'where' && bin === 'claude') return 'C:\\tools\\claude.cmd\n';
      if (cmd === 'C:\\tools\\claude.cmd' && bin === '--version') return 'claude 1.0';
      throw new Error('not found');
    },
  });
  assert.equal(list.find((a) => a.id === 'claude').installed, true);
  assert.equal(list.find((a) => a.id === 'opencode').installed, false);
});

test('detectAgents rejects a PATH result that cannot run', () => {
  const list = detectAgents({
    platform: 'win32',
    execFileSync: (cmd, [bin]) => {
      if (cmd === 'where' && bin === 'claude') return 'C:\\tools\\claude.cmd\n';
      throw new Error('not runnable');
    },
  });
  assert.equal(list.find((a) => a.id === 'claude').installed, false);
  assert.equal(list.find((a) => a.id === 'claude').ready, false);
});

test('each CLI builds the right command (read-only flags where the CLI has them)', () => {
  const by = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
  assert.deepEqual(by.claude.args('hola'), ['-p', '--permission-mode', 'plan', 'hola']);
  assert.deepEqual(by['cursor-agent'].args('hola'), ['-p', '--mode=ask', '--output-format', 'text', 'hola']);
  assert.deepEqual(by.opencode.args('hola'), ['run', 'hola']);
  assert.deepEqual(
    by.codex.args('hola'),
    ['exec', '--sandbox', 'read-only', '--ask-for-approval', 'never', 'hola'],
  );
  assert.deepEqual(by.gemini.args('hola'), ['-p', '--approval-mode=plan', 'hola']);
});

test('pickAuto prefers an open ready agent, else the preferred, else the first ready', () => {
  const installed = [
    { id: 'claude', ready: true },
    { id: 'cursor-agent', ready: true },
    { id: 'opencode', ready: true },
    { id: 'codex', ready: true },
    { id: 'gemini', ready: true },
  ];
  assert.equal(pickAuto({ installed, openIds: ['codex'], preferred: 'claude' }), 'codex');
  assert.equal(pickAuto({ installed, openIds: ['cursor-agent'], preferred: 'gemini' }), 'cursor-agent');
  assert.equal(pickAuto({ installed, openIds: [], preferred: 'gemini' }), 'gemini');
  assert.equal(pickAuto({ installed, openIds: ['missing'], preferred: null }), 'claude');
  assert.equal(
    pickAuto({
      installed: [{ id: 'gemini', ready: true }],
      openIds: [],
      preferred: 'claude',
    }),
    'gemini',
  );
});

test('openAgentIds reads window titles/process names', () => {
  assert.deepEqual(
    openAgentIds([
      { title: 'OpenCode — demo' },
      { process: 'claude.exe' },
      { title: 'Cursor Agent' },
      { process: 'codex.exe' },
      { title: 'gemini — chat' },
    ]).sort(),
    ['claude', 'codex', 'cursor-agent', 'gemini', 'opencode'],
  );
});

test('wrapPrompt puts Capri persona ahead of the user line', () => {
  assert.equal(wrapPrompt('hola', ''), 'hola');
  assert.match(wrapPrompt('hola', 'You are Capri.'), /You are Capri\.\n\n---\nUser: hola/);
});

test('runAgent spawns Claude with -p / plan and returns stdout', async () => {
  const installed = [{ id: 'claude', label: 'Claude Code', bin: 'claude', path: 'claude.exe', ready: true }];
  let saw;
  const text = await runAgent({
    id: 'claude',
    prompt: 'hola',
    persona: 'You are Capri.',
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
  assert.equal(saw.file, 'claude.exe');
  assert.equal(saw.args[0], '-p');
  assert.equal(saw.args[1], '--permission-mode');
  assert.equal(saw.args[2], 'plan');
  assert.match(saw.args[3], /You are Capri/);
  assert.match(saw.args[3], /User: hola/);
  assert.equal(text, 'hola choom');
});

test('runAgent builds Cursor / Codex / Gemini argv the same way', async () => {
  const cases = [
    { id: 'cursor-agent', label: 'Cursor Agent', expectHead: ['-p', '--mode=ask', '--output-format', 'text'] },
    { id: 'codex', label: 'Codex', expectHead: ['exec', '--sandbox', 'read-only', '--ask-for-approval', 'never'] },
    { id: 'gemini', label: 'Gemini CLI', expectHead: ['-p', '--approval-mode=plan'] },
  ];
  for (const c of cases) {
    let saw;
    await runAgent({
      id: c.id,
      prompt: 'hola',
      installed: [{ id: c.id, label: c.label, bin: c.id, path: `${c.id}.exe`, ready: true }],
      spawnImpl: (file, args) => {
        saw = { file, args };
        const child = {
          stdout: { on: (ev, fn) => { if (ev === 'data') queueMicrotask(() => fn('ok')); } },
          stderr: { on() {} },
          on: (ev, fn) => { if (ev === 'close') queueMicrotask(() => fn(0)); },
          kill() {},
        };
        return child;
      },
    });
    assert.equal(saw.file, `${c.id}.exe`);
    assert.deepEqual(saw.args.slice(0, -1), c.expectHead);
    assert.equal(saw.args.at(-1), 'hola');
  }
});
