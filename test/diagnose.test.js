'use strict';

// Ajustes › Diagnóstico: the pasted report must be short, readable and safe to share.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkLine, formatReport, redact, redactSecrets, copyErrorPayload } = require('../src/main/diagnose');

test('a check reads as ✅/❌ plus its detail', () => {
  assert.equal(checkLine({ label: 'Python 3.11', ok: true, detail: 'Python 3.11.9' }), '✅ Python 3.11: Python 3.11.9');
  assert.equal(checkLine({ label: 'Voz', ok: false }), '❌ Voz');
});

test('the report has versions on top, one line per check and the log at the end', () => {
  const text = formatReport({
    version: '0.2.4',
    windows: '10.0.22631',
    log: 'C:\\Users\\Matias\\AppData\\Roaming\\capri-desktop\\logs\\voice.log',
    checks: [
      { label: 'Python 3.11', ok: true, detail: 'Python 3.11.9' },
      { label: 'Voz', ok: false, detail: 'detenida' },
    ],
  });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Capri 0.2.4');
  assert.equal(lines[1], 'Windows 10.0.22631');
  assert.ok(lines.includes('✅ Python 3.11: Python 3.11.9'));
  assert.ok(lines.includes('❌ Voz: detenida'));
  assert.match(text, /^Log: /m);
});

test('redact hides the profile folder and every key shape', () => {
  const text = [
    'Log: C:\\Users\\Matias\\AppData\\Roaming\\capri-desktop\\logs\\voice.log',
    'Alt: C:/Users/Matias/AppData/Local/Temp',
    'sk-abcdefgh12345678 AIzaSyD-abcdefghijklmnop gsk_abcdefgh12345678 xai-abcdefgh12345678',
    'Authorization: Bearer abcdefghijklmnop',
  ].join('\n');
  const out = redact(text, { user: 'Matias' });
  assert.ok(!out.includes('Matias'));
  assert.match(out, /C:\\Users\\<usuario>\\AppData/);
  assert.match(out, /C:\/Users\/<usuario>\/AppData/);
  assert.ok(!out.includes('sk-abcdefgh'));
  assert.ok(!out.includes('AIzaSyD'));
  assert.ok(!out.includes('gsk_abcdefgh'));
  assert.ok(!out.includes('xai-abcdefgh'));
  assert.ok(!out.includes('Bearer abcdefgh'));
  assert.match(out, /Bearer <clave>/);
  assert.equal((out.match(/<clave>/g) || []).length, 5);
});

test('redactSecrets catches keys, hex and base64; leaves ordinary words alone', () => {
  assert.match(redactSecrets('key sk-abcdefghijklmnop here'), /<clave>/);
  assert.match(redactSecrets('tok AIzaSyD-abcdefghijklmnop'), /<clave>/);
  assert.match(redactSecrets('xai-abcdefghijklmnop'), /<clave>/);
  assert.match(redactSecrets('gsk_abcdefghijklmnop'), /<clave>/);
  assert.match(redactSecrets('Bearer abcdefghijklmnop'), /Bearer <clave>/);
  assert.match(redactSecrets(`hex ${'a'.repeat(40)}`), /<clave>/);
  assert.match(redactSecrets(`b64 ${'A'.repeat(48)}=`), /<clave>/);
  assert.equal(redactSecrets('skater with a Bearer of bad news'), 'skater with a Bearer of bad news');
  assert.equal(redactSecrets('short abcd'), 'short abcd');
});

test('copyErrorPayload redacts paths and secrets for the clipboard', () => {
  const payload = copyErrorPayload(
    'Fail C:\\Users\\Matias\\AppData\\Local\\Temp sk-abcdefghijklmnop',
    { user: 'Matias' },
  );
  assert.equal(payload.ok, true);
  assert.ok(!payload.text.includes('Matias'));
  assert.ok(!payload.text.includes('sk-abcdefgh'));
  assert.match(payload.text, /<clave>/);
  assert.match(payload.text, /Users\\<usuario>/);
});

test('redaction leaves ordinary text alone', () => {
  const text = 'Capri 0.2.4\n✅ Python 3.11: Python 3.11.9';
  assert.equal(redact(text, { user: 'Matias' }), text);
});
