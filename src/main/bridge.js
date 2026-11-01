'use strict';

// Local HTTP bridge. Claude Code hooks POST their event JSON to /event,
// we hand it to the overlay. Bound to 127.0.0.1 only.

const http = require('node:http');

const MAX_BODY = 512 * 1024;
const DEDUPE_MS = 1200;
const DEDUPE_KINDS = new Set(['PreToolUse', 'PostToolUse']);

// OpenCode (and multi-workspace hosts) can post the same tool call several times.
function createDedupe(windowMs = DEDUPE_MS) {
  const seen = new Map();
  return (evt) => {
    if (!DEDUPE_KINDS.has(evt.hook_event_name) || !evt.tool_use_id) return false;
    const key = `${evt.origin || ''}|${evt.session_id || ''}|${evt.tool_use_id}|${evt.hook_event_name}`;
    const now = Date.now();
    const prev = seen.get(key);
    if (prev && now - prev < windowMs) return true;
    seen.set(key, now);
    if (seen.size > 200) {
      for (const [k, t] of seen) {
        if (now - t > windowMs) seen.delete(k);
      }
    }
    return false;
  };
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function createBridge({ port, onEvent, onDebug, log }) {
  const isDupe = createDedupe();
  const server = http.createServer(async (req, res) => {
    // Browsers always send an Origin header on cross-site requests; hooks never do.
    // Refusing those keeps random web pages from puppeting Capri.
    if (req.headers.origin) return send(res, 403, { ok: false });

    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, name: 'capri', pid: process.pid });
    }

    if (req.method === 'POST' && url.pathname === '/event') {
      try {
        const evt = await readJson(req);
        if (!evt || typeof evt !== 'object' || typeof evt.hook_event_name !== 'string') {
          return send(res, 400, { ok: false, error: 'missing hook_event_name' });
        }
        if (isDupe(evt)) {
          log?.(`event dedupe origin=${typeof evt.origin === 'string' ? evt.origin : 'unknown'} type=${evt.hook_event_name}`);
          return send(res, 200, { ok: true, deduped: true });
        }
        // one line per event, origin + kind only: no prompts, paths or tool content
        log?.(`event origin=${typeof evt.origin === 'string' ? evt.origin : 'unknown'} type=${evt.hook_event_name}`);
        onEvent(evt);
        return send(res, 200, { ok: true });
      } catch (err) {
        return send(res, 400, { ok: false, error: err.message });
      }
    }

    if (onDebug && url.pathname.startsWith('/debug/')) {
      try {
        const body = req.method === 'POST' ? await readJson(req).catch(() => ({})) : {};
        return send(res, 200, await onDebug(url.pathname.slice(7), body));
      } catch (err) {
        return send(res, 500, { ok: false, error: err.message });
      }
    }

    send(res, 404, { ok: false });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[capri] port ${port} already in use, Claude events will not reach this instance`);
    } else {
      console.error('[capri] bridge error:', err.message);
    }
  });

  server.listen(port, '127.0.0.1', () => console.log(`[capri] listening on 127.0.0.1:${port}`));
  return server;
}

module.exports = { createBridge, createDedupe };
