'use strict';

// Permanent safety net for the src/ split: syntax, relative import/require resolution,
// and named ESM import ↔ export matching. No new dependencies.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const FROM_IMPORT = /import\s+([\s\S]*?)\s+from\s+['"](\.[^'"]+)['"]/g;
const SIDE_IMPORT = /^\s*import\s+['"](\.[^'"]+)['"]\s*;?\s*$/gm;
const REQUIRE_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function walkJs(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkJs(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function resolveRel(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function collectNamedExports(file) {
  const text = fs.readFileSync(file, 'utf8');
  const named = new Set();

  let m;
  const decl = /export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = decl.exec(text))) named.add(m[1]);

  const brace = /export\s*\{([^}]+)\}/g;
  while ((m = brace.exec(text))) {
    for (const part of m[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const as = p.match(/^(.+?)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (as) named.add(as[2].trim());
      else named.add(p.split(/\s+/)[0]);
    }
  }

  const expDot = /exports\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = expDot.exec(text))) named.add(m[1]);

  // module.exports = { a, b: c } and Object.assign(module.exports, { ... })
  const bags = [
    ...text.matchAll(/module\.exports\s*=\s*\{([^}]+)\}/g),
    ...text.matchAll(/Object\.assign\(\s*module\.exports\s*,\s*\{([^}]+)\}/g),
  ];
  for (const bag of bags) {
    for (const part of bag[1].split(',')) {
      const id = part.trim().split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id)) named.add(id);
    }
  }

  return named;
}

function namedImportsFromClause(clause) {
  const brace = clause.match(/\{([^}]*)\}/);
  if (!brace) return [];
  const names = [];
  for (const part of brace[1].split(',')) {
    let p = part.trim();
    if (!p) continue;
    p = p.replace(/^type\s+/, '');
    if (!p || p === 'default') continue;
    const as = p.match(/^(.+?)\s+as\s+/);
    names.push((as ? as[1] : p).trim());
  }
  return names;
}

function auditSrc() {
  const files = walkJs(SRC);
  const issues = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status !== 0) {
      issues.push(`${rel}: syntax — ${(check.stderr || check.stdout || '').trim()}`);
    }

    const text = fs.readFileSync(file, 'utf8');

    REQUIRE_RE.lastIndex = 0;
    let m;
    while ((m = REQUIRE_RE.exec(text))) {
      if (!resolveRel(file, m[1])) {
        issues.push(`${rel}: unresolved require('${m[1]}')`);
      }
    }

    SIDE_IMPORT.lastIndex = 0;
    while ((m = SIDE_IMPORT.exec(text))) {
      if (!resolveRel(file, m[1])) {
        issues.push(`${rel}: unresolved import('${m[1]}')`);
      }
    }

    FROM_IMPORT.lastIndex = 0;
    while ((m = FROM_IMPORT.exec(text))) {
      const clause = m[1].trim();
      const spec = m[2];
      const abs = resolveRel(file, spec);
      if (!abs) {
        issues.push(`${rel}: unresolved from '${spec}'`);
        continue;
      }
      const exports = collectNamedExports(abs);
      for (const name of namedImportsFromClause(clause)) {
        if (!exports.has(name)) {
          const target = path.relative(ROOT, abs).replace(/\\/g, '/');
          issues.push(`${rel}: '${name}' not exported by ${target}`);
        }
      }
    }
  }

  return { files, issues };
}

// FX-split helpers that already caused overlay boot crashes when left unbound.
const FX_MUST_IMPORT = ['rand', 'clamp', 'lerp', 'pick', 'COLORS', 'FRAME_MS', 'hash', 'onTwos', 'fadeStep'];

function stripNoise(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:\\`|[^`])*`/g, '""')
    .replace(/'(?:\\'|[^'])*'/g, '""')
    .replace(/"(?:\\"|[^"])*"/g, '""');
}

function importedNames(text) {
  const names = new Set();
  let m;
  const from = /import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g;
  while ((m = from.exec(text))) {
    const clause = m[1].trim();
    const def = clause.match(/^([A-Za-z_$][\w$]*)/);
    if (def && !clause.startsWith('{') && !clause.startsWith('*')) names.add(def[1]);
    const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (star) names.add(star[1]);
    for (const n of namedImportsFromClause(clause)) names.add(n);
    const brace = clause.match(/\{([^}]*)\}/);
    if (brace) {
      for (const part of brace[1].split(',')) {
        const p = part.trim();
        if (!p) continue;
        const as = p.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
        if (as) names.add(as[1]);
      }
    }
  }
  return names;
}

function locallyDeclared(text, name) {
  const re = new RegExp(
    `(?:(?:async\\s+)?function\\*?\\s+${name}\\b|\\b(?:const|let|var)\\s+${name}\\b|\\bclass\\s+${name}\\b)`,
  );
  return re.test(text);
}

function freeFxHelperIssues(files) {
  const issues = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (!/^src\/renderer\/js\/fx(\/|\.js$)/.test(rel)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    const imported = importedNames(raw);
    const body = stripNoise(raw)
      .split('\n')
      .filter((line) => !/^\s*import\b/.test(line) && !/^\s*export\b/.test(line))
      .join('\n');
    for (const name of FX_MUST_IMPORT) {
      if (imported.has(name) || locallyDeclared(raw, name)) continue;
      if (!new RegExp(`\\b${name}\\b`).test(body)) continue;
      issues.push(`${rel}: free identifier '${name}' (not imported or declared)`);
    }
  }
  return issues;
}

test('every src/ .js file has valid syntax and resolvable relative imports', () => {
  const { files, issues } = auditSrc();
  assert.ok(files.length > 50, `expected many src files, got ${files.length}`);
  assert.deepEqual(issues, [], issues.join('\n'));
});

test('fx split modules do not use shared helpers without importing them', () => {
  const files = walkJs(SRC);
  const issues = freeFxHelperIssues(files);
  assert.deepEqual(issues, [], issues.join('\n'));
});
