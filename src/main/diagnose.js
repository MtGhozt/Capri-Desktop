'use strict';

// The "Diagnóstico" report from Ajustes: a short ✅/❌ list a user can paste in Discord.
// Keep it path-free and key-free; the probes live in main.js, this only formats and redacts.

function checkLine({ label, ok = false, detail = '' } = {}) {
  return `${ok ? '✅' : '❌'} ${label || '?'}${detail ? `: ${detail}` : ''}`;
}

function formatReport({ version, windows, log, checks = [] } = {}) {
  const head = [`Capri ${version || '?'}`];
  if (windows) head.push(`Windows ${windows}`);
  const lines = [...head, '', ...checks.map(checkLine)];
  if (log) lines.push('', `Log: ${log}`);
  return lines.join('\n');
}

const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{10,}/g,
  /\bxai-[A-Za-z0-9_-]{8,}/g,
  /\bgsk_[A-Za-z0-9]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
  /\b[A-Za-z0-9+/]{48,}={0,2}\b/g,
];

/** Strip API keys / tokens from text. Does not touch files on disk. */
function redactSecrets(text) {
  let out = String(text ?? '');
  for (const re of SECRETS) {
    out = out.replace(re, (hit) => (/^bearer/i.test(hit) ? 'Bearer <clave>' : '<clave>'));
  }
  return out;
}

// `user` is the profile folder name (C:\Users\<user>); only paths are touched, never words.
function redact(text, { user } = {}) {
  let out = String(text ?? '');
  const name = String(user || '').trim();
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(users[\\\\/])${escaped}(?=[\\\\/]|$)`, 'gi'), '$1<usuario>');
  }
  return redactSecrets(out);
}

/** Shape for "Copiar error": redacted text safe to paste. */
function copyErrorPayload(message, { user } = {}) {
  return { ok: true, text: redact(String(message ?? ''), { user }) };
}

module.exports = { checkLine, formatReport, redact, redactSecrets, copyErrorPayload };
