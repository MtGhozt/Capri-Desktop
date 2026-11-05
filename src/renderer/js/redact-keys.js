// Mirror of src/main/diagnose.js redactSecrets (sandbox cannot require main). Keep in sync.

const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{10,}/g,
  /\bxai-[A-Za-z0-9_-]{8,}/g,
  /\bgsk_[A-Za-z0-9]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
  /\b[A-Za-z0-9+/]{48,}={0,2}\b/g,
];

export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const re of SECRETS) {
    out = out.replace(re, (hit) => (/^bearer/i.test(hit) ? 'Bearer <clave>' : '<clave>'));
  }
  return out;
}
