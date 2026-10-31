'use strict';

// Voice sidecar tests run against voice/.venv. CI has no venv (and we do not install the voice
// stack there), so they skip instead of failing on numpy.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VOICE = path.join(__dirname, '..', 'voice');
const PY = path.join(VOICE, '.venv', 'Scripts', 'python.exe');

function py(code) {
  const result = spawnSync(PY, ['-c', code], { encoding: 'utf8', cwd: VOICE, timeout: 120000 });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `exit ${result.status}`);
  }
  return String(result.stdout || '').trim();
}

// false when the venv can run the sidecar, otherwise the reason to skip the test
function skip() {
  if (!fs.existsSync(PY)) return 'voice/.venv is missing (run voice/setup.ps1)';
  const probe = spawnSync(PY, ['-c', 'import numpy'], { encoding: 'utf8', cwd: VOICE, timeout: 60000 });
  if (probe.status !== 0) {
    const err = String(probe.stderr || probe.stdout || '').trim().split('\n').pop();
    return `voice/.venv python cannot import numpy: ${err}`;
  }
  return false;
}

module.exports = { py, skip, VOICE, PY };
