// Capri plugin for OpenCode. Drop it in ~/.config/opencode/plugins/capri.js (Capri does it
// from Ajustes › Agentes). It forwards a trimmed copy of OpenCode's events to Capri's local
// bridge. Every failure is swallowed: Capri must never get in OpenCode's way.

const PORT = Number(globalThis.process?.env?.CAPRI_PORT) || 47823;
const KEEP = [
  'hook_event_name', 'session_id', 'cwd', 'tool_name', 'tool_input', 'tool_use_id',
  'error', 'is_interrupt', 'prompt', 'message', 'notification_type',
  'last_assistant_message', 'agent_id', 'agent_type', 'source', 'reason', 'trigger',
];

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

export const CapriPlugin = async ({ directory } = {}) => {
  const latest = new Map(); // session id -> last assistant text
  const assistant = new Set(); // message ids known to be assistant messages
  const cwd = directory || globalThis.process?.cwd?.() || '';
  const base = (sessionID) => ({ session_id: sessionID || 'opencode', cwd });

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
          tool_name: input?.tool,
          tool_input: output?.args || {},
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
          tool_name: input?.tool,
          tool_input: input?.args || {},
          tool_use_id: input?.callID,
          error: error ? errorText(error) : undefined,
        });
      } catch {
        // ignore
      }
    },
  };
};

export default CapriPlugin;
