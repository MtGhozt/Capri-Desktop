'use strict';

// Ajustes › Diagnóstico: the pasted report must be short, readable and safe to share.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkLine, formatReport, redact } = require('../src/main/diagnose');

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
    'sk-abcdefgh12345678 AIzaSyD-abcdefghijklmnop gsk_abcdefgh12345678',
    'Authorization: Bearer abcdefghijklmnop',
  ].join('\n');
  const out = redact(text, { user: 'Matias' });
  assert.ok(!out.includes('Matias'));
  assert.match(out, /C:\\Users\\<usuario>\\AppData/);
  assert.match(out, /C:\/Users\/<usuario>\/AppData/);
  assert.ok(!out.includes('sk-abcdefgh'));
  assert.ok(!out.includes('AIzaSyD'));
  assert.ok(!out.includes('gsk_abcdefgh'));
  assert.ok(!out.includes('Bearer abcdefgh'));
  assert.match(out, /Bearer <clave>/);
  assert.equal((out.match(/<clave>/g) || []).length, 4);
});

test('redaction leaves ordinary text alone', () => {
  const text = 'Capri 0.2.4\n✅ Python 3.11: Python 3.11.9';
  assert.equal(redact(text, { user: 'Matias' }), text);
});
