'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BUILTIN = new Set(['alexa', 'hey_mycroft', 'hey_jarvis', 'hey_rhasspy', 'timer', 'weather']);

/** Same resolution as voice/server.py resolve_wake_model → spoken phrase for the menu hint. */
function resolveWakeModel(wakeModel, modelsDir) {
  const raw = String(wakeModel || 'hey_capri').trim();
  const models = modelsDir || '';
  const looksLikePath = /\.onnx$/i.test(raw) || raw.includes('/') || raw.includes('\\');
  if (looksLikePath) {
    const file = path.isAbsolute(raw) ? raw : path.join(models, raw);
    return fs.existsSync(file) ? file : 'hey_jarvis';
  }
  if (BUILTIN.has(raw.toLowerCase())) return raw.toLowerCase();
  const custom = path.join(models, `${raw}.onnx`);
  return fs.existsSync(custom) ? custom : 'hey_jarvis';
}

function wakePhraseLabel(wakeModel, modelsDir) {
  const resolved = resolveWakeModel(wakeModel, modelsDir);
  const base = path.basename(String(resolved), '.onnx').toLowerCase();
  if (base.includes('hey_capri') || base === 'hey_capri') return 'hey Capri';
  if (base.includes('hey_jarvis') || base === 'hey_jarvis') return 'hey Jarvis';
  const m = /^hey[_-]?(\w+)$/i.exec(base);
  if (m) return `hey ${m[1].charAt(0).toUpperCase()}${m[1].slice(1)}`;
  return 'hey Jarvis';
}

module.exports = { resolveWakeModel, wakePhraseLabel };
