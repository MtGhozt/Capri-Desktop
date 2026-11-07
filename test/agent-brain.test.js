'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  AGENTS, VERSION_TIMEOUT_MS, detectAgents, pickAuto, openAgentIds, runAgent, wrapPrompt,
} = require('../src/main/agent-brain');

test('detectAgents marks PATH hits; all five CLIs are wired when present', () => {
  let calls = 0;
  const logs = [];
  const execFileSync = (cmd, [bin]) => {
    calls += 1;
    if (cmd === 'where' && (bin === 'claude' || bin === 'opencode')) return `C:\\bin\\${bin}.exe\n`;
    if ((cmd === 'C:\\bin\\claude.exe' || cmd === 'C:\\bin\\opencode.exe') && bin === '--version') return '1.0';
    throw new Error('not found');
  };
  const list = detectAgents({ execFileSync, platform: 'win32', existsSync: () => false, log: (m) => logs.push(m) });
  const by = Object.fromEntries(list.map((a) => [a.id, a]));
  assert.equal(by.claude.installed, true);
  assert.equal(by.claude.ready, true);
  assert.equal(by.opencode.ready, true);
  assert.equal(by.codex.installed, false);
  assert.equal(by['cursor-agent'].ready, false);
  assert.equal(by['cursor-agent'].installHow, "irm 'https://cursor.com/install?win32=true' | iex");
  assert.equal(by.opencode.installHow, 'npm install -g opencode-ai');
  assert.ok(by.codex.installHow);
  assert.ok(by.gemini.installHow);
  assert.equal(VERSION_TIMEOUT_MS, 15_000);
  assert.match(logs.find((l) => l.includes('claude')) || '', /bin=claude path=C:\\bin\\claude\.exe version=ok/);
  assert.match(logs.find((l) => l.includes('cursor-agent')) || '', /path=none version=none/);
  detectAgents({ execFileSync, platform: 'win32', existsSync: () => false, log() {} }); // mocks never use the production cache
  // two scans × (6 PATH checks: cursor-agent+agent fallback + 4 others, + 2 --version)
  assert.equal(calls, 16);
});

test('cursor-agent falls back to the agent binary on PATH', () => {
  const logs = [];
  const list = detectAgents({
    platform: 'win32',
    existsSync: () => false,
    log: (m) => logs.push(m),
    execFileSync: (cmd, [bin]) => {
      if (cmd === 'where' && bin === 'cursor-agent') throw new Error('not found');
      if (cmd === 'where' && bin === 'agent') return 'C:\\bin\\agent.exe\n';
      if (cmd === 'C:\\bin\\agent.exe' && bin === '--version') return '0.1';
      throw new Error('not found');
    },
  });
  const cursor = list.find((a) => a.id === 'cursor-agent');
  assert.equal(cursor.installed, true);
  assert.equal(cursor.ready, true);
  assert.equal(cursor.path, 'C:\\bin\\agent.exe');
  assert.match(logs.find((l) => l.includes('cursor-agent')) || '', /bin=agent path=C:\\bin\\agent\.exe version=ok/);
});

test('detectAgents only marks CLIs found by where on PATH', () => {
  const list = detectAgents({
    platform: 'win32',
    existsSync: () => false,
    execFileSync: (cmd, [bin]) => {
      if (cmd === 'where' && bin === 'claude') return 'C:\\tools\\claude.cmd\n';
      if (cmd === 'C:\\tools\\claude.cmd' && bin === '--version') return 'claude 1.0';
      throw new Error('not found');
    },
  });
  assert.equal(list.find((a) => a.id === 'claude').installed, true);
  assert.equal(list.find((a) => a.id === 'opencode').installed, false);
});

test('detectAgents finds Claude outside PATH via native install folder', () => {
  const env = { USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' };
  const known = 'C:\\Users\\me\\.local\\bin\\claude.exe';
  const logs = [];
  const list = detectAgents({
    platform: 'win32',
    env,
    existsSync: (file) => file === known,
    log: (m) => logs.push(m),
    execFileSync: (cmd, [bin]) => {
      if (cmd === 'where') throw new Error('not found');
      if (cmd === known && bin === '--version') return '1.0';
      throw new Error('not found');
    },
  });
  const claude = list.find((a) => a.id === 'claude');
  assert.equal(claude.installed, true);
  assert.equal(claude.path, known);
  assert.equal(claude.viaKnownPath, true);
  assert.equal(claude.note, 'Lo encontré fuera del PATH; funciona igual.');
  assert.match(logs.find((l) => l.includes('claude')) || '', /via=known-path/);
});

test('detectAgents finds npm CLIs in %APPDATA%\\npm outside PATH', () => {
  const env = { USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' };
  const known = 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd';
  const list = detectAgents({
    platform: 'win32',
    env,
    existsSync: (file) => file === known,
    execFileSync: (cmd, [bin]) => {
      if (cmd === 'where') throw new Error('not found');
      if (cmd === known && bin === '--version') return '1.0';
      throw new Error('not found');
    },
  });
  const opencode = list.find((a) => a.id === 'opencode');
  assert.equal(opencode.installed, true);
  assert.equal(opencode.path, known);
  assert.equal(opencode.viaKnownPath, true);
});

test('detectAgents leaves Claude uninstalled when neither PATH nor known paths exist', () => {
  const list = detectAgents({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\me' },
    existsSync: () => false,
    execFileSync: () => { throw new Error('not found'); },
  });
  const claude = list.find((a) => a.id === 'claude');
  assert.equal(claude.installed, false);
  assert.equal(claude.viaKnownPath, false);
});

test('detectAgents rejects a PATH result that cannot run', () => {
  const list = detectAgents({
    platform: 'win32',
    existsSync: () => false,
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
