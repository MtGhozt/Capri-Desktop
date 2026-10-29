'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureUserFiles } = require('../src/main/user-files');

test('first run copies persona and memory defaults into userData', () => {
  const root = path.join(__dirname, '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-user-'));
  const first = ensureUserFiles({ userData, root });
  assert.equal(first.persona.created, true);
  assert.equal(first.memory.created, true);
  assert.match(fs.readFileSync(first.persona.path, 'utf8'), /You are Capri/);
  assert.match(fs.readFileSync(first.memory.path, 'utf8'), /Memoria de Capri/);

  fs.writeFileSync(first.persona.path, 'custom persona', 'utf8');
  const second = ensureUserFiles({ userData, root });
  assert.equal(second.persona.created, false);
  assert.equal(fs.readFileSync(second.persona.path, 'utf8'), 'custom persona');
});
