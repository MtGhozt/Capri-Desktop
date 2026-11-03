'use strict';

// Use an installed coding-agent CLI as Capri's brain (no Capri-managed tokens).
// Read-only / no-edit flags where the CLI exposes them; OpenCode has no such flag.

const { spawn } = require('node:child_process');

const AGENT_TIMEOUT_MS = 45_000;

const AGENTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    args: (prompt) => ['-p', '--permission-mode', 'plan', prompt],
    installHow: 'irm https://claude.ai/install.ps1 | iex',
    note: 'Instalalo desde cualquier ventana de PowerShell; no hace falta estar en la carpeta de Capri.',
    ready: true,
  },
  {
    id: 'cursor-agent',
    label: 'Cursor Agent (CLI)',
    bin: 'cursor-agent',
    args: (prompt) => ['-p', '--mode=ask', '--output-format', 'text', prompt],
    installHow: 'curl https://cursor.com/install -fsS | bash',
    note: 'Instalalo desde cualquier ventana de PowerShell; no hace falta estar en la carpeta de Capri.',
    ready: true,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    bin: 'opencode',
    args: (prompt) => ['run', prompt],
    installHow: 'npm install -g @opencode/cli',
    note: 'Instalalo desde cualquier ventana de PowerShell; no hace falta estar en la carpeta de Capri.',
    ready: true,
  },
  {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    args: (prompt) => ['exec', '--sandbox', 'read-only', '--ask-for-approval', 'never', prompt],
    installHow: 'npm install -g @openai/codex',
    note: 'Instalalo desde cualquier ventana de PowerShell; no hace falta estar en la carpeta de Capri. Luego confiá los hooks solo si querés que Codex los ejecute.',
    ready: true,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    bin: 'gemini',
    args: (prompt) => ['-p', '--approval-mode=plan', prompt],
    installHow: 'npm install -g @google/gemini-cli',
    note: 'Instalalo desde cualquier ventana de PowerShell; no hace falta estar en la carpeta de Capri.',
    ready: true,
  },
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

function runnable(file, { execFileSync = require('node:child_process').execFileSync, platform = process.platform } = {}) {
  try {
    execFileSync(file, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      shell: platform === 'win32',
    });
    return true;
  } catch {
    return false;
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
    const installed = Boolean(file) && runnable(file, opts);
    return {
      id: a.id,
      label: a.label,
      bin: a.bin,
      installed,
      path: file,
      ready: a.ready && installed,
      installHow: a.installHow || '',
      note: a.note || (a.ready ? '' : 'Próximamente'),
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

function wrapPrompt(prompt, persona) {
  const user = String(prompt || '');
  const who = String(persona || '').trim();
  if (!who) return user;
  return `${who}\n\n---\nUser: ${user}`;
}

function runAgent({
  id, prompt, persona, installed, timeoutMs = AGENT_TIMEOUT_MS, spawnImpl = spawn,
} = {}) {
  const list = installed || detectAgents();
  const agent = list.find((a) => a.id === id && a.ready);
  if (!agent) return Promise.reject(new Error('Ese agente no está instalado o aún no está cableado.'));
  const def = AGENTS.find((a) => a.id === id);
  const args = def.args(wrapPrompt(prompt, persona));
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
  AGENTS, AGENT_TIMEOUT_MS, which, detectAgents, pickAuto, openAgentIds, wrapPrompt, runAgent,
};
