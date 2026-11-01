'use strict';

// Use an installed coding-agent CLI as Capri's brain (no Capri-managed tokens).
// v0.1.3 ships Claude Code + OpenCode; cursor-agent / codex / gemini are detected but not wired yet.

const { spawn } = require('node:child_process');
const path = require('node:path');

const AGENTS = [
  { id: 'claude', label: 'Claude Code', bin: 'claude', args: (prompt) => ['-p', prompt], ready: true },
  { id: 'opencode', label: 'OpenCode', bin: 'opencode', args: (prompt) => ['run', prompt], ready: true },
  { id: 'cursor-agent', label: 'Cursor Agent', bin: 'cursor-agent', args: (prompt) => ['-p', prompt], ready: false },
  { id: 'codex', label: 'Codex', bin: 'codex', args: (prompt) => ['exec', prompt], ready: false },
  { id: 'gemini', label: 'Gemini CLI', bin: 'gemini', args: (prompt) => ['-p', prompt], ready: false },
];

function which(bin, { execFileSync = require('node:child_process').execFileSync, platform = process.platform } = {}) {
  try {
    const cmd = platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, [bin], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    const first = String(out).split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

// `where`/`which` per CLI is slow on cold PATH; cache so menu:get does not stall the first paint.
let agentsCache = null;
let agentsCacheAt = 0;
const AGENTS_CACHE_MS = 60_000;

function detectAgents(opts = {}) {
  const now = Date.now();
  // custom which (tests) always bypasses; production PATH scans are cached
  if (!opts.force && !opts.execFileSync && agentsCache && now - agentsCacheAt < AGENTS_CACHE_MS) {
    return agentsCache;
  }
  const list = AGENTS.map((a) => {
    const file = which(a.bin, opts);
    return {
      id: a.id,
      label: a.label,
      bin: a.bin,
      installed: Boolean(file),
      path: file,
      ready: a.ready && Boolean(file),
      note: a.ready ? '' : 'Próximamente',
    };
  });
  if (!opts.execFileSync) {
    agentsCache = list;
    agentsCacheAt = now;
  }
  return list;
}

function pickAuto({ installed, openIds = [], preferred } = {}) {
  const ready = (installed || []).filter((a) => a.ready);
  for (const id of openIds) {
    const hit = ready.find((a) => a.id === id);
    if (hit) return hit.id;
  }
  if (preferred && ready.some((a) => a.id === preferred)) return preferred;
  return ready[0]?.id || null;
}

// Map foreground process / window hints → agent id (best-effort).
function openAgentIds(windows = []) {
  const ids = new Set();
  for (const w of windows) {
    const blob = `${w?.title || ''} ${w?.process || w?.exe || ''}`.toLowerCase();
    if (blob.includes('claude')) ids.add('claude');
    if (blob.includes('opencode')) ids.add('opencode');
    if (blob.includes('cursor')) ids.add('cursor-agent');
    if (blob.includes('codex')) ids.add('codex');
    if (/\bgemini\b/.test(blob)) ids.add('gemini');
  }
  return [...ids];
}

function runAgent({ id, prompt, installed, timeoutMs = 120_000, spawnImpl = spawn } = {}) {
  const list = installed || detectAgents();
  const agent = list.find((a) => a.id === id && a.ready);
  if (!agent) return Promise.reject(new Error('Ese agente no está instalado o aún no está cableado.'));
  const def = AGENTS.find((a) => a.id === id);
  const args = def.args(String(prompt || ''));
  return new Promise((resolve, reject) => {
    const child = spawnImpl(agent.path || agent.bin, args, {
      windowsHide: true,
      shell: false,
      env: process.env,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      reject(new Error(`${agent.label} tardó demasiado.`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { out += chunk; });
    child.stderr?.on('data', (chunk) => { err += chunk; });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = String(out || '').trim() || String(err || '').trim();
      if (code && !text) reject(new Error(`${agent.label} salió con código ${code}.`));
      else resolve(text);
    });
  });
}

module.exports = {
  AGENTS, which, detectAgents, pickAuto, openAgentIds, runAgent,
};
