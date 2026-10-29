'use strict';

// Editable persona + memory live in userData (not in the asar). First run copies the
// shipped defaults; later edits stay on this PC and never go back into the installer.

const fs = require('node:fs');
const path = require('node:path');

const NAMES = {
  persona: 'persona.md',
  memory: 'memory.md',
};

function defaultPath(root, name) {
  return path.join(root, 'src', 'main', 'defaults', NAMES[name] || name);
}

function userPath(userData, name) {
  return path.join(userData, NAMES[name] || name);
}

function ensureUserFile(userData, root, name) {
  const dest = userPath(userData, name);
  if (fs.existsSync(dest)) return { path: dest, created: false };
  fs.mkdirSync(userData, { recursive: true });
  const src = defaultPath(root, name);
  let text = '';
  try { text = fs.readFileSync(src, 'utf8'); } catch { /* empty */ }
  fs.writeFileSync(dest, text, 'utf8');
  return { path: dest, created: true };
}

function ensureUserFiles({ userData, root }) {
  return {
    persona: ensureUserFile(userData, root, 'persona'),
    memory: ensureUserFile(userData, root, 'memory'),
  };
}

module.exports = { ensureUserFiles, ensureUserFile, userPath, defaultPath, NAMES };
