'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  scale: 0.6,        // sprite scale, 0.6 ≈ 250px tall
  muted: false,
  volume: 0.7,
  lang: 'es',        // overlay + Capri's spoken replies; 'auto' follows the system language
  displayId: null,   // null = primary display
  wander: true,      // random teleports when idle
  possess: true,     // now and then she dives into the window she sits on and takes it over
  rest: 'taskbar',   // where she rests: 'taskbar' (standing on its top edge, riding it up and down) or 'corner'
  visible: true,
  welcomed: false,   // she has introduced herself (her welcome panel)
  linked: false,     // a Claude Code event has reached her at least once
  render: 'auto',    // her window: 'auto', 'gl' (OpenGL) or 'software' (no graphics card), for black screens
  llm: {
    provider: 'local',       // 'local' (LM Studio) or a cloud one: see chat-providers.js
    model: 'google/gemma-4-e2b', // the model of the provider in use
    localModel: 'google/gemma-4-e2b', // LM Studio's, kept apart so going to the cloud and back doesn't lose it
    models: {},
    shareScreen: false,      // send what is open on screen (cloud only): off by default
    shareMemory: false,      // send her memory of the conversation (cloud only): off by default
    baseUrl: 'http://localhost:1235/v1',
    autoStart: true,
    lmsPath: null,           // null → %USERPROFILE%\.lmstudio\bin\lms.exe
    contextLength: 8192,
    gpu: 'max',
    bootTimeoutMs: 120000,
  },
  guide: {
    welcome: false,          // Claude Code "plug me in" onboarding
    setupHint: false,        // first-run: opened Modelo y clave because nothing could answer yet
  },
  idle: {
    dormantAfterMs: 5 * 60 * 1000, // 0 = never fold into the DORMANT widget
    widget: { x: null, y: null },
  },
  fx: {
    glitch: true,
    intro: true,           // boot grab-the-screen intro; false skips to materialize
    apps: true,            // her zap / spark when she closes / opens an app (Paso 4E)
    scanlines: true,       // scanlines + RGB split on the message box
  },
  ui: {
    theme: 'cyberpunk',    // overlay menu palette: 'cyberpunk' | 'capri'
    logLines: 4,           // colour log under the message, last N kept
  },
  position: {
    locked: false,         // menu: NORMAL / FIJO; when locked she stays at x,y
    x: null,
    y: null,
    edge: false,           // locked while standing on the bottom edge: she still rides the taskbar
    homeX: null,           // where she rests on the taskbar, a fraction of the screen width (where you last dropped her)
  },
  shortcuts: {
    toggle: 'Ctrl+Alt+C',  // put her away / bring her back
    chat: 'Ctrl+Alt+T',    // open the chat bubble
    talk: 'Ctrl+Alt+V',    // push to talk
    menuClose: 'Ctrl+Alt+M', // her menu closed whatever state it's in, the clicks given back
  },
  clips: {
    saveHotkey: 'Alt+F10', // NVIDIA Instant Replay
    folder: null,          // null → NVIDIA's Videos\NVIDIA if it exists, otherwise Videos
  },
  gaming: {
    mode: 'auto',            // 'auto' unloads the GPU while a fullscreen game runs; 'off' never
    drone: true,             // show the lightweight renderer while a game owns the screen
    apps: [],                // extra exe names or path fragments to treat as games
  },
  greeting: {
    last: null,              // id of the hello from last boot, never repeated
  },
  comments: {
    enabled: true,           // her own lines: every so often, and when the context changes
    minMinutes: 20,          // shortest wait between two lines
    maxMinutes: 40,          // longest wait between two lines
  },
  behavior: {
    greetings: true,
    unlockGreeting: true,
    caresses: true,
    musicDance: true,
  },
  hearing: {
    fixes: [],               // what she hears wrong, read as what you meant: [{ heard, meant }] (see fixes.js)
    followUpSec: 8,          // her answer ends with a question: listen this long without the wake word (0 = off)
    talkHotkey: null,        // push to talk from her menu; null → shortcuts.talk (Ctrl+Alt+V)
  },
  music: {
    player: 'namida', // 'namida' | 'spotify' | 'none'
    herSong: "I'm in love with myself", // "pon tu canción" / "play your song"
    spotify: { clientId: '' },
  },
  apps: {
    list: [],                // what "abre X" / "cierra X" reach (see apps-config.js); edited in her menu, APPS
    seeded: 0,               // how far her first-run seeding got (SEED_VERSION in apps-config.js)
  },
  voice: {
    enabled: true,
    dir: null,               // null → repo voice/ in dev; set an absolute path for the installed exe
    pushToTalk: 'Ctrl+Alt+V',
    wakeWord: true,
    wakeThreshold: 0.2,
    wakeModel: 'hey_capri',  // voice/models/hey_capri.onnx if it exists; otherwise hey_jarvis (see docs/wake-word.md)
    sttModel: 'auto',
    language: 'es',
    inputDevice: null,
    debugSave: false,
    tts: 'off',              // public default: no spoken TTS (code path kept; enable locally if you have voice/)
    ttsRef: null,            // optional local clone path; never bundled in the public build
    ttsSpeed: 1.0,
    ttsSteps: 16,            // OmniVoice diffusion steps (8–32) when TTS is enabled locally
    replyMode: 'blips',      // 'voice' | 'blips' | 'silent' — public default: typing beeps only
    ttsIdleUnloadMin: 10,    // DORMANT this long → release OmniVoice (0 = never)
    sttIdleUnloadMin: 10,    // mic muted this long → release Whisper (0 = never)
  },
};

let cache = null;

// Pre-4L defaults written into many configs even when the user never opened the voice menu.
// Migrate that baked-in pair to blips/off once. Leave alone if they pointed at a clone
// (ttsRef / voice.dir) or already picked another reply mode.
function migratePublicReply(voice) {
  const v = { ...(voice || {}) };
  if (v.publicReplyMigrated) return { voice: v, changed: false };
  const mode = String(v.replyMode ?? 'voice').toLowerCase();
  const tts = String(v.tts ?? 'auto').toLowerCase();
  const hasClone = Boolean(v.ttsRef)
    || (typeof v.dir === 'string' && v.dir.trim().length > 0);
  const looksLikeOldDefault = mode === 'voice'
    && (tts === 'auto' || tts === 'on' || tts === 'true')
    && !hasClone;
  if (looksLikeOldDefault) {
    v.replyMode = 'blips';
    v.tts = 'off';
  }
  v.publicReplyMigrated = true;
  return { voice: v, changed: true };
}

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function persist() {
  if (!cache) return;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('[capri] could not save config:', err.message);
  }
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
      idle: {
        ...DEFAULTS.idle,
        ...(saved.idle || {}),
        widget: { ...DEFAULTS.idle.widget, ...((saved.idle && saved.idle.widget) || {}) },
      },
      fx: { ...DEFAULTS.fx, ...(saved.fx || {}) },
      ui: { ...DEFAULTS.ui, ...(saved.ui || {}) },
      gaming: { ...DEFAULTS.gaming, ...(saved.gaming || {}) },
      greeting: { ...DEFAULTS.greeting, ...(saved.greeting || {}) },
      comments: { ...DEFAULTS.comments, ...(saved.comments || {}) },
      behavior: (() => {
        const behavior = { ...DEFAULTS.behavior, ...(saved.behavior || {}) };
        delete behavior.compact; // removed feature: ignore legacy config.json
        return behavior;
      })(),
      hearing: { ...DEFAULTS.hearing, ...(saved.hearing || {}) },
      music: {
        ...DEFAULTS.music,
        ...(saved.music || {}),
        spotify: { ...DEFAULTS.music.spotify, ...((saved.music && saved.music.spotify) || {}) },
      },
      apps: { ...DEFAULTS.apps, ...(saved.apps || {}) },
      voice: { ...DEFAULTS.voice, ...(saved.voice || {}) },
      position: { ...DEFAULTS.position, ...(saved.position || {}) },
      shortcuts: { ...DEFAULTS.shortcuts, ...(saved.shortcuts || {}) },
      clips: { ...DEFAULTS.clips, ...(saved.clips || {}) },
    };
  } catch {
    cache = { ...DEFAULTS };
  }
  let dirty = false;
  // Older installs defaulted to English; Capri now speaks Spanish.
  if (cache.lang === 'en') {
    cache.lang = 'es';
    dirty = true;
  }
  // The local model used to live in llm.model alone: keep hers when moving to a provider.
  if (!cache.llm.localModel) {
    cache.llm.localModel = cache.llm.model;
    dirty = true;
  }
  const reply = migratePublicReply(cache.voice);
  cache.voice = reply.voice;
  if (reply.changed) dirty = true;
  if (dirty) persist();
  return cache;
}

function save(patch) {
  const current = load();
  cache = {
    ...current,
    ...patch,
    llm: { ...DEFAULTS.llm, ...(current.llm || {}), ...(patch.llm || {}) },
    guide: { ...DEFAULTS.guide, ...(current.guide || {}), ...(patch.guide || {}) },
    idle: {
      ...DEFAULTS.idle,
      ...(current.idle || {}),
      ...(patch.idle || {}),
      widget: {
        ...DEFAULTS.idle.widget,
        ...(current.idle && current.idle.widget),
        ...(patch.idle && patch.idle.widget),
      },
    },
    fx: { ...DEFAULTS.fx, ...(current.fx || {}), ...(patch.fx || {}) },
    ui: { ...DEFAULTS.ui, ...(current.ui || {}), ...(patch.ui || {}) },
    gaming: { ...DEFAULTS.gaming, ...(current.gaming || {}), ...(patch.gaming || {}) },
    greeting: { ...DEFAULTS.greeting, ...(current.greeting || {}), ...(patch.greeting || {}) },
    comments: { ...DEFAULTS.comments, ...(current.comments || {}), ...(patch.comments || {}) },
    behavior: (() => {
      const behavior = { ...DEFAULTS.behavior, ...(current.behavior || {}), ...(patch.behavior || {}) };
      delete behavior.compact;
      return behavior;
    })(),
    hearing: { ...DEFAULTS.hearing, ...(current.hearing || {}), ...(patch.hearing || {}) },
    music: {
      ...DEFAULTS.music,
      ...(current.music || {}),
      ...(patch.music || {}),
      spotify: {
        ...DEFAULTS.music.spotify,
        ...(current.music && current.music.spotify),
        ...(patch.music && patch.music.spotify),
      },
    },
    apps: { ...DEFAULTS.apps, ...(current.apps || {}), ...(patch.apps || {}) },
    voice: { ...DEFAULTS.voice, ...(current.voice || {}), ...(patch.voice || {}) },
    position: { ...DEFAULTS.position, ...(current.position || {}), ...(patch.position || {}) },
    shortcuts: { ...DEFAULTS.shortcuts, ...(current.shortcuts || {}), ...(patch.shortcuts || {}) },
    clips: { ...DEFAULTS.clips, ...(current.clips || {}), ...(patch.clips || {}) },
  };
  persist();
  return cache;
}

module.exports = { load, save, filePath: file, DEFAULTS, migratePublicReply };
