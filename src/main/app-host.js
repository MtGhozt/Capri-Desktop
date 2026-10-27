'use strict';

// The real PC behind app-actions.js (Windows): starting programs, the shell for links and
// shortcuts, close-app.ps1 for finding and closing windows, taskkill for forcing. Also what
// her first-run table needs to know: where Steam, Namida and the default browser live.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'close-app.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// lstat, not stat: the Store's app aliases (WindowsApps\Spotify.exe) can't be stat'ed
function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function run(file, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout }, (err, out) => (err ? reject(err) : resolve(String(out || '').trim())));
  });
}

// spec: { names, dir, title } (see close-app.ps1); only what is set is passed on
async function closeScript(mode, spec = {}, skip = []) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Mode', mode, '-WaitMs', '4000'];
  if (spec.names?.length) args.push('-Names', spec.names.join(','));
  if (spec.dir) args.push('-Dir', spec.dir);
  if (spec.title) args.push('-Title', spec.title);
  if (skip.length) args.push('-Skip', skip.join(','));
  const out = await run('powershell.exe', args, 20000);
  const json = JSON.parse(out.split(/\r?\n/).filter(Boolean).pop() || '{}');
  return {
    ids: [].concat(json.ids ?? []).map(Number).filter(Boolean),
    names: [].concat(json.names ?? []).map(String).filter(Boolean),
    left: Number(json.left) || 0,
  };
}

function startDetached(file, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function realDeps({ shell, skipPids }) {
  return {
    exists,
    spawn: startDetached,
    openExternal: (url) => shell.openExternal(url),
    openPath: (file) => shell.openPath(file), // '' when it worked, else the error
    probe: (spec, skip) => closeScript('probe', spec, skip),
    graceful: (spec, skip) => closeScript('graceful', spec, skip),
    explorerWindows: (close) => closeScript(close ? 'explorer' : 'explorer-probe'),
    kill: (ids) => run('taskkill.exe', ['/F', '/T', ...ids.flatMap((id) => ['/PID', String(id)])]).catch(() => ''),
    skipPids,
  };
}

async function regValue(key, value) {
  const args = value ? ['query', key, '/v', value] : ['query', key, '/ve'];
  const out = await run('reg.exe', args, 5000).catch(() => '');
  const m = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(out);
  return m ? m[1].trim() : null;
}

// A shortcut's target (Electron reads .lnk files itself): { target, args } or null.
function readShortcut(shell, file) {
  try {
    const link = shell.readShortcutLink(file);
    return link?.target ? { target: link.target, args: link.args || '' } : null;
  } catch {
    return null;
  }
}

const SHORTCUTS = ['Grok', 'Grok Bot', 'Cursor', 'Warp', 'Notion', 'Epic Games Launcher'];

// What the first-run table needs: { steamExe, namidaExe, browser: { exe } }
async function lookups(shell, env = process.env) {
  const found = {};
  if (process.platform !== 'win32') return found;
  const steam = await regValue('HKCU\\Software\\Valve\\Steam', 'SteamExe');
  if (steam) found.steamExe = path.win32.normalize(steam);
  const menus = [
    path.join(env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  for (const dir of menus) {
    const lnk = [path.join(dir, 'Namida.lnk'), path.join(dir, 'Namida', 'Namida.lnk')].find(exists);
    const target = lnk && readShortcut(shell, lnk)?.target;
    if (target && exists(target)) {
      found.namidaExe = target;
      break;
    }
  }
  if (!found.namidaExe) {
    found.namidaExe = [
      path.join(env.LOCALAPPDATA || '', 'Programs', 'Namida', 'namida.exe'),
      path.join(env.ProgramFiles || 'C:\\Program Files', 'Namida', 'namida.exe'),
    ].find(exists) || null;
  }
  // Start menu shortcuts her seeding knows by name (Cursor.lnk, Warp.lnk…): name -> target
  found.shortcuts = {};
  for (const name of SHORTCUTS) {
    for (const dir of menus) {
      const lnk = [path.join(dir, `${name}.lnk`), path.join(dir, name, `${name}.lnk`)].find(exists);
      const target = lnk && readShortcut(shell, lnk)?.target;
      if (target && /\.exe$/i.test(target) && exists(target)) {
        found.shortcuts[name] = target;
        break;
      }
    }
  }
  const progId = await regValue('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', 'ProgId');
  if (progId && /^[\w .-]+$/.test(progId)) {
    const command = await regValue(`HKCR\\${progId}\\shell\\open\\command`, null);
    if (command) found.browserCommand = command;
  }
  return found;
}

module.exports = { SCRIPT, exists, realDeps, readShortcut, lookups };
