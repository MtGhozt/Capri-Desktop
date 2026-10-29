'use strict';

// Ensures every relative require under src/ resolves on disk, and that anything
// outside src/ is listed in electron-builder files (and present in app.asar after dist).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ASAR = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');
const REQ_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function walkJs(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkJs(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function resolveReq(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function collectRelativeRequires() {
  const files = walkJs(SRC);
  const resolved = new Map(); // abs path -> from
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    REQ_RE.lastIndex = 0;
    let m;
    while ((m = REQ_RE.exec(text))) {
      const abs = resolveReq(file, m[1]);
      assert.ok(abs, `unresolved require('${m[1]}') in ${path.relative(ROOT, file)}`);
      if (!resolved.has(abs)) resolved.set(abs, path.relative(ROOT, file));
    }
  }
  return resolved;
}

function builderFiles() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.build?.files || [];
}

function loadAsar() {
  const candidates = [
    path.join(ROOT, 'node_modules', '@electron', 'asar'),
    ...fs.readdirSync(path.join(ROOT, 'node_modules', '.pnpm'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('@electron+asar@'))
      .map((d) => path.join(ROOT, 'node_modules', '.pnpm', d.name, 'node_modules', '@electron', 'asar')),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return require(dir);
  }
  throw new Error('@electron/asar not found under node_modules (needed to audit app.asar)');
}

function asarHas(relPosix, list) {
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\//, '');
  return list.some((p) => norm(p) === relPosix);
}

test('relative requires under src/ resolve on disk', () => {
  const map = collectRelativeRequires();
  assert.ok(map.size > 20);
});

test('out-of-src requires are explicitly packaged in build.files', () => {
  const map = collectRelativeRequires();
  const files = builderFiles();
  const outside = [...map.keys()].filter((abs) => !abs.startsWith(SRC + path.sep) && abs !== SRC);
  for (const abs of outside) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    assert.ok(
      files.includes(rel),
      `${rel} is required from ${map.get(abs)} but missing from package.json build.files`,
    );
  }
});

test('built app.asar contains every relative require target (when dist exists)', { skip: !fs.existsSync(ASAR) }, () => {
  const asar = loadAsar();
  const list = asar.listPackage(ASAR);
  const map = collectRelativeRequires();
  for (const abs of map.keys()) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    assert.ok(asarHas(rel, list), `app.asar missing ${rel} (required for packaged launch)`);
  }
});
