'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  scale: 0.6,        // sprite scale, 0.6 ≈ 250px tall
  muted: false,
  volume: 0.7,
  lang: 'auto',      // 'auto' follows the system language, or 'fr' / 'en'
  displayId: null,   // null = primary display
  wander: true,      // random teleports when idle
  possess: true,     // now and then she dives into the window she sits on and takes it over
  visible: true,
  welcomed: false,   // she has introduced herself (her welcome panel)
  linked: false,     // a Claude Code event has reached her at least once
  llm: {
    baseUrl: 'http://localhost:1235/v1',
    model: 'google/gemma-4-e2b',
    autoStart: true,
    lmsPath: null,           // null → %USERPROFILE%\.lmstudio\bin\lms.exe
    contextLength: 8192,
    gpu: 'max',
    bootTimeoutMs: 120000,
  },
  guide: {
    welcome: false,          // Claude Code "plug me in" onboarding
  },
};

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  if (cache) return cache;
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = {
      ...DEFAULTS,
      ...saved,
      llm: { ...DEFAULTS.llm, ...(saved.llm || {}) },
      guide: { ...DEFAULTS.guide, ...(saved.guide || {}) },
    };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  const current = load();
  cache = {
    ...current,
    ...patch,
    llm: { ...DEFAULTS.llm, ...(current.llm || {}), ...(patch.llm || {}) },
    guide: { ...DEFAULTS.guide, ...(current.guide || {}), ...(patch.guide || {}) },
  };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('[capri] could not save config:', err.message);
  }
  return cache;
}

module.exports = { load, save, DEFAULTS };
