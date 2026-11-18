'use strict';

// Size ratchet: every source file stays under LIMIT lines, and the files that are still over it
// can only shrink. When you split one, lower its number here; never raise one.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIMIT = 600;

// The offenders as of the split (main.js, step 1 of 5). Lower each number as the file shrinks.
const ALLOW = {
  'src/main/main.js': 3820,
  'src/renderer/js/menu.js': 2865,
  'src/renderer/js/capri.js': 2099,
  'src/renderer/js/fx.js': 1934,
  'src/renderer/js/app.js': 1318,
  'src/main/pc-actions.js': 899,
  'src/renderer/js/bubble.js': 664,
  'src/main/voice-install.js': 604,
  'voice/server.py': 2454,
  'voice/tts.py': 627,
};

function countLines(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  return text.endsWith('\n') ? lines.length - 1 : lines.length;
}

function sources(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, ext, out);
    else if (ext.test(entry.name)) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

// src/ in full, and the Python of her sidecar (voice/.venv is not ours).
const FILES = [
  ...sources(path.join(ROOT, 'src'), /\.(js|py)$/),
  ...fs.readdirSync(path.join(ROOT, 'voice'))
    .filter((name) => /\.py$/.test(name))
    .map((name) => `voice/${name}`),
];

test('size ratchet: no file passes its line limit', () => {
  const over = [];
  for (const file of FILES) {
    const lines = countLines(path.join(ROOT, file));
    const max = ALLOW[file] ?? LIMIT;
    if (lines > max) over.push(`${file}: ${lines} lines (max ${max})`);
  }
  assert.deepStrictEqual(over, [], `split these files or lower their allowlist entry:\n${over.join('\n')}`);
});

test('size ratchet: allowlist has no stale entries', () => {
  const missing = Object.keys(ALLOW).filter((file) => !FILES.includes(file));
  assert.deepStrictEqual(missing, [], `gone from the tree: ${missing.join(', ')}`);
});
