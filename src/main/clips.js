'use strict';

// NVIDIA Instant Replay: fires the user's save hotkey (Alt+F10 by default) and opens the
// folder where the clips land.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, shell } = require('electron');
const { parseHotkey } = require('./clip-command');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'hotkey.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function clipsFolder(cfg) {
  const raw = cfg?.clips?.folder;
  if (raw != null && String(raw).trim()) return path.resolve(String(raw).trim());
  // the NVIDIA app saves replays under Videos\NVIDIA by default
  const videos = app.getPath('videos');
  const nvidia = path.join(videos, 'NVIDIA');
  return fs.existsSync(nvidia) ? nvidia : videos;
}

function clipFolderLabel(cfg) {
  return path.basename(clipsFolder(cfg)) || clipsFolder(cfg);
}

function saveClip(hotkey = 'Alt+F10') {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, error: 'Windows only' });
  const combo = parseHotkey(hotkey);
  if (!combo) return Promise.resolve({ ok: false, error: `atajo inválido: ${hotkey}` });
  return new Promise((resolve) => {
    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, '-Key', combo.key,
    ];
    // PowerShell drops an empty-string argument, so only pass -Mods when there is one
    if (combo.mods.length) args.push('-Mods', combo.mods.join(','));
    const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('exit', (code) => {
      const error = err.trim() || (code ? `powershell exit ${code}` : '');
      resolve({ ok: code === 0, error: error || undefined });
    });
  });
}

function openClipsFolder(cfg) {
  const dir = clipsFolder(cfg);
  try {
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return { ok: true, dir };
  } catch (err) {
    return { ok: false, dir, error: err.message };
  }
}

module.exports = { saveClip, openClipsFolder, clipsFolder, clipFolderLabel };
