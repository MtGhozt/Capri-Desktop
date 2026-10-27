'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage, powerMonitor,
} = require('electron');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch, restoreForeground } = require('./windows');
const { createLlm } = require('./llm');
const { createLms } = require('./lms');
const { createVoice } = require('./voice');
const { createSpeakQueue } = require('./speak');
const { isSleepCommand } = require('./sleep-command');
const { isClipCommand } = require('./clip-command');
const { isMuteCommand, isUnmuteCommand } = require('./mic-command');
const { isForgetCommand } = require('./forget-command');
const { isWakeCommand } = require('./wake-command');
const { pickLine, fillLine } = require('./lines-es');
const { addFix, removeFix, cleanFixes } = require('./fixes');
const { parseFixCommand, readTranscript } = require('./fix-command');
const { GREETINGS, pickGreeting } = require('./greetings');
const { windowContext } = require('./context');
const { createComments } = require('./comments');
const { createGameMode } = require('./game-mode');
const { vramText } = require('./vram');
const { logEvent, voiceLogPath } = require('./log');
const { saveClip, openClipsFolder, clipFolderLabel } = require('./clips');
const { micActive } = require('./voice-config');
const hooks = require('../../scripts/install-hooks');
const demoSteps = require('../../scripts/demo-sequence');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.CAPRI_PORT) || 47823;
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const CLAUDE_CODE_HELP = 'https://code.claude.com/docs/en/quickstart';
// the word in the corner of the panel when she talks to the room
const COMMENT_BADGE = { comentar: 'CAPRI', musica: 'MUSIC', juego: 'GAME', video: 'VIDEO', programando: 'CODE' };

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let overlay = null;
let tray = null;
let trayMenu = null; // also what she opens when you right-click her
let demoTimer = null;
let windowWatch = null;
// the watcher only speaks when something changes: the overlay asks for this when it (re)loads
let lastWindows = null;
let llm = null;
let lms = null;
let voice = null;
let speakQueue = null;
let comments = null;
let ttsLoading = false;
let voiceTalking = false;
let llmBusy = false;
let voiceQueue = [];
let chatOpen = false;
let pendingSleep = false;
let sleepTimer = null;
let previousForeground = null;
let menuKeyboard = false; // her menu has a text field open (Corregir lo último): it needs the keyboard
let lastHeard = '';       // the last thing Whisper wrote, before her fixes (Corregir lo último)
let gameMode = null;
let gameWork = Promise.resolve();
let gameWasFolded = false;
let gameHadLlm = false;
let gameHadVoice = false;

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

// capri://app/...        -> files of this repo
// capri://usersounds/... -> the user's own sound overrides
function serveProtocol() {
  protocol.handle('capri', (request) => {
    const url = new URL(request.url);
    const base = url.host === 'usersounds' ? userSoundsDir() : ROOT;
    const target = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function targetDisplay() {
  const { displayId } = config.load();
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

// Her window: the work area, or the whole screen while she rests on the taskbar (she stands on its
// top edge, or on the bottom of the screen while auto-hide keeps it down), less its top row of pixels: a window on top covering the whole screen is a fullscreen
// app to Windows (animated wallpapers pause, notifications wait). `gap`: how much of her window is
// below the top of the taskbar (0, or its height).
function overlayArea() {
  const { workArea, bounds } = targetDisplay();
  const area = config.load().rest === 'taskbar'
    ? { ...bounds, y: bounds.y + 1, height: bounds.height - 1 }
    : workArea;
  return { area, gap: area.y + area.height - (workArea.y + workArea.height) };
}

function fitOverlay() {
  if (!overlay) return;
  const { area, gap } = overlayArea();
  overlay.setBounds(area);
  overlay.webContents.send('overlay:resize', { width: area.width, height: area.height, gap });
}

// The pointer reaches her click-through window through a mouse hook, and Windows drops a hook that
// doesn't answer in time without a word (waking from sleep, a locked screen, a stall): she can't be
// clicked anymore. Off then on puts in a new one; her place on top and her size are set again too.
function rearmOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setIgnoreMouseEvents(false);
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  fitOverlay();
  sendCommand('rearmed'); // click-through again: she waits for the pointer to be on her
  console.log('[capri] mouse hook set up again');
}

// Back on top of everything, the taskbar included (it comes up over her when it's clicked). Twice:
// the taskbar can come up again a moment later, as its menus and previews open.
function raiseOverlay() {
  for (const wait of [0, 400]) {
    setTimeout(() => {
      if (!overlay || overlay.isDestroyed()) return;
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.moveTop();
    }, wait);
  }
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...overlayArea().area,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadURL('capri://app/src/renderer/index.html');
  // always shown: put away, she's still there as her biochip in the corner. Sized again first:
  // Windows keeps a new window inside the work area, and resting on the taskbar it covers it too.
  overlay.once('ready-to-show', () => {
    fitOverlay();
    overlay.showInactive();
    for (const payload of voiceQueue) overlay.webContents.send('voice:event', payload);
    voiceQueue = [];
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
  });
  if (DEV) {
    overlay.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`);
    });
    if (process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

function sendCommand(name, payload = {}) {
  overlay?.webContents.send('capri:command', { name, ...payload });
}

function overlayHwnd() {
  if (!overlay) return null;
  const handle = overlay.getNativeWindowHandle();
  return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
}

function captureForeground() {
  const self = overlayHwnd();
  const fg = lastWindows?.fg;
  if (fg != null && self != null && String(fg) !== String(self)) return fg;
  return previousForeground;
}

function openChat() {
  if (!overlay) return;
  if (!chatOpen) previousForeground = captureForeground();
  chatOpen = true;
  overlay.setFocusable(true);
  overlay.show();
  overlay.focus();
  sendCommand('chat', { on: true });
}

function closeChat() {
  const wasOpen = chatOpen;
  chatOpen = false;
  llm?.cancel();
  if (wasOpen) sendCommand('chat', { on: false });
  const target = previousForeground;
  previousForeground = null;
  // Restore first while we still own focus, then drop keyboard on the overlay.
  if (target != null) restoreForeground(target);
  overlay?.setFocusable(false);
  overlay?.showInactive();
}

// Her menu's text fields (Corregir lo último): the keyboard while they're open, given back after.
function menuKeyboardOn(on) {
  if (!overlay) return;
  if (on) {
    if (!menuKeyboard && !chatOpen) previousForeground = captureForeground();
    menuKeyboard = true;
    overlay.setFocusable(true);
    overlay.show();
    overlay.focus();
    return;
  }
  if (!menuKeyboard) return;
  menuKeyboard = false;
  if (chatOpen) return; // the chat still has it
  const target = previousForeground;
  previousForeground = null;
  if (target != null) restoreForeground(target);
  overlay.setFocusable(false);
  overlay.showInactive();
}

function toggleChat() {
  if (chatOpen) closeChat();
  else openChat();
}

function toggleVisible(force) {
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  if (!visible && chatOpen) closeChat();
  config.save({ visible });
  sendCommand('stow', { on: !visible });
  rebuildTray();
}

function playDemo() {
  clearTimeout(demoTimer);
  let i = 0;
  const next = () => {
    if (i >= demoSteps.length) return;
    const [delay, evt] = demoSteps[i++];
    demoTimer = setTimeout(() => {
      overlay?.webContents.send('claude:event', evt);
      next();
    }, delay);
  };
  next();
}

// During the demo, a little fake terminal for her to sit on and take over (window tracking is
// Windows only, so only there). Opened without stealing focus; closing it drops her off it.
let demoWin = null;
const DEMO_TERMINAL = `<body style="margin:0;background:#14101c;color:#8f8aa3;font:13px/1.7 Consolas,monospace;padding:14px 18px">
<div style="color:#36ff7a">PS C:\\night-city-api&gt; npm test -- gigs</div>
<div>&nbsp;&nbsp;GET /gigs</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ returns 20 items per page</div>
<div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ paginates with a cursor</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ rejects a bad cursor</div>
<div>&nbsp;&nbsp;6 passing (212ms)</div><div style="color:#36ff7a">PS C:\\night-city-api&gt; _</div></body>`;

function demoWindow(open) {
  demoWin?.destroy();
  demoWin = null;
  if (!open || process.platform !== 'win32') return false;
  const b = overlay.getBounds();
  demoWin = new BrowserWindow({
    x: Math.round(b.x + b.width * 0.5 - 310), y: Math.round(b.y + b.height * 0.42), width: 620, height: 300,
    show: false, alwaysOnTop: true, title: 'night-city-api — npm test', backgroundColor: '#14101c', autoHideMenuBar: true,
  });
  demoWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEMO_TERMINAL)}`);
  demoWin.once('ready-to-show', () => demoWin?.showInactive());
  demoWin.on('closed', () => { demoWin = null; });
  return true;
}

// 'auto' -> the first system language Capri speaks, English otherwise.
function resolveLang(setting) {
  if (LANGS.includes(setting)) return setting;
  const preferred = [...app.getPreferredSystemLanguages(), app.getSystemLocale(), app.getLocale()];
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

// What the overlay gets: `lang` is the resolved one, `langSetting` what the user picked.
function rendererConfig() {
  const cfg = config.load();
  const idle = { ...cfg.idle };
  // --dev only: 10 s idle for testing. Never written to config.json.
  if (DEV) idle.dormantAfterMs = 10_000;
  return { ...cfg, idle, lang: resolveLang(cfg.lang), langSetting: cfg.lang, dev: DEV, floorGap: overlayArea().gap };
}

function requestSleep() {
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
  pendingSleep = false;
  sendCommand('sleep');
}

function speakLine(line) {
  const speakId = ttsOn() ? speakQueue?.start() : 0;
  if (!speakId) return;
  speakQueue.feed(line);
  speakQueue.flush(speakId);
}

// One of her direct-command lines (lines-es.js), said and shown where the command came from:
// her chat bubble, or the panel when it came from her menu or the tray.
function announce(line, { chat = false, badge = 'CAPRI' } = {}) {
  speakLine(line);
  if (chat) {
    overlay?.webContents.send('chat:token', line);
    overlay?.webContents.send('chat:done', { text: line });
  } else {
    sendCommand('line', { badge, text: line });
  }
  return line;
}

function commandReply(kind, opts) {
  return announce(pickLine(kind), opts);
}

function goSleepReply({ chat = true } = {}) {
  commandReply('dormir', { chat, badge: 'SLEEP' });
  pendingSleep = true;
  sleepTimer = setTimeout(requestSleep, 2200);
  return { ok: true };
}

function goWakeReply({ chat = true } = {}) {
  commandReply('despertar', { chat, badge: 'WAKE' });
  sendCommand('wake');
  return { ok: true };
}

function goForgetReply({ chat = true } = {}) {
  llm.reset();
  commandReply('olvidar', { chat, badge: 'MEM' });
  return { ok: true };
}

function goMicReply(on, { chat = true } = {}) {
  updateConfig({ voice: { enabled: Boolean(on) } });
  commandReply(on ? 'unmute' : 'mute', { chat, badge: 'MIC' });
  return { ok: true };
}

function clipFailLine(error) {
  return `No pude disparar el atajo del clip. Revisá NVIDIA o el atajo en config.${error ? ` (${error})` : ''}`;
}

// -- what she hears wrong (Paso 4A) --------------------------------------------------------

const hearingFixes = () => cleanFixes(config.load().hearing?.fixes);

// A transcript from the sidecar, read with her fixes. An order about the fixes themselves is left
// as said: "cuando digo jarbis quiero decir Jarvis" must still say jarbis.
function hearTranscript(payload) {
  const said = String(payload?.text || '');
  const read = readTranscript(said, hearingFixes());
  if (!read.order && said.trim()) lastHeard = said.trim();
  if (!read.heard) return payload;
  logEvent(voiceLogPath(), `[capri] heard fix: ${JSON.stringify(said)} -> ${JSON.stringify(read.text)}`);
  return { ...payload, text: read.text, heard: read.heard };
}

function saveFix(heard, meant) {
  const result = addFix(hearingFixes(), heard, meant);
  if (result.fix) config.save({ hearing: { fixes: result.fixes } });
  return result;
}

function dropFix(heard) {
  const result = removeFix(hearingFixes(), heard);
  if (result.removed) config.save({ hearing: { fixes: result.fixes } });
  return result;
}

function goFixReply(order, { chat = true } = {}) {
  const opts = { chat, badge: 'OÍDO' };
  if (order.action === 'remove') {
    const { removed } = dropFix(order.heard);
    const heard = removed?.heard || order.heard;
    return { ok: Boolean(removed), line: announce(fillLine(pickLine(removed ? 'olvidarCorreccion' : 'sinCorreccion'), { heard }), opts) };
  }
  const { fix, updated } = saveFix(order.heard, order.meant);
  if (!fix) return { ok: false };
  return { ok: true, line: announce(fillLine(pickLine(updated ? 'corregirOtraVez' : 'corregir'), fix), opts) };
}

async function goClipReply({ chat = true } = {}) {
  const cfg = config.load();
  const result = await saveClip(cfg.clips?.saveHotkey || 'Alt+F10');
  if (result.ok) commandReply('clip', { chat, badge: 'CLIP' });
  else announce(clipFailLine(result.error), { chat, badge: 'CLIP' });
  return { ok: result.ok };
}

// -- game mode ---------------------------------------------------------------------------
// A fullscreen game gets the whole GPU: the voice sidecar (OmniVoice) and Gemma go, she folds
// into DORMANT and stays quiet, and both come back 30 s after the game is really gone.

const gameLog = (text) => logEvent(voiceLogPath(), `[capri] ${text}`);

// One step at a time: unloading takes seconds, and a game can come and go meanwhile.
function queueGame(step) {
  gameWork = gameWork.then(step).catch((err) => gameLog(`game mode: ${err.message}`));
  return gameWork;
}

async function gameEnter(windows) {
  gameWasFolded = overlayFolded;
  gameHadVoice = Boolean(voice?.running?.());
  gameLog(`game on exe=${windows?.fgExe || '?'} ${vramText()}`);
  llm?.cancel();
  speakQueue?.stop();
  sendCommand('sleep'); // DORMANT, and the chat bubble goes with it
  if (lms?.status() === 'booting') await lms.whenReady(); // a load in flight would land anyway
  gameHadLlm = lms?.status() === 'ready';
  voice?.stop(); // the sidecar holds OmniVoice: stopping it hands the VRAM back
  await lms?.unloadAll?.();
  gameLog(`game on after unload ${vramText()}`);
}

async function gameLeave() {
  gameLog(`game off ${vramText()}`);
  if (!gameWasFolded) sendCommand('wake');
  if (gameHadVoice) voice?.start({ force: true });
  if (gameHadLlm) await lms?.reload?.();
  gameLog(`game off after reload ${vramText()}`);
  gameWasFolded = false;
  gameHadLlm = false;
  gameHadVoice = false;
}

function ttsOn() {
  return voiceReplyOn() && !ttsLoading; // while OmniVoice boots the bubble answers with blips
}

// Same as ttsOn() without the loading check: a cached greeting is a wav, no engine needed.
function voiceReplyOn() {
  const cfg = config.load();
  if (cfg.muted) return false;
  if (String(cfg.voice?.replyMode || 'voice').toLowerCase() !== 'voice') return false;
  const kind = String(cfg.voice?.tts || 'auto').toLowerCase();
  return kind !== 'off' && kind !== 'none' && kind !== 'false';
}

function commentRange(value, fallbackMinutes) {
  const minutes = Number(value);
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : fallbackMinutes;
  return safe * 60_000;
}

function updateConfig(patch) {
  config.save(patch);
  if ('rest' in patch) fitOverlay(); // the taskbar in her window or not
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);
  voice?.applyConfig();
  if ('comments' in patch) comments?.refresh();
  rebuildTray();
  return cfg;
}

function applyMenuAction(id, value) {
  switch (id) {
    case 'teleport': sendCommand('teleport'); break;
    case 'satellite': sendCommand('satellite'); break;
    case 'demo': playDemo(); break;
    case 'help': sendCommand('welcome'); break;
    case 'visible': toggleVisible(); break;
    case 'sleep': goSleepReply({ chat: false }); break;
    case 'wake': goWakeReply({ chat: false }); break;
    case 'scale': updateConfig({ scale: Number(value) }); break;
    case 'muted': updateConfig({ muted: Boolean(value) }); break;
    case 'reply-mode': updateConfig({ voice: { replyMode: String(value || 'voice') } }); break;
    case 'sounds-dir':
      fs.mkdirSync(userSoundsDir(), { recursive: true });
      shell.openPath(userSoundsDir());
      break;
    case 'display':
      config.save({ displayId: value });
      fitOverlay();
      rebuildTray();
      break;
    case 'wander': updateConfig({ wander: Boolean(value) }); break;
    case 'possess': updateConfig({ possess: Boolean(value) }); break;
    case 'mic': goMicReply(Boolean(value), { chat: false }); break;
    case 'mic-device': updateConfig({ voice: { inputDevice: value } }); break;
    case 'forget': goForgetReply({ chat: false }); break;
    case 'gaming-mode': updateConfig({ gaming: { mode: value === 'off' ? 'off' : 'auto' } }); break;
    case 'comments': updateConfig({ comments: { enabled: Boolean(value) } }); break;
    case 'persona-reload': {
      const r = llm.reloadPersona();
      sendCommand('line', {
        badge: 'MEM',
        text: r.ok ? 'Personalidad recargada. Soy más yo que antes.' : 'No pude releer persona.md.',
      });
      break;
    }
    case 'clip-save': goClipReply({ chat: false }); break;
    case 'fix-add': saveFix(value?.heard, value?.meant); break;
    case 'fix-remove': dropFix(value); break;
    case 'menu-keyboard': menuKeyboardOn(Boolean(value)); break;
    case 'clips-dir': openClipsFolder(config.load()); break;
    case 'drag-lock':
      config.save({ position: { locked: Boolean(value) } });
      sendCommand('lock-position', { on: Boolean(value) });
      break;
    case 'theme':
      updateConfig({ ui: { theme: value === 'capri' ? 'capri' : 'cyberpunk' } });
      break;
    case 'shortcuts-file':
      config.load();
      if (!fs.existsSync(config.filePath())) config.save({});
      shell.openPath(config.filePath());
      break;
    case 'lang': updateConfig({ lang: value }); break;
    case 'startup':
      app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: Boolean(value) });
      rebuildTray();
      break;
    case 'hooks-install': runHooks('install'); break;
    case 'hooks-remove': runHooks('uninstall'); break;
    case 'quit': app.quit(); break;
    default: break;
  }
}

let overlayFolded = false;
let registeredShortcuts = [];

// The combos shown in her menu; edit shortcuts.* in config.json and restart to change them.
function registerShortcuts() {
  for (const accel of registeredShortcuts) {
    try { globalShortcut.unregister(accel); } catch { /* already gone */ }
  }
  registeredShortcuts = [];
  const bind = (accel, run) => {
    const combo = String(accel || '').trim();
    if (!combo) return;
    try {
      if (globalShortcut.register(combo, run)) registeredShortcuts.push(combo);
      else console.error(`[capri] shortcut already taken: ${combo}`);
    } catch (err) {
      console.error(`[capri] bad shortcut "${combo}": ${err.message}`);
    }
  };
  const s = config.load().shortcuts || {};
  bind(s.toggle, () => toggleVisible());
  bind(s.chat, () => toggleChat());
  bind(s.talk, () => {
    llm?.cancel();
    speakQueue?.stop();
    voice?.pttStart();
  });
}

function menuState(extra = {}) {
  const cfg = config.load();
  const lang = resolveLang(cfg.lang);
  const t = TRAY[lang];
  const displays = screen.getAllDisplays();
  const current = targetDisplay().id;
  const labels = {};
  for (const [key, value] of Object.entries(t)) {
    if (typeof value !== 'function') labels[key] = value;
  }
  return {
    labels,
    langs: [['auto', t.auto], ...LANGS.map((code) => [code, TRAY[code].name])],
    lang,
    langSetting: cfg.lang,
    folded: Boolean(extra.folded ?? overlayFolded),
    cfg: {
      visible: cfg.visible,
      scale: cfg.scale,
      muted: cfg.muted,
      wander: cfg.wander,
      possess: cfg.possess,
      mic: micActive(cfg),
      micDevice: cfg.voice?.inputDevice ?? null,
      replyMode: String(cfg.voice?.replyMode || 'voice'),
      locked: Boolean(cfg.position?.locked),
      theme: cfg.ui?.theme === 'capri' ? 'capri' : 'cyberpunk',
      gaming: cfg.gaming?.mode === 'off' ? 'off' : 'auto',
      comments: cfg.comments?.enabled !== false,
    },
    hearing: {
      fixes: cleanFixes(cfg.hearing?.fixes),
      lastHeard,
    },
    clips: {
      hotkey: cfg.clips?.saveHotkey || 'Alt+F10',
      folder: clipFolderLabel(cfg),
    },
    shortcuts: [
      { label: 'Mostrar / ocultar Capri', accel: cfg.shortcuts?.toggle || '' },
      { label: 'Abrir el chat', accel: cfg.shortcuts?.chat || '' },
      { label: 'Hablar (push to talk)', accel: cfg.shortcuts?.talk || '' },
    ],
    micDevices: voice?.devices() || [],
    displays: displays.map((d, i) => ({
      id: d.id,
      label: `${i + 1} — ${d.size.width}×${d.size.height}`,
      current: d.id === current,
    })),
    login: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
    online: t.online(PORT),
  };
}

function rebuildTray() {
  if (!tray) return;
  const s = menuState();
  const t = s.labels;

  const menu = Menu.buildFromTemplate([
    { label: s.online, enabled: false },
    { type: 'separator' },
    { label: t.teleport, click: () => applyMenuAction('teleport') },
    ...(!s.folded ? [
      { label: t.satellite, click: () => applyMenuAction('satellite') },
      { label: t.demo, click: () => applyMenuAction('demo') },
    ] : []),
    { label: t.help, click: () => applyMenuAction('help') },
    ...(!s.folded ? [{ label: s.cfg.visible ? t.hide : t.show, accelerator: 'Ctrl+Alt+C', click: () => applyMenuAction('visible') }] : []),
    s.folded
      ? { label: t.wake, click: () => applyMenuAction('wake') }
      : { label: t.sleep, click: () => applyMenuAction('sleep') },
    { type: 'separator' },
    {
      label: t.size,
      submenu: [[t.small, 0.45], [t.medium, 0.6], [t.large, 0.8]].map(([label, scale]) => ({
        label, type: 'radio', checked: Math.abs(s.cfg.scale - scale) < 0.01, click: () => applyMenuAction('scale', scale),
      })),
    },
    {
      label: t.sound,
      submenu: [
        { label: t.mute, type: 'checkbox', checked: s.cfg.muted, click: (item) => applyMenuAction('muted', item.checked) },
        { type: 'separator' },
        { label: t.reply, enabled: false },
        ...[['voice', t.replyVoice], ['blips', t.replyBlips], ['silent', t.replySilent]].map(([mode, label]) => ({
          label, type: 'radio', checked: s.cfg.replyMode === mode, click: () => applyMenuAction('reply-mode', mode),
        })),
        { type: 'separator' },
        { label: t.soundsDir, click: () => applyMenuAction('sounds-dir') },
      ],
    },
    {
      label: t.screen,
      enabled: s.displays.length > 1,
      submenu: s.displays.map((d) => ({
        label: d.label,
        type: 'radio',
        checked: d.current,
        click: () => applyMenuAction('display', d.id),
      })),
    },
    ...(!s.folded ? [{ label: t.wander, type: 'checkbox', checked: s.cfg.wander, click: (item) => applyMenuAction('wander', item.checked) }] : []),
    { label: t.possess, type: 'checkbox', checked: s.cfg.possess, click: (item) => applyMenuAction('possess', item.checked) },
    {
      label: s.cfg.mic ? t.micOn : t.micOff,
      type: 'checkbox',
      checked: s.cfg.mic,
      click: (item) => applyMenuAction('mic', item.checked),
    },
    {
      label: t.micDevice,
      submenu: [
        {
          label: t.micDefault,
          type: 'radio',
          checked: s.cfg.micDevice == null,
          click: () => applyMenuAction('mic-device', null),
        },
        ...(s.micDevices || []).map((d) => ({
          label: d.name,
          type: 'radio',
          checked: Number(s.cfg.micDevice) === Number(d.id),
          click: () => applyMenuAction('mic-device', d.id),
        })),
      ],
    },
    {
      label: t.lang,
      submenu: s.langs.map(([value, label]) => ({
        label, type: 'radio', checked: s.langSetting === value, click: () => applyMenuAction('lang', value),
      })),
    },
    {
      label: t.startup,
      type: 'checkbox',
      checked: s.login,
      click: (item) => applyMenuAction('startup', item.checked),
    },
    { type: 'separator' },
    { label: t.quit, click: () => applyMenuAction('quit') },
  ]);
  tray.setContextMenu(menu);
  trayMenu = menu;
}

// Run from a clone (`npm start`), electron.exe alone would open the default Electron app at login:
// it needs the project folder as argument.
function loginItemOptions() {
  if (app.isPackaged) return { path: process.execPath, args: [] };
  return { path: process.execPath, args: [ROOT] };
}

// From the tray, she says how it went; from her welcome panel (quiet), the panel does.
function runHooks(action, { quiet = false } = {}) {
  let outcome;
  try {
    const result = action === 'install' ? hooks.install() : hooks.uninstall();
    outcome = { action, ok: true, file: result.file };
  } catch (err) {
    outcome = { action, ok: false, error: err.message };
  }
  if (!quiet) sendCommand('hooks', outcome);
  rebuildTray();
  return outcome;
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Capri');
  tray.on('click', () => sendCommand('status'));
  rebuildTray();
}

function registerIpc() {
  ipcMain.on('overlay:interactive', (_e, on) => {
    overlay?.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('overlay:rearm', () => rearmOverlay()); // the pointer moved over her and she never heard of it
  ipcMain.on('overlay:folded', (_e, on) => {
    overlayFolded = Boolean(on);
    voice?.setSleeping?.(overlayFolded);
    rebuildTray();
  });
  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    return { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height };
  });
  ipcMain.handle('config:get', () => rendererConfig());
  ipcMain.handle('hooks:status', () => hooks.status());
  ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
  ipcMain.handle('demo:window', (_e, open) => demoWindow(open));
  // right-clicking her: the same menu as the tray icon (which Windows often hides behind the ^ by the clock)
  ipcMain.on('menu:open', () => trayMenu?.popup({ window: overlay }));
  // her welcome panel's buttons
  ipcMain.handle('hooks:install', () => runHooks('install', { quiet: true }));
  ipcMain.handle('claude:found', () => fs.existsSync(path.dirname(hooks.status().file))); // Claude Code keeps its settings there
  ipcMain.on('claude:help', () => shell.openExternal(CLAUDE_CODE_HELP));
  ipcMain.handle('windows:get', () => lastWindows);
  // her guide: where her tray icon is (it lives in the taskbar, off the overlay, hence overlay
  // coordinates past its edge), and the corner by the clock in case Windows hid it behind the ^
  ipcMain.handle('guide:tray', () => {
    const o = overlay.getBounds();
    const d = targetDisplay().bounds;
    const b = tray?.getBounds();
    const icon = b && b.width > 0 ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : null;
    const corner = { x: d.x + d.width - 150 - o.x, y: d.y + d.height - 44 - o.y, w: 140, h: 40 };
    return { icon, corner };
  });
  // her guide: Claude Code's folder (~/.claude) in Explorer, its settings file selected
  ipcMain.handle('guide:claudeFolder', () => {
    const file = hooks.status().file;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) return { found: false, dir };
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(dir);
    return { found: true, dir, file: fs.existsSync(file) };
  });
  ipcMain.handle('menu:get', (_e, extra = {}) => {
    voice?.listDevices();
    const state = menuState(extra);
    structuredClone(state);
    return state;
  });
  ipcMain.handle('menu:action', (_e, payload = {}) => {
    applyMenuAction(payload.id, payload.value);
    return { ok: true };
  });
  // her hello at boot: the overlay shows it, and it plays from the cached wav if there is one
  ipcMain.handle('greet', () => {
    const picked = pickGreeting({ last: config.load().greeting?.last || null });
    config.save({ greeting: { last: picked.id } });
    if (voiceReplyOn() && speakQueue) {
      const rid = speakQueue.start();
      if (rid) {
        voice?.greet?.(picked.id, picked.text, rid);
        speakQueue.flush(rid);
      }
    }
    return picked;
  });
  ipcMain.handle('llm:status', () => lms?.status() || 'ready');
  ipcMain.handle('chat:send', async (_e, text) => {
    const line = String(text || '').trim();
    if (!line || !overlay) return { ok: false };
    const fixOrder = parseFixCommand(line);
    if (fixOrder) {
      const done = goFixReply(fixOrder);
      if (done.line) return done; // said something; a fix that can't be saved (too long) goes to the model
    }
    if (isSleepCommand(line)) return goSleepReply();
    if (isClipCommand(line)) return goClipReply();
    if (isMuteCommand(line)) return goMicReply(false);
    if (isUnmuteCommand(line)) return goMicReply(true);
    if (isForgetCommand(line)) return goForgetReply();
    // typing to her while she's DORMANT (or asking her to wake) brings her back, no model needed
    if (overlayFolded || isWakeCommand(line)) return goWakeReply();
    const boot = await lms.whenReady();
    if (boot === 'failed') {
      overlay.webContents.send('chat:error', { kind: 'offline' });
      return { ok: false };
    }
    const speakId = ttsOn() ? speakQueue?.start() : 0;
    if (!speakId) speakQueue?.stop();
    llmBusy = true;
    try {
      await llm.chat({
        user: line,
        onToken: (piece) => {
          overlay?.webContents.send('chat:token', piece);
          if (speakId) speakQueue?.feed(piece);
        },
        onDone: (payload) => {
          if (speakId) speakQueue?.flush(speakId);
          overlay?.webContents.send('chat:done', payload);
        },
        onError: (payload) => {
          if (speakId) speakQueue?.stop(speakId);
          overlay?.webContents.send('chat:error', payload);
        },
      });
    } finally {
      llmBusy = false;
    }
    return { ok: true };
  });
  ipcMain.on('chat:cancel', () => {
    llm?.cancel();
    speakQueue?.stop();
  });
  ipcMain.on('voice:interrupt', () => {
    llm?.cancel();
    speakQueue?.stop();
    voice?.pttStart();
  });
  ipcMain.on('chat:close', () => closeChat());
  ipcMain.handle('sounds:list', () => {
    try {
      return fs.readdirSync(userSoundsDir())
        .filter((f) => SOUND_EXT.test(f))
        .map((f) => ({ name: f.replace(SOUND_EXT, '').toLowerCase(), url: `capri://usersounds/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });
}

// Only in --dev: lets scripts drive the overlay and grab frames of it (no desktop content, just our window).
const testWins = new Map(); // name -> test window

async function debugHandler(route, body) {
  if (!DEV) throw new Error('debug routes need --dev');
  if (route === 'command') {
    sendCommand(body.name, body);
    return { ok: true };
  }
  if (route === 'reload') {
    overlay.webContents.reloadIgnoringCache();
    return { ok: true };
  }
  if (route === 'unhook') {
    // the pointer no longer passed on to her, as when Windows drops the mouse hook
    overlay.setIgnoreMouseEvents(true);
    return { ok: true };
  }
  if (route === 'testwin') {
    // plain windows to sit on, opened without stealing focus, by name (`id`, default "main");
    // each one opened goes in front of the others. { open: false } without an id closes them all.
    const id = body.id ?? 'main';
    if (!body.open && body.id === undefined) {
      for (const win of testWins.values()) win.destroy();
      testWins.clear();
      return { ok: true };
    }
    testWins.get(id)?.destroy();
    testWins.delete(id);
    if (body.open) {
      const b = overlay.getBounds();
      const win = new BrowserWindow({
        x: b.x + (body.x ?? 300), y: b.y + (body.y ?? 380), width: body.w ?? 720, height: body.h ?? 380,
        show: false, alwaysOnTop: true, title: `Capri test window ${id}`, backgroundColor: '#1b1726',
      });
      win.loadURL('data:text/html,<body style="background:%231b1726"></body>');
      win.showInactive();
      testWins.set(id, win);
    }
    return { ok: true };
  }
  if (route === 'movewin' && testWins.has(body.id ?? 'main')) {
    const win = testWins.get(body.id ?? 'main');
    const [x, y] = win.getPosition();
    win.setPosition(x + (body.dx || 0), y + (body.dy || 0));
    return { ok: true };
  }
  if (route === 'mouse') {
    // the pointer moving over the overlay (css px), and clicking if asked, without touching the real one
    const at = { x: Math.round(body.x), y: Math.round(body.y) };
    overlay.webContents.sendInputEvent({ type: 'mouseMove', ...at });
    if (body.click) {
      overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at });
      overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at });
    }
    return { ok: true };
  }
  if (route === 'capture') {
    const image = await overlay.webContents.capturePage();
    // installed, the app's own folder is read-only: its data folder instead
    const dir = path.join(app.isPackaged ? app.getPath('userData') : ROOT, 'captures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${(body.name || 'frame').replace(/[^\w-]/g, '')}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  }
  throw new Error('unknown debug route');
}

function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => sendCommand('status'));
  if (process.platform === 'win32') app.setAppUserModelId('capri.desktop');

  app.whenReady().then(() => {
    serveProtocol();
    registerIpc();
    llm = createLlm({
      loadConfig: () => config.load(),
      personaPath: path.join(__dirname, 'persona.md'),
    });
    lms = createLms({
      loadConfig: () => config.load(),
      onStatus: (state) => overlay?.webContents.send('llm:boot', { state }),
    });
    lms.start();
    voice = createVoice({
      root: ROOT,
      loadConfig: () => config.load(),
      onEvent: (event) => {
        const payload = event?.type === 'transcript' ? hearTranscript(event) : event;
        if (payload?.type === 'tts_state') ttsLoading = payload.state === 'loading';
        if (payload?.type === 'talking') voiceTalking = true;
        if (payload?.type === 'talking_done' || payload?.type === 'stopped') voiceTalking = false;
        if (payload?.type === 'listening') openChat();
        if (payload?.type === 'devices') rebuildTray();
        if (pendingSleep && payload?.type === 'talking_done') requestSleep();
        if (overlay?.webContents && !overlay.webContents.isDestroyed()) {
          overlay.webContents.send('voice:event', payload);
        } else {
          voiceQueue.push(payload);
        }
      },
    });
    createOverlay();
    speakQueue = createSpeakQueue({
      send: (msg) => voice?.push?.(msg),
    });
    // her own life: a line now and then, and one when the window in front changes
    comments = createComments({
      enabled: () => config.load().comments?.enabled !== false,
      canSpeak: () => Boolean(
        overlay
        && !overlayFolded
        && !chatOpen
        && !ttsLoading
        && !voiceTalking
        && !llmBusy
        && !gameMode?.active()
        && !pendingSleep
      ),
      minMs: () => commentRange(config.load().comments?.minMinutes, 15),
      maxMs: () => commentRange(config.load().comments?.maxMinutes, 40),
      onLine: (line, kind) => {
        if (!line) return;
        speakLine(line);
        sendCommand('line', { badge: COMMENT_BADGE[kind] || 'CAPRI', text: line });
      },
    });
    voice.prepareGreetings(GREETINGS);
    voice.start();
    gameMode = createGameMode({
      enabled: () => config.load().gaming?.mode !== 'off',
      apps: () => config.load().gaming?.apps || [],
      onEnter: (windows) => queueGame(() => gameEnter(windows)),
      onExit: () => queueGame(gameLeave),
    });
    createTray();
    comments.start();
    windowWatch = startWindowWatch({
      overlay,
      onUpdate: (data) => {
        const rest = config.load().rest === 'taskbar';
        // The bar coming up (the Windows key, the pointer at the bottom, a click on it) and Start
        // or the search opening: Windows puts them over her, and standing on the bar she would
        // vanish behind it. Back on top.
        const barUp = Boolean(rest && lastWindows && data.bar?.shown && !lastWindows.bar?.shown);
        const start = Boolean(lastWindows && data.start && !lastWindows.start);
        if (barUp || start || (rest && data.taskbar && !lastWindows?.taskbar)) raiseOverlay();
        lastWindows = data;
        gameMode?.update(data);
        comments?.observe(windowContext(data, { apps: config.load().gaming?.apps || [] }));
        overlay?.webContents.send('windows:update', data);
      },
    });
    createBridge({
      port: PORT,
      onEvent: (evt) => {
        // a game owns the screen: she stays folded and quiet until it is over
        if (gameMode?.active()) return;
        overlay?.webContents.send('claude:event', evt);
      },
      onDebug: DEV ? debugHandler : null,
    });
    registerShortcuts();
    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
    // after sleep or a locked screen, once Windows has settled
    powerMonitor.on('resume', () => setTimeout(rearmOverlay, 2000));
    powerMonitor.on('unlock-screen', () => setTimeout(rearmOverlay, 1000));
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    windowWatch?.stop();
    gameMode?.stop();
    comments?.stop();
    voice?.stop();
    lms?.unload();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
