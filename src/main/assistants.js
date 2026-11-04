'use strict';

// One small registry for the agents Capri can watch. Each entry knows its config file and
// how to install / uninstall / report itself. Claude Code keeps its own installer; the
// others share the JSON helpers below. Every install backs up the file first and removes
// only Capri's own hook entries, never anyone else's.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const claude = require('../../scripts/install-hooks');

// Antigravity does not invoke hook commands through a shell, so inner quotes in the command
// reach node literally and cause MODULE_NOT_FOUND. We only install notification-only events
// (PostToolUse, PostInvocation, Stop, SessionStart) so Capri can never block an agent's tool calls.
const AGY_EVENTS = ['SessionStart', 'PostToolUse', 'PostInvocation', 'Stop'];

// Old installs may have the quoted form `node "path" Event`. Detect and rewrite to `node path Event`.
function hasQuotedAgyHook(value) {
  if (!value || typeof value !== 'string') return false;
  // matches: node "..." Event  or  ELECTRON_RUN_AS_NODE=1 "..." "..." Event
  return /capri-antigravity-hook\.js/.test(value) && /"/.test(value);
}

function repairAgyCommand(cmd) {
  // Strip surrounding quotes from each token that is a path: `node "C:/foo" x` -> `node C:/foo x`
  return cmd.replace(/"([^"]+)"/g, '$1');
}

const MARKER = {
  claude: 'capri-hook.js',
  codex: 'capri-codex-hook.js',
  antigravity: 'capri-antigravity-hook.js',
  cursor: 'capri-cursor-hook.js',
  opencode: 'CapriPlugin',
};

const CODEX_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
  'PreCompact', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt',
];

const CURSOR_EVENTS = [
  'sessionStart', 'sessionEnd', 'beforeSubmitPrompt',
  'preToolUse', 'postToolUse', 'postToolUseFailure',
  'beforeShellExecution', 'afterShellExecution',
  'beforeMCPExecution', 'afterMCPExecution',
  'beforeReadFile', 'afterFileEdit',
  'subagentStart', 'subagentStop', 'preCompact', 'stop',
];

function hookPath(root, name) {
  return path.join(root, 'hooks', name)
    .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}). Fix it first, nothing was changed.`);
  }
}

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, `${file}.capri-backup-${stamp}`);
}

function writeJson(file, original, data) {
  const before = original == null ? null : JSON.stringify(original);
  const after = JSON.stringify(data);
  if (before === after) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) backup(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return true;
}

function isOurs(value, marker) {
  if (!value || typeof value !== 'object') return false;
  if (String(value.command || '').includes(marker)) return true;
  return Array.isArray(value.hooks) && value.hooks.some((hook) => isOurs(hook, marker));
}

function strip(value, marker) {
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const cleaned = strip(item, marker);
      if (isOurs(cleaned, marker)) continue;
      // a matcher group whose only handler was Capri's is gone too
      if (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)
        && Array.isArray(cleaned.hooks) && cleaned.hooks.length === 0) continue;
      out.push(cleaned);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = strip(value[key], marker);
  }
  return value;
}

function prune(value) {
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const cleaned = prune(item);
      if (cleaned == null) continue;
      if (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)
        && Array.isArray(cleaned.hooks) && cleaned.hooks.length === 0) continue;
      out.push(cleaned);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      value[key] = prune(value[key]);
      const child = value[key];
      if (child == null) delete value[key];
      else if (Array.isArray(child) && child.length === 0) delete value[key];
      else if (child && typeof child === 'object' && !Array.isArray(child) && Object.keys(child).length === 0) delete value[key];
    }
  }
  return value;
}

function hasMarker(value, marker) {
  if (typeof value === 'string') return value.includes(marker);
  if (Array.isArray(value)) return value.some((item) => hasMarker(item, marker));
  if (value && typeof value === 'object') return Object.values(value).some((item) => hasMarker(item, marker));
  return false;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function statusJson(file, marker) {
  const found = fs.existsSync(path.dirname(file));
  try {
    const data = readJson(file);
    return { file, found, installed: Boolean(data && hasMarker(data, marker)) };
  } catch (err) {
    return { file, found, installed: false, error: err.message };
  }
}

function removeJson(file, marker) {
  const original = readJson(file);
  if (!original) return { file, removed: false };
  const data = strip(clone(original), marker);
  prune(data);
  const removed = writeJson(file, original, data);
  return { file, removed };
}

function installCodex(root, file) {
  const original = readJson(file);
  const data = strip(clone(original || {}), MARKER.codex);
  data.hooks = data.hooks || {};
  const command = claude.commandFor('capri-codex-hook.js');
  for (const event of CODEX_EVENTS) {
    const groups = Array.isArray(data.hooks[event]) ? data.hooks[event] : [];
    groups.push({
      hooks: [{
        type: 'command',
        command,
        timeout: event === 'SessionEnd' || event === 'Interrupt' ? 2 : 10,
        async: true,
      }],
    });
    data.hooks[event] = groups;
  }
  writeJson(file, original, data);
  return { file };
}

function installCursor(root, file) {
  const original = readJson(file);
  const data = strip(clone(original || {}), MARKER.cursor);
  data.version = data.version || 1;
  data.hooks = data.hooks || {};
  const command = claude.commandFor('capri-cursor-hook.js');
  for (const event of CURSOR_EVENTS) {
    const hooks = Array.isArray(data.hooks[event]) ? data.hooks[event] : [];
    hooks.push({ command, timeout: 10 });
    data.hooks[event] = hooks;
  }
  writeJson(file, original, data);
  return { file };
}

function installAntigravity(root, file) {
  // Build a quote-free script path: Antigravity calls hook commands directly (no shell),
  // so literal quotes break node's module resolver.
  const scriptPath = path.resolve(root, 'hooks', 'capri-antigravity-hook.js')
    .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  const quoteFree = claude.toShortPath(scriptPath);
  if (!quoteFree) {
    throw new Error(
      'El directorio de Capri contiene espacios y no se pudo obtener la ruta corta (8.3) de Windows. ' +
      'Los hooks de Antigravity no se pueden instalar. Mové la app a una ruta sin espacios (p.ej. C:\\\\Programs\\\\capri-desktop).'
    );
  }
  const original = readJson(file);
  const data = repairAgy(strip(clone(original || {}), MARKER.antigravity));
  let key = 'capri-desktop';
  if (data[key] != null && (typeof data[key] !== 'object' || Array.isArray(data[key]))) {
    key = 'capri-desktop-hooks';
  }
  const entry = data[key] && typeof data[key] === 'object' ? data[key] : {};
  data[key] = entry;
  // Only non-blocking events: Capri must never be able to block an agent's tool calls.
  for (const event of AGY_EVENTS) {
    const hooks = Array.isArray(entry[event]) ? entry[event] : [];
    hooks.push({ type: 'command', command: `node ${quoteFree} ${event}`, timeout: 10, async: true });
    entry[event] = hooks;
  }
  writeJson(file, original, data);
  return { file };
}

// Walk the hooks.json tree and rewrite any old Capri Antigravity command that still has quotes.
function repairAgy(value) {
  if (Array.isArray(value)) return value.map(repairAgy);
  if (value && typeof value === 'object') {
    if (typeof value.command === 'string' && hasQuotedAgyHook(value.command)) {
      value = { ...value, command: repairAgyCommand(value.command) };
    }
    for (const k of Object.keys(value)) value[k] = repairAgy(value[k]);
  }
  return value;
}

function installOpencode(root, file) {
  const text = fs.readFileSync(hookPath(root, 'capri-opencode-plugin.js'), 'utf8');
  if (fs.existsSync(file)) {
    const old = fs.readFileSync(file, 'utf8');
    if (!old.includes(MARKER.opencode)) throw new Error(`${file} already exists and is not Capri's.`);
    if (old === text) return { file };
    backup(file);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  fs.writeFileSync(file, text);
  return { file };
}

function uninstallOpencode(file) {
  if (!fs.existsSync(file)) return { file, removed: false };
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(MARKER.opencode)) throw new Error(`${file} is not Capri's. Nothing was changed.`);
  fs.rmSync(file);
  return { file, removed: true };
}

function createAssistants({ root, home = os.homedir() } = {}) {
  const claudeFile = claude.settingsPath(home);
  const entries = [
    {
      id: 'claude',
      name: 'Claude Code',
      file: claudeFile,
      status: () => claude.status({ home }),
      install: () => claude.install({ home }),
      uninstall: () => claude.uninstall({ home }),
    },
    {
      id: 'codex',
      name: 'Codex',
      file: path.join(home, '.codex', 'hooks.json'),
      status() { return statusJson(this.file, MARKER.codex); },
      install() { return installCodex(root, this.file); },
      uninstall() { return removeJson(this.file, MARKER.codex); },
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      file: path.join(home, '.gemini', 'config', 'hooks.json'),
      status() { return statusJson(this.file, MARKER.antigravity); },
      install() { return installAntigravity(root, this.file); },
      uninstall() { return removeJson(this.file, MARKER.antigravity); },
    },
    {
      id: 'cursor',
      name: 'Cursor',
      file: path.join(home, '.cursor', 'hooks.json'),
      status() { return statusJson(this.file, MARKER.cursor); },
      install() { return installCursor(root, this.file); },
      uninstall() { return removeJson(this.file, MARKER.cursor); },
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      file: path.join(home, '.config', 'opencode', 'plugins', 'capri.js'),
      status() {
        const found = fs.existsSync(path.dirname(this.file));
        let installed = false;
        try {
          installed = fs.existsSync(this.file) && fs.readFileSync(this.file, 'utf8').includes(MARKER.opencode);
        } catch { /* unreadable */ }
        return { file: this.file, found, installed };
      },
      install() { return installOpencode(root, this.file); },
      uninstall() { return uninstallOpencode(this.file); },
    },
  ];

  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  function statusOf(entry) {
    try {
      const state = entry.status();
      return {
        id: entry.id,
        name: entry.name,
        file: entry.file,
        found: fs.existsSync(path.dirname(entry.file)),
        installed: Boolean(state.installed),
        events: Array.isArray(state.events) ? state.events : [],
        ...(state.error ? { error: state.error } : {}),
      };
    } catch (err) {
      return {
        id: entry.id, name: entry.name, file: entry.file,
        found: fs.existsSync(path.dirname(entry.file)), installed: false, error: err.message,
      };
    }
  }

  return {
    list: () => entries.map((entry) => ({ id: entry.id, name: entry.name, file: entry.file })),
    statusAll: () => entries.map(statusOf),
    install(id) {
      const entry = byId.get(String(id));
      if (!entry) return { ok: false, message: `No conozco el agente ${id}.` };
      try {
        const result = entry.install();
        return { ok: true, file: result.file, agent: statusOf(entry) };
      } catch (err) {
        return { ok: false, message: err.message, agent: statusOf(entry) };
      }
    },
    uninstall(id) {
      const entry = byId.get(String(id));
      if (!entry) return { ok: false, message: `No conozco el agente ${id}.` };
      try {
        const result = entry.uninstall();
        return { ok: true, file: result.file, removed: Boolean(result.removed), agent: statusOf(entry) };
      } catch (err) {
        return { ok: false, message: err.message, agent: statusOf(entry) };
      }
    },
    // On startup, silently rewrite any old Capri Antigravity hooks.json that still has the
    // quoted command form (`node "path" Event`). Keeps every other user hook untouched.
    repairOnStartup() {
      const agy = byId.get('antigravity');
      if (!agy) return;
      const file = agy.file;
      try {
        const original = readJson(file);
        if (!original) return;
        const repaired = repairAgy(clone(original));
        writeJson(file, original, repaired);
      } catch { /* non-fatal: bad JSON stays untouched */ }
    },
  };
}

module.exports = {
  createAssistants,
  MARKER,
  CODEX_EVENTS,
  CURSOR_EVENTS,
  AGY_EVENTS,
  readJson,
  statusJson,
  strip,
  prune,
  hasMarker,
  hasQuotedAgyHook,
  repairAgyCommand,
};
