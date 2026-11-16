'use strict';

// How much of the GPU is in use, for the log around game mode (Gemma + OmniVoice off, then
// back on). Returns null when nvidia-smi is not there, which is never fatal.
// computeCap (e.g. "8.9") comes from the same probe when the driver reports it.

const { spawnSync } = require('node:child_process');

function readVram() {
  try {
    const res = spawnSync(
      'nvidia-smi',
      ['--query-gpu=memory.used,memory.total,compute_cap', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 4000, windowsHide: true },
    );
    if (res.status !== 0 || !res.stdout) return null;
    const first = String(res.stdout).trim().split(/\r?\n/)[0];
    const parts = first.split(',').map((n) => n.trim());
    const used = Number(parts[0]);
    const total = Number(parts[1]);
    if (!Number.isFinite(used) || !Number.isFinite(total)) return null;
    const capRaw = parts[2] || '';
    const computeCap = /^\d+\.\d+$/.test(capRaw) ? capRaw : null;
    return { usedMiB: used, totalMiB: total, computeCap };
  } catch {
    return null;
  }
}

function vramText(vram = readVram()) {
  return vram ? `vram used=${vram.usedMiB}MiB total=${vram.totalMiB}MiB` : 'vram unavailable';
}

module.exports = { readVram, vramText };
