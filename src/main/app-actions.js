'use strict';

// Opening and closing her apps (Paso 4C). Everything that touches the PC comes in as `deps`,
// so the tests run it with fakes:
//
//   exists(path)            the file is there (lstat: Store aliases can't be stat'ed)
//   spawn(file, args, opts) starts a program, detached; resolves once it started
//   openExternal(url)       a URL or URI through the shell (Steam, Spotify, the browser…)
//   openPath(path)          a shortcut (.lnk) through the shell
//   probe(names, skip)      { ids, left } of the processes called `names`, `skip` pids left out
//   graceful(names, skip)   WM_CLOSE to their windows, then waits ~4 s: { ids, left }
//   kill(ids)               taskkill /F /T on those pids
//   skipPids()              pids never touched: her own, the voice sidecar's
//
// Never closed, whatever the table says: her, Windows' own pieces, the voice sidecar (Python)
// and LM Studio (her model).

const path = require('node:path');
const { expandEnv, splitArgs, linkOk, processName } = require('./apps-config');

const PROTECTED = new Set([
  'capri', 'electron', 'explorer', 'dwm', 'csrss', 'winlogon', 'wininit', 'services', 'lsass', 'lsaiso', 'smss',
  'system', 'idle', 'registry', 'secure system', 'memory compression', 'svchost', 'fontdrvhost', 'sihost',
  'taskhostw', 'ctfmon', 'runtimebroker', 'searchhost', 'searchapp', 'searchindexer', 'startmenuexperiencehost',
  'shellexperiencehost', 'textinputhost', 'applicationframehost', 'lockapp', 'logonui', 'userinit', 'spoolsv',
  'audiodg', 'conhost', 'dllhost', 'wudfhost', 'msmpeng', 'securityhealthservice', 'securityhealthsystray',
  'python', 'pythonw', 'py', 'lms', 'llmster', 'lm studio', 'lmstudio', 'lm-studio',
]);

function isProtected(name) {
  const n = processName(name).toLowerCase();
  return !n || PROTECTED.has(n) || /^lm[\s_-]?studio/.test(n) || /^capri/.test(n);
}

function createAppActions(deps) {
  const env = deps.env || process.env;
  const skip = () => (deps.skipPids?.() || []).filter((p) => Number.isInteger(p) && p > 0);

  // { ok, error }
  async function open(app) {
    try {
      if (app.type === 'steam') {
        if (!/^\d+$/.test(app.target)) return { ok: false, error: 'id de Steam inválido' };
        await deps.openExternal(`steam://rungameid/${app.target}`);
        return { ok: true };
      }
      if (app.type === 'link') {
        if (!linkOk(app.target)) return { ok: false, error: 'enlace inválido' };
        await deps.openExternal(app.target);
        return { ok: true };
      }
      const file = expandEnv(app.target, env);
      if (!deps.exists(file)) return { ok: false, error: 'no existe el archivo' };
      if (/\.lnk$/i.test(file)) {
        const err = await deps.openPath(file);
        return err ? { ok: false, error: String(err) } : { ok: true };
      }
      await deps.spawn(file, splitArgs(expandEnv(app.args || '', env)), { cwd: path.win32.dirname(file) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  // status: 'closed' | 'notRunning' | 'stillRunning' | 'denied' | 'notCloseable' | 'failed'
  async function close(app, mode = app.close) {
    const names = (app.processes || []).map(processName).filter(Boolean);
    if (!names.length) return { status: 'notCloseable' };
    if (names.some(isProtected)) return { status: 'denied' };
    try {
      const found = await deps.probe(names, skip());
      if (!found.ids?.length) return { status: 'notRunning' };
      if (mode === 'force') {
        await deps.kill(found.ids);
        const after = await deps.probe(names, skip());
        return { status: after.ids?.length ? 'stillRunning' : 'closed', mode: 'force', ids: found.ids };
      }
      const after = await deps.graceful(names, skip());
      return { status: after.left > 0 ? 'stillRunning' : 'closed', mode: 'graceful', ids: found.ids };
    } catch (err) {
      return { status: 'failed', error: err?.message || String(err) };
    }
  }

  return { open, close };
}

module.exports = { PROTECTED, isProtected, createAppActions };
