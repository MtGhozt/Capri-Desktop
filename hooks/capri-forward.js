'use strict';

// Shared tail for every Capri hook adapter: read one JSON event from stdin, keep only the
// fields Capri uses, POST it to the local bridge, and get out of the agent's way.
// Rule #1: never block the agent. Give up fast, always exit 0.

const http = require('node:http');

const PORT = Number(process.env.CAPRI_PORT) || 47823;

// Fields Capri actually uses. Everything else (file contents, tool output...) stays on your machine.
const KEEP = [
  'hook_event_name', 'session_id', 'cwd', 'session_title', 'permission_mode',
  'tool_name', 'tool_input', 'tool_use_id', 'duration_ms', 'error', 'is_interrupt',
  'prompt', 'message', 'title', 'notification_type', 'last_assistant_message',
  'agent_id', 'agent_type', 'source', 'reason', 'trigger', 'origin',
];

function trim(value, depth = 0) {
  if (typeof value === 'string') return value.length > 280 ? value.slice(0, 280) + '…' : value;
  if (Array.isArray(value)) return depth > 2 ? undefined : value.slice(0, 8).map((v) => trim(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 2) return undefined;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // big edit payloads are useless to Capri, keep only their size
      if (['content', 'old_string', 'new_string', 'new_source', 'edits'].includes(k)) {
        out[k + '_len'] = typeof v === 'string' ? v.length : Array.isArray(v) ? v.length : 0;
        continue;
      }
      out[k] = trim(v, depth + 1);
    }
    return out;
  }
  return value;
}

// The agent's answer, long enough for Capri to show it to you when you're not on its window
const REPLY_MAX = 6000;

function slim(evt) {
  const out = {};
  for (const key of KEEP) if (evt[key] !== undefined) out[key] = trim(evt[key]);
  const reply = evt.last_assistant_message;
  if (typeof reply === 'string') out.last_assistant_message = reply.length > REPLY_MAX ? reply.slice(0, REPLY_MAX) + '…' : reply;
  return out;
}

const bail = () => process.exit(0);

function readEvent(cb, onError = bail) {
  setTimeout(onError, 2000).unref();
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 8 * 1024 * 1024) onError();
  });
  process.stdin.on('error', onError);
  process.stdin.on('end', () => {
    let evt;
    try {
      evt = JSON.parse(raw);
    } catch {
      return onError();
    }
    cb(evt);
  });
}

function forward(evt, done = bail) {
  const body = JSON.stringify(slim(evt));
  const req = http.request({
    host: '127.0.0.1',
    port: PORT,
    path: '/event',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    timeout: 800,
  }, (res) => {
    res.resume();
    res.on('end', done);
  });
  req.on('timeout', () => { req.destroy(); done(); });
  req.on('error', done);
  req.end(body);
}

// map(raw) -> the event Capri expects, or null to drop it. respond() must always end the process.
function run(map, respond = bail) {
  readEvent((evt) => {
    let mapped;
    try {
      mapped = map ? map(evt) : evt;
    } catch {
      return respond();
    }
    if (!mapped) return respond();
    forward(mapped, respond);
  }, respond);
}

module.exports = { PORT, trim, slim, readEvent, forward, run };
