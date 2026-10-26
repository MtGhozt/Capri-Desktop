'use strict';

// How much of the GPU is in use, for the log around game mode (Gemma + OmniVoice off, then
// back on). Returns null when nvidia-smi is not there, which is never fatal.

const { spawnSync } = require('node:child_process');

function readVram() {
  try {
    const res = spawnSync(
      'nvidia-smi',
      ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 4000, windowsHide: true },
    );
    if (res.status !== 0 || !res.stdout) return null;
    const first = String(res.stdout).trim().split(/\r?\n/)[0];
    const [used, total] = first.split(',').map((n) => Number(n.trim()));
    if (!Number.isFinite(used) || !Number.isFinite(total)) return null;
    return { usedMiB: used, totalMiB: total };
  } catch {
    return null;
  }
}

function vramText(vram = readVram()) {
  return vram ? `vram used=${vram.usedMiB}MiB total=${vram.totalMiB}MiB` : 'vram unavailable';
}

module.exports = { readVram, vramText };
