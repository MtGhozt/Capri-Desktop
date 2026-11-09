'use strict';

// Use an installed coding-agent CLI as Capri's brain (no Capri-managed tokens).
// Read-only / no-edit flags where the CLI exposes them; OpenCode has no such flag.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const AGENT_TIMEOUT_MS = 45_000;
const VERSION_TIMEOUT_MS = 15_000;
const KNOWN_PATH_NOTE = 'Lo encontré fuera del PATH; funciona igual.';

function homeDir(env) {
  return env.USERPROFILE || env.HOME || '';
}

function npmKnownPaths(name, env) {
  const appData = env.APPDATA;
  return appData ? [path.join(appData, 'npm', `${name}.cmd`)] : [];
}

const AGENTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    args: (prompt) => ['-p', '--permission-mode', 'plan', prompt],
    installHow: 'irm https://claude.ai/install.ps1 | iex',
    knownPaths: (env) => {
      const home = homeDir(env);
      return home
        ? [
          path.join(home, '.local', 'bin', 'claude.exe'),
          path.join(home, '.local', 'bin', 'claude.cmd'),
        ]
        : [];
    },
    note: 'Instalalo desde cualquier ventana de PowerShell; no hace falta estar en la carpeta de Capri.',
    ready: true,
  },
  {
    id: 'cursor-agent',
    label: 'Cursor Agent (CLI)',
    bin: 'cursor-agent',
    bins: ['cursor-agent', 'agent'],
    args: (prompt) => ['-p', '--mode=ask', '--output-format', 'text', prompt],
    installHow: "irm 'https://cursor.com/install?win32=true' | iex",
    note: 'Instalalo desde cualquier ventana de PowerShell; no hace falta estar en la carpeta de Capri.',
    ready: true,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    bin: 'opencode',
    args: (prompt) => ['run', prompt],
    installHow: 'npm install -g opencode-ai',
    knownPaths: (env) => npmKnownPaths('opencode', env),
    note: 'Instalalo desde cualquier ventana de PowerShell; no hace falta estar en la carpeta de Capri.',
    ready: true,
  },
  {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    args: (prompt) => ['exec', '--sandbox', 'read-only', '--ask-for-approval', 'never', prompt],
    installHow: 'npm install -g @openai/codex',
    knownPaths: (env) => npmKnownPaths('codex', env),
    note: 'Instalalo desde cualquier ventana de PowerShell; no hace falta estar en la carpeta de Capri. Luego confiá los hooks solo si querés que Codex los ejecute.',
    ready: true,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    bin: 'gemini',
    args: (prompt) => ['-p', '--approval-mode=plan', prompt],
    installHow: 'npm install -g @google/gemini-cli',
    knownPaths: (env) => npmKnownPaths('gemini', env),
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

function versionStatus(file, { execFileSync = require('node:child_process').execFileSync, platform = process.platform } = {}) {
  try {
    execFileSync(file, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: VERSION_TIMEOUT_MS,
      shell: platform === 'win32',
    });
    return 'ok';
  } catch (err) {
    if (err?.killed || err?.code === 'ETIMEDOUT') return 'timeout';
    return 'error';
  }
}

function runnable(file, opts = {}) {
  return versionStatus(file, opts) === 'ok';
}

function logDetect(msg, log) {
  if (typeof log === 'function') {
    log(msg);
    return;
  }
  try {
    const { logEvent, voiceLogPath } = require('./log');
    logEvent(voiceLogPath(), msg);
  } catch { /* tests / electron not ready */ }
}

// `where`/`which` per CLI is slow on cold PATH; cache so menu:get does not stall the first paint.
let agentsCache = null;
let agentsCacheAt = 0;
let agentsRefreshQueued = false;
const AGENTS_CACHE_MS = 60_000;

function refreshAgentsAsync() {
  if (agentsRefreshQueued) return;
  agentsRefreshQueued = true;
  setImmediate(() => {
    try { detectAgents({ force: true }); } catch { /* PATH oddities */ }
    agentsRefreshQueued = false;
  });
}

function detectAgents(opts = {}) {
  const now = Date.now();
  // custom which (tests) always bypasses; production PATH scans are cached
  if (!opts.force && !opts.execFileSync && agentsCache) {
    // Menus: serve stale immediately; refresh in the background after TTL.
    if (now - agentsCacheAt >= AGENTS_CACHE_MS) refreshAgentsAsync();
    return agentsCache;
  }
  const list = AGENTS.map((a) => {
    const bins = a.bins || [a.bin];
    const env = opts.env || process.env;
    const exists = opts.existsSync || fs.existsSync;
    let file = null;
    let reportBin = bins[0];
    let reportPath = null;
    let reportVer = 'none';
    let knownHit = false;
    for (const bin of bins) {
      const found = which(bin, opts);
      if (!found) continue;
      const status = versionStatus(found, opts);
      reportBin = bin;
      reportPath = found;
      reportVer = status;
      if (status === 'ok') {
        file = found;
        break;
      }
    }
    // Native installers often drop the CLI outside PATH; check their usual folders next.
    if (!file && !reportPath) {
      for (const candidate of (a.knownPaths ? a.knownPaths(env) : [])) {
        if (!exists(candidate)) continue;
        reportPath = candidate;
        reportVer = versionStatus(candidate, opts);
        if (reportVer === 'ok') {
          file = candidate;
          knownHit = true;
          break;
        }
      }
    }
    logDetect(
      `agent detect ${a.id} bin=${reportBin} path=${reportPath || 'none'} version=${reportVer}${knownHit ? ' via=known-path' : ''}`,
      opts.log,
    );
    const installed = Boolean(file);
    return {
      id: a.id,
      label: a.label,
      bin: a.bin,
      installed,
      path: file,
      viaKnownPath: knownHit,
      ready: a.ready && installed,
      installHow: a.installHow || '',
      note: knownHit ? KNOWN_PATH_NOTE : (a.note || (a.ready ? '' : 'Próximamente')),
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
  AGENTS, AGENT_TIMEOUT_MS, VERSION_TIMEOUT_MS, which, runnable, versionStatus,
  detectAgents, pickAuto, openAgentIds, wrapPrompt, runAgent,
};
