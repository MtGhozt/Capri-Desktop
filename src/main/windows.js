'use strict';

// Feeds the overlay with the position of the other windows (Windows only), so Capri can
// sit on them. A small PowerShell helper does the Win32 calls; we turn its physical pixels
// into the overlay's coordinates.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { screen } = require('electron');
const { toOverlayRect } = require('./rects');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'windows.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function startWindowWatch({ overlay, onUpdate }) {
  if (process.platform !== 'win32') return { stop() {} };

  let child = null;
  let stopped = false;
  let restarts = 0;

  const handle = overlay.getNativeWindowHandle();
  const self = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  const start = () => {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, String(self), String(process.pid),
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let snap;
      try {
        snap = JSON.parse(line);
      } catch {
        return;
      }
      if (overlay.isDestroyed()) return;
      const bounds = overlay.getBounds();
      const dip = (box) => screen.screenToDipRect(null, box);
      const wins = snap.wins
        .map((w) => ({ id: w.id, ...toOverlayRect(w, bounds, dip), max: w.max }))
        // only what overlaps Capri's screen
        .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
      // the bar of her monitor, in her coordinates: where it is, and whether it is up
      const bar = toOverlayRect(snap.bar, bounds, dip);
      onUpdate({
        fg: snap.fg,
        taskbar: Boolean(snap.taskbar),
        start: Boolean(snap.start),
        bar: bar ? { ...bar, shown: Boolean(snap.bar?.shown) } : null,
        wins,
      });
    });
    child.stderr.on('data', (d) => console.error('[capri] window watch:', String(d).trim()));
    child.on('exit', () => {
      child = null;
      if (!stopped && restarts++ < 3) setTimeout(start, 3000);
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
  };
}

function restoreForeground(hwnd) {
  if (process.platform !== 'win32' || !hwnd) return;
  const { spawnSync } = require('node:child_process');
  const script = path.join(__dirname, 'focus.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, String(hwnd),
  ], { windowsHide: true, timeout: 4000 });
}

module.exports = { startWindowWatch, restoreForeground };
