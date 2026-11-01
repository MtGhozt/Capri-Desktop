// Capri plugin for OpenCode. Drop it in ~/.config/opencode/plugins/capri.js (Capri does it
// from Ajustes › Agentes). It forwards a trimmed copy of OpenCode's events to Capri's local
// bridge. Every failure is swallowed: Capri must never get in OpenCode's way.
//
// OpenCode v2 loads the default export (id + setup). OpenCode v1 loaded CapriPlugin below,
// kept so the same file still works on older installs.

const PORT = Number(globalThis.process?.env?.CAPRI_PORT) || 47823;
const KEEP = [
  'hook_event_name', 'session_id', 'cwd', 'tool_name', 'tool_input', 'tool_use_id',
  'error', 'is_interrupt', 'prompt', 'message', 'notification_type',
  'last_assistant_message', 'agent_id', 'agent_type', 'source', 'reason', 'trigger',
  'origin',
];

// OpenCode's tool names are lowercase; Capri knows Claude's names.
const TOOL_NAMES = {
  read: 'Read', write: 'Write', edit: 'Edit', patch: 'Edit', multiedit: 'MultiEdit',
  shell: 'Bash', bash: 'Bash', grep: 'Grep', glob: 'Glob', webfetch: 'WebFetch',
  websearch: 'WebSearch', todowrite: 'TodoWrite', task: 'Task', skill: 'Skill',
};

function toolName(name) {
  const raw = String(name || '');
  return TOOL_NAMES[raw.toLowerCase()] || raw;
}

function toolInput(input) {
  const out = { ...(input || {}) };
  if (!out.file_path && (out.path || out.filePath)) out.file_path = out.path || out.filePath;
  return out;
}

function trim(value, depth = 0) {
  if (typeof value === 'string') return value.length > 280 ? value.slice(0, 280) + '…' : value;
  if (Array.isArray(value)) return depth > 2 ? undefined : value.slice(0, 8).map((v) => trim(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 2) return undefined;
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (['content', 'old_string', 'new_string', 'new_source', 'edits'].includes(key)) {
        out[`${key}_len`] = typeof val === 'string' ? val.length : Array.isArray(val) ? val.length : 0;
        continue;
      }
      out[key] = trim(val, depth + 1);
    }
    return out;
  }
  return value;
}

function slim(evt) {
  const out = {};
  for (const key of KEEP) if (evt[key] !== undefined) out[key] = trim(evt[key]);
  const reply = evt.last_assistant_message;
  if (typeof reply === 'string') out.last_assistant_message = reply.length > 6000 ? reply.slice(0, 6000) + '…' : reply;
  return out;
}

function post(evt) {
  if (!evt?.hook_event_name) return;
  try {
    const body = JSON.stringify(slim(evt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    fetch(`http://127.0.0.1:${PORT}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    }).catch(() => {}).finally(() => clearTimeout(timer));
  } catch {
    // no bridge, no problem
  }
}

function textOf(part) {
  if (!part || typeof part !== 'object') return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  if (Array.isArray(part.content)) {
    return part.content.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
  }
  return '';
}

function errorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return error.message || error.data?.message || error.name || 'OpenCode error';
}

// OpenCode v2 events: { type, data, location }. State keeps what later events don't repeat
// (the last answer, tool names, the user's prompt).
export function mapEvent(event, state, cwd = '') {
  const type = event?.type;
  const data = event?.data || {};
  const sessionID = data.sessionID;
  const base = {
    origin: 'opencode',
    session_id: sessionID || 'opencode',
    cwd: event?.location?.directory || cwd || '',
  };
  const toolKey = `${sessionID}:${data.id}`;

  switch (type) {
    case 'session.created':
      return { ...base, hook_event_name: 'SessionStart', source: 'startup' };
    case 'session.deleted':
      return { ...base, hook_event_name: 'SessionEnd', reason: 'other' };
    case 'session.inbox.enqueued':
      if (data.item?.type === 'user') state.prompts.set(sessionID, data.item.payload?.text || '');
      return null;
    case 'session.execution.started':
      return { ...base, hook_event_name: 'UserPromptSubmit', prompt: state.prompts.get(sessionID) || '' };
    case 'session.text.ended':
      if (typeof data.text === 'string') state.latest.set(sessionID, data.text);
      return null;
    // v2 ships completion as session.execution.succeeded; idle/status are declared but often never published
    case 'session.execution.succeeded':
    case 'session.status':
      if (type === 'session.status' && data.status?.type !== 'idle') return null;
      return stopFor(base, sessionID, state);
    case 'session.idle':
      return stopFor(base, sessionID, state);
    case 'session.execution.failed':
      return { ...base, hook_event_name: 'StopFailure', error: errorText(data.error) };
    case 'session.execution.interrupted':
      return { ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'OpenCode', is_interrupt: true };
    case 'session.compaction.ended':
      return { ...base, hook_event_name: 'PreCompact' };
    case 'permission.asked':
      return {
        ...base,
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: data.message || data.action || 'OpenCode needs permission',
      };
    case 'session.tool.input.started':
      state.tools.set(toolKey, { name: toolName(data.name), input: {} });
      return null;
    case 'session.tool.called': {
      const tool = state.tools.get(toolKey) || { name: '' };
      tool.input = toolInput(data.input);
      state.tools.set(toolKey, tool);
      return {
        ...base,
        hook_event_name: 'PreToolUse',
        tool_name: tool.name,
        tool_input: tool.input,
        tool_use_id: data.id,
      };
    }
    case 'session.tool.success': {
      const tool = state.tools.get(toolKey) || { name: '', input: {} };
      state.tools.delete(toolKey);
      return {
        ...base,
        hook_event_name: 'PostToolUse',
        tool_name: tool.name,
        tool_input: tool.input,
        tool_use_id: data.id,
      };
    }
    case 'session.tool.failed': {
      const tool = state.tools.get(toolKey) || { name: '', input: {} };
      state.tools.delete(toolKey);
      return {
        ...base,
        hook_event_name: 'PostToolUseFailure',
        tool_name: tool.name || 'OpenCode',
        tool_input: tool.input,
        tool_use_id: data.id,
        error: errorText(data.error),
      };
    }
    default:
      return null;
  }
}

// v2 can report "idle" twice (status + the old idle event): answer once.
function stopFor(base, sessionID, state) {
  const now = Date.now();
  if (now - (state.idleAt.get(sessionID) || 0) < 1500) return null;
  state.idleAt.set(sessionID, now);
  return { ...base, hook_event_name: 'Stop', last_assistant_message: state.latest.get(sessionID) || '' };
}

export default {
  id: 'capri',
  setup: async (ctx) => {
    // OpenCode reloads the plugin when the file changes (Capri's settings reinstall it).
    // A reload must not leave the old listener posting as well, so keep one per process.
    const KEY = Symbol.for('capri.opencode.subscription');
    globalThis[KEY]?.abort();
    const controller = new AbortController();
    globalThis[KEY] = controller;
    const state = { latest: new Map(), prompts: new Map(), tools: new Map(), idleAt: new Map() };
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const mapped = mapEvent(event, state, ctx.location?.directory);
          if (mapped) post(mapped);
        }
      } catch {
        // never let a Capri bug reach OpenCode
      }
    })();
    return () => {
      controller.abort();
      if (globalThis[KEY] === controller) delete globalThis[KEY];
    };
  },
};

// OpenCode v1 plugin API (older installs): an async function returning event hooks.
export const CapriPlugin = async ({ directory } = {}) => {
  const latest = new Map(); // session id -> last assistant text
  const assistant = new Set(); // message ids known to be assistant messages
  const cwd = directory || globalThis.process?.cwd?.() || '';
  const base = (sessionID) => ({ origin: 'opencode', session_id: sessionID || 'opencode', cwd });

  return {
    event: async ({ event } = {}) => {
      try {
        const type = event?.type;
        const props = event?.properties || {};
        const sessionID = props.sessionID || props.info?.id || props.part?.sessionID;

        if (type === 'session.created') {
          post({ ...base(sessionID), hook_event_name: 'SessionStart', source: 'startup' });
          return;
        }
        if (type === 'session.idle') {
          post({ ...base(sessionID), hook_event_name: 'Stop', last_assistant_message: latest.get(sessionID) || '' });
          return;
        }
        if (type === 'session.error') {
          post({ ...base(sessionID), hook_event_name: 'StopFailure', error: errorText(props.error) });
          return;
        }
        if (type === 'permission.asked') {
          post({
            ...base(sessionID),
            hook_event_name: 'Notification',
            notification_type: 'permission_prompt',
            message: props.permission?.title || props.permission?.message || props.title || 'OpenCode needs permission',
          });
          return;
        }
        if (type === 'session.compacted') {
          post({ ...base(sessionID), hook_event_name: 'PreCompact' });
          return;
        }
        if (type === 'session.deleted') {
          post({ ...base(sessionID), hook_event_name: 'SessionEnd', reason: 'other' });
          return;
        }
        if (type === 'message.updated') {
          if (props.info?.role === 'assistant' && props.info?.id) assistant.add(props.info.id);
          return;
        }
        if (type === 'message.part.updated') {
          const part = props.part;
          if (part?.type === 'text' && assistant.has(part.messageID)) {
            latest.set(part.sessionID || sessionID, textOf(part));
          }
        }
      } catch {
        // never let a Capri bug reach OpenCode
      }
    },

    'tool.execute.before': async (input, output) => {
      try {
        post({
          ...base(input?.sessionID),
          hook_event_name: 'PreToolUse',
          tool_name: toolName(input?.tool),
          tool_input: toolInput(output?.args),
          tool_use_id: input?.callID,
        });
      } catch {
        // ignore
      }
    },

    'tool.execute.after': async (input, output) => {
      try {
        const error = output?.metadata?.error || output?.error;
        post({
          ...base(input?.sessionID),
          hook_event_name: error ? 'PostToolUseFailure' : 'PostToolUse',
          tool_name: toolName(input?.tool),
          tool_input: toolInput(input?.args),
          tool_use_id: input?.callID,
          error: error ? errorText(error) : undefined,
        });
      } catch {
        // ignore
      }
    },
  };
};
