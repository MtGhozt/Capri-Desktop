'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage, powerMonitor, dialog, safeStorage,
} = require('electron');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch, restoreForeground } = require('./windows');
const { createLlm } = require('./llm');
const { PROVIDERS, providerOptions, isCloud } = require('./chat-providers');
const { switchProvider, setProviderModel, modelForProvider } = require('./chat-models');
const { parseRenderMode, renderSwitches } = require('./render-mode');
const { createLms } = require('./lms');
const { createVoice } = require('./voice');
const { createSpeakQueue } = require('./speak');
const { isSleepCommand } = require('./sleep-command');
const { isQuitCommand } = require('./quit-command');
const { createGoodnight } = require('./goodnight');
const { isClipCommand } = require('./clip-command');
const { isMuteCommand, isUnmuteCommand } = require('./mic-command');
const { isForgetCommand } = require('./forget-command');
const { isWakeCommand } = require('./wake-command');
const { parseMusicCommand } = require('./music-command');
const { createSystemFlow, runSystem } = require('./system-command');
const { createConfirm, readAnswer } = require('./app-confirm');
const { wakePhraseLabel } = require('./wake-phrase');
const { createMusic } = require('./music');
const { createSpotify, createTokenStore, authorizeSpotify, spotifyFailureLine } = require('./spotify');
const { pickLine, fillLine } = require('./lines-es');
const { addFix, removeFix, cleanFixes } = require('./fixes');
const { parseFixCommand, readTranscript } = require('./fix-command');
const { stripWakeWord } = require('./command-text');
const { GREETINGS, pickGreeting } = require('./greetings');
const { windowContext } = require('./context');
const { createComments } = require('./comments');
const { createGameMode } = require('./game-mode');
const { vramText } = require('./vram');
const { logEvent, voiceLogPath } = require('./log');
const { saveClip, openClipsFolder, clipFolderLabel } = require('./clips');
const { micActive } = require('./voice-config');
const { createFollowUp } = require('./follow-up');
const {
  SENS_MIN, SENS_MAX, SENS_STEP, thresholdFromPct, pctFromThreshold,
  normalizeAccelerator, acceleratorFromKey, sameCombo,
} = require('./hearing');
const { createAppFlow } = require('./app-flow');
const { createAppActions, isProtected } = require('./app-actions');
const { createAppFx } = require('./app-fx');
const { createMenuGuard } = require('./menu-guard');
const { toOverlayRect } = require('./rects');
const appScan = require('./app-scan');
const appHost = require('./app-host');
const {
  TYPE_LABEL, CLOSE_LABEL, CLOSE_MODES, plainKey, cleanApps, normalizeApp, seedApps, defaultCandidates,
  browserName, exeFromCommand, processName, linkTarget, linkOk, SEED_VERSION, seededVersion, newCandidates,
} = require('./apps-config');
const hooks = require('../../scripts/install-hooks');
const demoSteps = require('../../scripts/demo-sequence');
const { createSettingsWindow } = require('./settings-window');
const { ensureUserFiles } = require('./user-files');
const { needsModelSetup, probeLocalLlm, SETUP_HINT } = require('./setup');

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
let settingsWindow = null;
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
let voiceListening = false;
let voiceMic = { open: true, needed: true, message: '' };
let llmBusy = false;
let voiceQueue = [];
let chatOpen = false;
let previousForeground = null;
let menuKeyboard = false; // her menu has a text field open (Corregir lo último): it needs the keyboard
let lastHeard = '';       // the last thing Whisper wrote, before her fixes (Corregir lo último)
let gameMode = null;
let gameWork = Promise.resolve();
let gameWasFolded = false;
let gameHadLlm = false;
let gameHadVoice = false;
let lastGreetingAt = 0;
let bootGreetingDone = false;
let greeting = null;
let userFiles = null;
const GREETING_COOLDOWN_MS = 10 * 60_000;

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
  setClickThrough(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  fitOverlay();
  sendCommand('rearmed'); // click-through again: she waits for the pointer to be on her
  console.log('[capri] mouse hook set up again');
}

// Win+L / sleep freezes heartbeats and Windows drops global shortcuts. Reset so the quick menu
// and Ajustes are not stuck under an interactive fullscreen overlay with a dead Esc hook.
function recoverAfterUnlock(reason = 'unlock') {
  if (!overlay || overlay.isDestroyed()) return;
  logEvent(voiceLogPath(), `[capri] recover after ${reason}`);
  menuGuard.forceClose(reason);
  menuKeyboardOn(false);
  if (chatOpen) closeChat();
  else {
    overlay.setFocusable(false);
    overlay.showInactive();
  }
  rearmOverlay();
  // force Esc re-bind: Windows drops the accelerator on the lock screen while we still think it's ours
  takeEscape(false);
  raiseOverlay();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    try { settingsWindow.moveTop(); settingsWindow.focus(); } catch { /* gone */ }
  }
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
    if (!menuGuardTimer) menuGuardTimer = setInterval(() => menuGuard.tick(), 2000);
    for (const payload of voiceQueue) overlay.webContents.send('voice:event', payload);
    voiceQueue = [];
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
    logEvent(voiceLogPath(), `[capri] renderer gone: ${details.reason}`);
    setClickThrough(true); // nobody left to answer the clicks: they go to the windows under her
  });
  // a stalled page can't take clicks back from the screen: give them back to the other windows
  overlay.webContents.on('unresponsive', () => {
    logEvent(voiceLogPath(), '[capri] renderer unresponsive: click-through on');
    setClickThrough(true);
  });
  overlay.webContents.on('responsive', () => logEvent(voiceLogPath(), '[capri] renderer responsive again'));
  // another window came to the front (a click, Alt+Tab, the taskbar): her menu goes away
  // (not when she hands the keyboard back herself: that's her menu changing page)
  overlay.on('blur', () => {
    if (Date.now() - handedBackAt < 1500) return;
    sendCommand('menu-close');
  });
  // her errors in the log, so a stuck overlay can be traced
  overlay.webContents.on('console-message', (e) => {
    const { level, message, lineNumber, sourceId } = e;
    if (level !== 'error' && level !== 3) return;
    logEvent(voiceLogPath(), `[renderer] ${String(message).slice(0, 300)} (${String(sourceId).split('/').pop()}:${lineNumber})`);
  });
  if (DEV) {
    overlay.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`);
    });
    if (process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

// Click-through, as she last asked for it: put back after anything that may touch the window's
// styles (focusable, show, focus), and again on her heartbeat, so it can't stay off by itself.
let clickThrough = true;
let handedBackAt = 0; // when she last gave the keyboard back to the window before her
function setClickThrough(on) {
  clickThrough = Boolean(on);
  if (!overlay || overlay.isDestroyed()) return;
  if (clickThrough) overlay.setIgnoreMouseEvents(true, { forward: true });
  else overlay.setIgnoreMouseEvents(false);
}

// Her menu can't hold the screen (menu-guard.js): heartbeat, forced close, Esc while it's open.
const menuGuard = createMenuGuard({
  clickThrough: () => clickThrough,
  setClickThrough,
  sendCommand: (name, payload) => {
    sendCommand(name, payload);
    // a frame of the menu left on screen by a stalled compositor goes too
    setTimeout(() => overlay && !overlay.isDestroyed() && overlay.webContents.invalidate(), 150);
  },
  keyboardOff: () => menuKeyboardOn(false),
  reload: () => {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.webContents.reloadIgnoringCache();
  },
  onMenu: (open) => takeEscape(open),
  log: (line) => logEvent(voiceLogPath(), line),
});

// Esc while her menu is open, wherever the keyboard is: the overlay rarely has it (it never takes
// it by itself), so a key listener in her page alone can't be counted on.
let escapeTaken = false;
let menuGuardTimer = 0;
function takeEscape(on) {
  try {
    // Always unregister first: after Win+L the OS may have dropped the hook while escapeTaken stayed true.
    if (escapeTaken || !on) {
      try { globalShortcut.unregister('Escape'); } catch { /* already gone */ }
      escapeTaken = false;
    }
    if (!on) return;
    escapeTaken = globalShortcut.register('Escape', () => menuGuard.forceClose('esc'));
  } catch (err) {
    console.error(`[capri] Esc for the menu: ${err.message}`);
    escapeTaken = false;
  }
}

// Esc while she says goodbye and the screen goes down (Paso 4G): the only key that stops it from anywhere.
let systemEsc = false;
function systemEscape(on) {
  if (on) {
    if (systemEsc || escapeTaken) return;
    try {
      if (globalShortcut.register('Escape', () => systemFlow.cancel('esc'))) systemEsc = true;
    } catch (err) {
      console.error(`[capri] Esc for the countdown: ${err.message}`);
    }
    return;
  }
  if (!systemEsc) return;
  try { globalShortcut.unregister('Escape'); } catch { /* already gone */ }
  systemEsc = false;
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
  setClickThrough(clickThrough);
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
  handedBackAt = Date.now();
  if (target != null) restoreForeground(target);
  overlay?.setFocusable(false);
  overlay?.showInactive();
  setClickThrough(clickThrough);
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
    setClickThrough(clickThrough);
    return;
  }
  if (!menuKeyboard) return;
  menuKeyboard = false;
  if (chatOpen) return; // the chat still has it
  const target = previousForeground;
  previousForeground = null;
  handedBackAt = Date.now();
  if (target != null) restoreForeground(target);
  overlay.setFocusable(false);
  overlay.showInactive();
  setClickThrough(clickThrough);
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

// Sleep by command: her goodnight line first, then her corner and the fold (goodnight.js).
const goodnight = createGoodnight({ fold: () => sendCommand('sleep') });

// When her answer to what you said ends with a question, the mic opens for the answer, no wake
// word (follow-up.js). Never while the mic is muted, she is DORMANT or going there, or a game runs.
const followUp = createFollowUp({
  seconds: () => followUpSec(config.load()),
  canListen: () => Boolean(
    voice?.running?.()
    && micActive(config.load())
    && !overlayFolded
    && !goodnight.pending
    && !gameMode?.active?.()
    && !menuKeyboard
  ),
  open: (secs) => {
    logEvent(voiceLogPath(), `[capri] follow-up listen ${secs}s chain=${followUp.chain}`);
    voice?.followUp?.(secs);
  },
  onOpened: () => {
    try { comments?.opened(); } catch (err) { logEvent(voiceLogPath(), `[capri] follow-up opened failed: ${err.message}`); }
  },
  onHeard: () => {
    try { comments?.heard(); } catch (err) { logEvent(voiceLogPath(), `[capri] follow-up heard failed: ${err.message}`); }
  },
  onError: (err, phase) => logEvent(voiceLogPath(), `[capri] follow-up ${phase} failed: ${err.message}`),
});

function followUpSec(cfg) {
  const n = Number(cfg.hearing?.followUpSec);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(30, n);
}

// Her line to the sidecar, when her voice is on. The speak id, or 0 when it was not sent.
function speakLine(line) {
  const speakId = ttsOn() ? speakQueue?.start() : 0;
  if (!speakId) return 0;
  speakQueue.feed(line);
  speakQueue.flush(speakId);
  return speakId;
}

// One of her direct-command lines (lines-es.js), said and shown where the command came from:
// her chat bubble, or the panel when it came from her menu or the tray.
function announce(line, opts) {
  const spoken = Boolean(speakLine(line));
  followUp.reply(line, { spoken }); // a question to what you said: she listens for the answer
  return showLine(line, opts);
}

function showLine(line, { chat = false, badge = 'CAPRI' } = {}) {
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

const MUSIC_LINE = {
  pause: 'musicaPausa',
  play: 'musicaPlay',
  next: 'musicaSiguiente',
  previous: 'musicaAnterior',
  volumeUp: 'musicaVolumen',
  volumeDown: 'musicaVolumen',
  mute: 'musicaMute',
  start: 'musicaInicio',
  query: 'musicaPlay',
};

async function musicReply(parsed, { chat = true } = {}) {
  try {
    const result = await music.command(parsed);
    logEvent(voiceLogPath(), `[capri] music ${parsed.action} ${result?.ok ? 'ok' : `failed: ${result?.error || '?'}`}`);
    if (!result?.ok) {
      const miss = parsed.action === 'query' && parsed.query
        ? `No encontré «${parsed.query}».`
        : (result?.error || 'No pude hacer eso con la música.');
      showLine(miss, { chat, badge: 'MUSIC' });
      return { ok: false };
    }
    let line;
    if (parsed.action === 'open') {
      line = `Abro ${result.player === 'spotify' ? 'Spotify' : 'Namida'}.`;
    } else if (parsed.herSong) {
      line = pickLine('musicaSuCancion');
    } else if (result.searchOnly) {
      line = `Abrí la búsqueda de «${result.query}» en Spotify — dale play al primero, choom.`;
    } else if (parsed.action === 'query' && result.track) {
      line = result.artist
        ? `Va, pongo «${result.track}» de ${result.artist}.`
        : `Va, pongo «${result.track}».`;
    } else if (result?.track) {
      line = `Está sonando «${result.track}» de ${result.artist}.`;
    } else {
      line = pickLine(MUSIC_LINE[parsed.action] || 'musicaPlay');
    }
    sendCommand('box-log', { kind: 'musica', text: parsed.action });
    sendCommand('music-state', { playing: !['pause', 'mute', 'volumeDown', 'volumeUp', 'open'].includes(parsed.action) });
    announce(line, { chat, badge: 'MUSIC' });
    return { ok: true };
  } catch (err) {
    console.error('[capri] music command failed:', err.message);
    logEvent(voiceLogPath(), `[capri] music ${parsed.action} failed: ${err.message}`);
    showLine('No pude controlar la música.', { chat, badge: 'MUSIC' });
    return { ok: false };
  }
}

// Hidden [open:<app>] / [play:<query>] tag on her reply: the same paths a typed order takes,
// without her generic "opening X" line (she already answered in her own words).
async function runReplyAction(action) {
  const value = String(action?.value || '').trim();
  if (!value) return;
  const kind = String(action?.kind || '').toLowerCase();
  try {
    if (kind === 'open') {
      const result = await apps().command(`abre ${value}`);
      if (result && result.ok === false) showLine(result.line, { chat: true, badge: 'APPS' });
      return;
    }
    if (kind === 'play') {
      const parsed = parseMusicCommand(action.herSong ? 'tu canción' : `pon ${value}`, {
        herSong: config.load().music?.herSong,
      });
      if (!parsed) return;
      const result = await music.command(parsed);
      if (!result?.ok) showLine(result?.error || 'No pude poner esa música.', { chat: true, badge: 'MUSIC' });
    }
  } catch (err) {
    logEvent(voiceLogPath(), `[capri] reply action ${kind} failed: ${err.message}`);
  }
}

// -- the PC's own power commands (Paso 4G) -------------------------------------------------
// "apaga la compu", "bloquea la PC": straight from what you said, never the model. `systemFlow`
// asks first for shutdown / restart / suspend and gives the countdown its Esc.

// Her line, and a promise that settles when she's done saying it (talking_done), capped so a
// stuck voice never holds the PC up. Voice off: the line stays in the box for a moment.
const SYSTEM_SAY_CAP_MS = 4500;
const speechWaiters = new Set();
function sayAndWait(text, capMs = SYSTEM_SAY_CAP_MS) {
  const spoken = Boolean(speakLine(text));
  followUp.reply(text, { spoken });
  showLine(text, { chat: true, badge: 'SISTEMA' });
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); speechWaiters.delete(done); resolve(); };
    const timer = setTimeout(done, spoken ? capMs : Math.min(capMs, 1800));
    if (spoken) speechWaiters.add(done);
  });
}
function speechOver() {
  for (const done of [...speechWaiters]) done();
}

// The fall and the CRT power-off on her overlay. Settles when the renderer says it's over
// (or a little after it should have been). Her menu's "Animaciones de apps" off: no show.
const SYSTEM_FX_MS = { shutdown: 3600, restart: 3600, suspend: 1900 };
let systemFxSeq = 0;
const systemFxWaiters = new Map();
function systemFx(action) {
  if (!overlay || overlay.isDestroyed() || config.load().fx?.apps === false) return Promise.resolve();
  const id = ++systemFxSeq;
  const ms = SYSTEM_FX_MS[action] || 3600;
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); systemFxWaiters.delete(id); resolve(); };
    const timer = setTimeout(done, ms + 2500);
    systemFxWaiters.set(id, done);
    sendCommand('system-fx', { id, action, ms });
  });
}

const systemFlow = createSystemFlow({
  run: async (action) => {
    // her mic and voice let go of the audio devices (and the GPU) before the PC sleeps;
    // they come back on resume
    if (action === 'suspend' && voice) {
      logEvent(voiceLogPath(), '[capri] voice sidecar stopped before suspend');
      voice.stop();
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return runSystem(action);
  },
  line: (kind, values) => fillLine(pickLine(kind), values),
  say: (text) => sayAndWait(text),
  log: (text) => logEvent(voiceLogPath(), `[capri] ${text}`),
  event: (text) => sendCommand('box-log', { kind: 'sistema', text }),
  fx: (action) => systemFx(action),
  stopFx: () => sendCommand('system-fx-stop'),
  clearFx: () => sendCommand('system-fx-clear'),
  escape: (on) => systemEscape(on),
});

const QUIT_CONFIRM_MS = 10_000;
const quitConfirm = createConfirm({ ttlMs: QUIT_CONFIRM_MS });
let quitTimer = null;

function resolveVoiceModelsRoot(cfg = config.load()) {
  const raw = cfg?.voice?.dir;
  if (raw != null && String(raw).trim()) return path.resolve(String(raw).trim());
  return path.join(ROOT, 'voice');
}

function clearQuitAsk() {
  if (quitTimer) {
    clearTimeout(quitTimer);
    quitTimer = null;
  }
  quitConfirm.cancel();
}

function askQuit({ chat = false } = {}) {
  clearQuitAsk();
  const line = pickLine('salirPreguntar');
  const spoken = Boolean(speakLine(line));
  followUp.reply(line, { spoken }); // "sí" / "ok" without the wake word
  if (chat) showLine(line, { chat: true, badge: 'SALIR' });
  sendCommand('quit-ask', { text: line });
  quitConfirm.ask('quit');
  quitTimer = setTimeout(() => {
    quitTimer = null;
    if (!quitConfirm.pending) return;
    quitConfirm.cancel();
    sendCommand('quit-clear');
    announce(pickLine('salirCancelado'), { chat, badge: 'SALIR' });
  }, QUIT_CONFIRM_MS);
  return { ok: true, asked: true };
}

function answerQuit(value) {
  const pending = quitConfirm.pending;
  if (!pending) return { ok: false };
  clearQuitAsk();
  sendCommand('quit-clear');
  const yes = value === 'yes' || value === 'si' || readAnswer(String(value || '')) === 'yes';
  if (yes) {
    app.quit();
    return { ok: true, quit: true };
  }
  announce(pickLine('salirCancelado'), { chat: true, badge: 'SALIR' });
  return { ok: true, cancelled: true };
}

function goSleepReply({ chat = true } = {}) {
  const line = pickLine('dormir');
  const spoken = Boolean(speakLine(line));
  followUp.reply('', {}); // off to sleep: no listening for an answer
  showLine(line, { chat, badge: 'SLEEP' });
  goodnight.start({ spoken, line }); // folds once she has said it
  return { ok: true };
}

function goWakeReply({ chat = true } = {}) {
  goodnight.cancel();
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
  // what Whisper wrote, so a command that went to the model can be traced (and fixed)
  if (said.trim()) logEvent(voiceLogPath(), `[capri] heard: ${JSON.stringify(said.trim().slice(0, 200))}`);
  if (read.heard) logEvent(voiceLogPath(), `[capri] heard fix: ${JSON.stringify(said)} -> ${JSON.stringify(read.text)}`);
  // the wake word is not part of the order; the chat still shows what he said ("Hola Capri")
  return { ...payload, text: read.text, command: stripWakeWord(read.text), heard: read.heard };
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

// -- her apps (Paso 4C) ---------------------------------------------------------------------
// "abre Discord", "cierra Spotify": straight from her table (config apps.list), no model.

const appList = () => cleanApps(config.load().apps?.list);
// your table first, then what her scan found on this PC (Paso 4D)
const allApps = () => appScan.mergeApps(appList(), scanned().items);

let spotifyAccessToken = null;
const spotifyTokens = () => createTokenStore({
  file: path.join(app.getPath('userData'), 'spotify-token'),
  safeStorage,
});
function restoreSpotifyToken() {
  const saved = spotifyTokens().read();
  if (saved?.access_token) spotifyAccessToken = saved.access_token;
}
async function connectSpotify(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return { ok: false, message: 'Falta el Client ID.' };
  try {
    const tokens = await authorizeSpotify({
      clientId: id,
      openExternal: (url) => shell.openExternal(url),
      tokenStore: spotifyTokens(),
    });
    spotifyAccessToken = tokens.access_token;
    rebuildTray();
    return { ok: true };
  } catch (err) {
    console.error('[capri] Spotify connection failed:', err.message);
    const message = spotifyFailureLine(err);
    showLine(message, { badge: 'SPOTIFY' }); // the menu used to drop this on the floor
    return { ok: false, message };
  }
}
const spotify = createSpotify({ token: () => spotifyAccessToken });

// Cloud chat keys, kept encrypted with your Windows account in their own file: never in config.json,
// never in a log (Paso 4K). Same store as Spotify's tokens.
const llmKeys = () => createTokenStore({
  file: path.join(app.getPath('userData'), 'llm-keys'),
  safeStorage,
});
function llmKey(id) {
  return String(llmKeys().read()?.[id] || '');
}
function saveLlmKey(id, key) {
  const all = llmKeys().read() || {};
  const clean = String(key || '').trim();
  if (clean) all[id] = clean;
  else delete all[id];
  llmKeys().write(all);
  return Boolean(clean);
}

function hasAnyLlmKey() {
  const all = llmKeys().read() || {};
  return Object.values(all).some((value) => String(value || '').trim());
}

async function maybeOpenSetupHint() {
  const cfg = config.load();
  if (cfg.guide?.setupHint) return;
  const localReachable = await probeLocalLlm(cfg.llm?.baseUrl);
  if (!needsModelSetup({ hasAnyKey: hasAnyLlmKey(), localReachable })) return;
  config.save({ guide: { setupHint: true } });
  openSettingsTab('model', SETUP_HINT);
}

function openSettingsTab(tab = null, hint = '') {
  settingsWindow = createSettingsWindow({
    BrowserWindow,
    existing: settingsWindow,
    url: 'capri://app/src/renderer/settings.html',
    options: {
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    },
  });
  settingsWindow.once?.('closed', () => { settingsWindow = null; });
  const boot = () => {
    const parts = [];
    if (tab) parts.push(`window.dispatchEvent(new CustomEvent('capri-settings-tab',{detail:${JSON.stringify(tab)}}))`);
    if (hint) parts.push(`window.dispatchEvent(new CustomEvent('capri-setup-hint',{detail:${JSON.stringify(hint)}}))`);
    if (parts.length) settingsWindow.webContents.executeJavaScript(parts.join(';')).catch(() => {});
  };
  if (settingsWindow.webContents.isLoading?.()) {
    settingsWindow.webContents.once('did-finish-load', boot);
  } else {
    boot();
  }
  return { ok: true };
}
// is that program up? (tasklist, so no extra script)
function processRunning(name) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    const child = spawn('tasklist', ['/FI', `IMAGENAME eq ${name}.exe`, '/NH'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.once('error', () => resolve(false));
    child.once('close', () => resolve(out.toLowerCase().includes(`${name}.exe`)));
  });
}

const music = createMusic({
  config,
  apps: allApps,
  spotify,
  openExternal: (url) => shell.openExternal(url),
  log: (text) => appLog(text),
  isRunning: (name) => processRunning(name),
  sendKey: (action, script) => new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('media keys require Windows'));
    const child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action,
    ], { windowsHide: true });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`media key exited ${code}`)));
  }),
});
const appLog = (text) => logEvent(voiceLogPath(), `[capri] ${text}`);
let appFlow = null;

// her zap before a close, her spark after an open (Paso 4E): off in her menu or with a game up
const appFx = createAppFx({
  send: (payload) => sendCommand('app-fx', payload),
  enabled: () => Boolean(overlay && !overlay.isDestroyed())
    && config.load().fx?.apps !== false
    && !gameMode?.active?.(),
  toOverlay: (rect) => {
    const bounds = overlay.getBounds();
    const r = toOverlayRect(rect, bounds, (box) => screen.screenToDipRect(null, box));
    // off her screen (another monitor): she zaps toward the taskbar instead
    if (!r || r.x >= bounds.width || r.x + r.w <= 0 || r.y >= bounds.height || r.y + r.h <= 0) return null;
    return r;
  },
});

function apps() {
  if (!appFlow) {
    appFlow = createAppFlow({
      apps: allApps,
      actions: createAppActions({
        ...appHost.realDeps({ shell, skipPids: () => [process.pid, process.ppid] }),
        zap: (rect) => appFx.zap(rect),
        spark: (app) => appFx.spark(app),
      }),
      line: (kind, values) => fillLine(pickLine(kind), values),
      log: appLog,
      event: (kind, text) => sendCommand('box-log', { kind, text }),
    });
  }
  return appFlow;
}

function appReply(result, { chat = true } = {}) {
  announce(result.line, { chat, badge: 'APPS' });
  return { ok: true };
}

// First run: what this PC has (Discord, Spotify, Namida, Steam, the browser, Grok, Cursor, Warp,
// Notion, Epic…) plus YouTube, Google and the File Explorer, added next to whatever is already in
// the table, never over it. A table seeded by an older version only gets the newer candidates.
async function seedAppTable() {
  const version = seededVersion(config.load().apps?.seeded);
  if (version >= SEED_VERSION) return;
  const found = await appHost.lookups(shell).catch(() => ({}));
  const exe = exeFromCommand(found.browserCommand);
  const browser = exe ? { exe, ...browserName(exe) } : null;
  const candidates = newCandidates(defaultCandidates({ exists: appHost.exists, found: { ...found, browser } }), version);
  const { list, added } = seedApps(config.load().apps?.list, candidates);
  config.save({ apps: { list, seeded: SEED_VERSION } });
  appLog(`apps seeded v${SEED_VERSION}: ${added.length ? added.join(', ') : 'nothing new'}`);
}

// -- what is installed (Paso 4D) ------------------------------------------------------------
// Steam, Epic and GOG games and the Start menu, cached in scan.json; scanned again at start when
// a day old, and from her menu (APPS, Volver a escanear).

const scanPath = () => path.join(app.getPath('userData'), 'scan.json');
let scanCache;
let scanRunning = null;

function scanned() {
  if (scanCache === undefined) {
    try {
      scanCache = JSON.parse(fs.readFileSync(scanPath(), 'utf8'));
    } catch {
      scanCache = null;
    }
  }
  return scanCache && Array.isArray(scanCache.items) ? scanCache : { items: [] };
}

function runScan(reason) {
  if (scanRunning) return scanRunning;
  scanRunning = (async () => {
    const places = await appScan.scanPlaces({ env: process.env, regValue: appHost.regValue });
    const result = await appScan.scanAll({
      places,
      regQuery: appHost.regQuery,
      readShortcut: (file) => appHost.readShortcut(shell, file),
      isProtected,
    });
    const tmp = `${scanPath()}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(result, null, 2), 'utf8');
    await fs.promises.rename(tmp, scanPath());
    scanCache = result;
    const c = result.counts;
    appLog(`apps scan (${reason}): steam=${c.steam} epic=${c.epic} gog=${c.gog} start=${c.start} in ${result.ms}ms`);
    return result;
  })().finally(() => {
    scanRunning = null;
  });
  return scanRunning;
}

function scanIfStale() {
  scanned();
  if (!appScan.isStale(scanCache)) return;
  runScan(scanCache ? 'stale' : 'first').catch((err) => appLog(`apps scan failed: ${err.message}`));
}

// What the scan found that isn't in your table: { name, source, … } as shown in her menu.
function foundApps() {
  const table = appList();
  return appScan.mergeApps(table, scanned().items).slice(table.length);
}

function promoteApp(name) {
  const found = foundApps().find((a) => sameName(a.name, name));
  if (!found) return { ok: false, message: 'Ya no está en lo encontrado. Vuelve a escanear.' };
  const { source, ...entry } = found;
  return addApp(entry);
}

async function rescanApps() {
  try {
    const result = await runScan('menu');
    return { ok: true, counts: result.counts };
  } catch (err) {
    appLog(`apps scan failed: ${err.message}`);
    return { ok: false, message: `No se pudo escanear: ${err.message}` };
  }
}

function saveApps(list) {
  config.save({ apps: { list: cleanApps(list) } });
}

function sameName(a, b) {
  return plainKey(a) === plainKey(b);
}

// A new entry from her menu: { ok, name } or { ok: false, message } in Spanish.
function addApp(raw) {
  const entry = normalizeApp(raw);
  if (!entry) return { ok: false, message: 'Eso no sirve como app.' };
  const list = appList();
  const clash = list.find((a) => [a.name, ...a.aliases].some((n) => sameName(n, entry.name)));
  if (clash) return { ok: false, message: `Ya tienes «${clash.name}». Cámbiale los alias en vez de repetirla.` };
  saveApps([...list, entry]);
  appLog(`app added ${entry.name} type=${entry.type}`);
  return { ok: true, name: entry.name };
}

async function pickProgram() {
  const res = await dialog.showOpenDialog(overlay, {
    title: 'Buscar programa',
    properties: ['openFile'],
    filters: [{ name: 'Programas y accesos directos', extensions: ['exe', 'lnk'] }],
  });
  const file = !res.canceled && res.filePaths?.[0];
  if (!file) return { ok: false, message: '' };
  let target = file;
  let args = '';
  if (/\.lnk$/i.test(file)) {
    const link = appHost.readShortcut(shell, file);
    if (link) ({ target, args } = link);
  }
  const name = path.basename(file).replace(/\.(exe|lnk)$/i, '');
  return addApp({
    name, aliases: [], type: 'program', target, args,
    processes: /\.exe$/i.test(target) ? [processName(target)] : [], close: 'graceful',
  });
}

function addLink(value = {}) {
  const name = String(value.name || '').trim();
  if (!name) return { ok: false, message: 'Ponle un nombre.' };
  const target = linkTarget(value.url);
  if (!linkOk(target)) return { ok: false, message: 'Ese enlace no sirve: usa https://… o un URI como spotify:' };
  return addApp({ name, type: 'link', target, aliases: [] });
}

function updateApp(value = {}) {
  const list = appList();
  const index = list.findIndex((a) => sameName(a.name, value.name));
  if (index < 0) return { ok: false, message: 'Esa app ya no está.' };
  const next = { ...list[index] };
  if (value.aliases != null) next.aliases = value.aliases;
  if (CLOSE_MODES.includes(value.close)) next.close = value.close;
  const entry = normalizeApp(next);
  if (!entry) return { ok: false, message: 'No se pudo guardar.' };
  list[index] = entry;
  saveApps(list);
  appLog(`app updated ${entry.name} aliases=${entry.aliases.join('|') || '-'} close=${entry.close}`);
  return { ok: true, name: entry.name };
}

function removeApp(name) {
  const list = appList();
  const next = list.filter((a) => !sameName(a.name, name));
  if (next.length === list.length) return { ok: false, message: 'Esa app ya no está.' };
  saveApps(next);
  appLog(`app removed ${name}`);
  return { ok: true };
}

function appsMenuState() {
  return appList().map((a) => ({
    name: a.name,
    type: a.type,
    typeLabel: TYPE_LABEL[a.type] || a.type,
    aliases: a.aliases,
    close: a.close,
    closeLabel: CLOSE_LABEL[a.close] || a.close,
    target: a.type === 'steam' ? `steam ${a.target}` : a.target,
    processes: a.processes,
    windows: a.windows || null,
    dir: a.dir || null,
    title: a.title || null,
  }));
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
  goodnight.cancel();
  followUp.cancel();
  sendCommand('sleep'); // DORMANT, and the chat bubble goes with it
  if (lms?.status() === 'booting') await lms.whenReady(); // a load in flight would land anyway
  gameHadLlm = lms?.status() === 'ready';
  voice?.stop(); // the sidecar holds OmniVoice: stopping it hands the VRAM back
  await lms?.unloadAll?.();
  gameLog(`game on after unload ${vramText()}`);
  if (config.load().gaming?.drone !== false) {
    sendCommand('game-drone', { on: true });
    gameLog(`drone visible ${vramText()}`);
  }
}

async function gameLeave() {
  gameLog(`game off ${vramText()}`);
  sendCommand('game-drone', { on: false });
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
  if (String(cfg.voice?.replyMode || 'blips').toLowerCase() !== 'voice') return false;
  const kind = String(cfg.voice?.tts || 'off').toLowerCase();
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

// MODELO (Paso 4K): who answers her. Switching keeps LM Studio's model apart, so coming back to it
// doesn't cost a re-download; the key never leaves its own encrypted file.
function setChatProvider(id) {
  if (!PROVIDERS[id]) return { ok: false, message: 'Ese proveedor no existe.' };
  const cfg = config.load();
  const from = String(cfg.llm?.provider || 'local');
  if (id === from) return { ok: true };
  const next = switchProvider(cfg.llm || {}, id, PROVIDERS);
  const patch = { provider: next.provider, model: next.model, models: next.models };
  if (id === 'local') patch.localModel = next.model;
  updateConfig({ llm: patch });
  return { ok: true };
}

function setChatModel(value) {
  const provider = String(config.load().llm?.provider || 'local');
  const model = String(value?.model ?? value ?? '').trim().slice(0, 120);
  if (!model) return { ok: false, message: 'Falta el nombre del modelo.' };
  const next = setProviderModel(config.load().llm || {}, provider, model);
  updateConfig({
    llm: {
      model: next.model,
      models: next.models,
      ...(provider === 'local' ? { localModel: model } : {}),
    },
  });
  return { ok: true, model };
}

function setChatKey(value) {
  const provider = String(value?.provider || config.load().llm?.provider || 'local');
  if (!PROVIDERS[provider] || PROVIDERS[provider].local) return { ok: false, message: 'Ese proveedor no usa clave.' };
  const saved = saveLlmKey(provider, value?.key);
  return { ok: true, hasKey: saved, message: saved ? 'Clave guardada.' : 'Clave borrada.' };
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
    case 'reply-mode': updateConfig({ voice: { replyMode: String(value || 'blips') } }); break;
    case 'music-player':
      updateConfig({ music: { player: ['namida', 'spotify', 'none'].includes(value) ? value : 'namida' } });
      break;
    case 'model-provider': return setChatProvider(value);
    case 'model-set': return setChatModel(value);
    case 'model-key': return setChatKey(value);
    case 'model-share': updateConfig({ llm: value }); break;
    case 'render':
      if (parseRenderMode(value) !== value) return { ok: false, message: 'Esa opción de pantalla no existe.' };
      config.save({ render: value });
      app.relaunch(); // read once, when Chromium starts
      app.exit(0);
      break;
    case 'spotify-connect':
      updateConfig({ music: { spotify: { clientId: String(value || '').trim().slice(0, 100) } } });
      return connectSpotify(value);
    case 'spotify-disconnect':
      spotifyAccessToken = null;
      spotifyTokens().clear();
      break;
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
    case 'drone-mode': updateConfig({ gaming: { drone: Boolean(value) } }); break;
    case 'comments': updateConfig({ comments: { enabled: Boolean(value) } }); break;
    case 'comments-range': updateConfig({ comments: {
      ...(value?.minMinutes != null ? { minMinutes: Number(value.minMinutes) } : {}),
      ...(value?.maxMinutes != null ? { maxMinutes: Number(value.maxMinutes) } : {}),
    } }); break;
    case 'greetings': updateConfig({ behavior: { greetings: Boolean(value) } }); break;
    case 'unlock-greeting': updateConfig({ behavior: { unlockGreeting: Boolean(value) } }); break;
    case 'caresses': updateConfig({ behavior: { caresses: Boolean(value) } }); break;
    case 'music-dance': updateConfig({ behavior: { musicDance: Boolean(value) } }); break;
    case 'compact-mode': break; // removed: ignore legacy menu / config compact
    case 'app-fx': updateConfig({ fx: { apps: Boolean(value) } }); break;
    case 'scanlines': updateConfig({ fx: { scanlines: Boolean(value) } }); break;
    case 'persona-reload': {
      const r = llm.reloadPersona();
      sendCommand('line', {
        badge: 'MEM',
        text: r.ok ? 'Personalidad recargada. Soy más yo que antes.' : 'No pude releer persona.md.',
      });
      break;
    }
    case 'persona-open': {
      const file = userFiles?.persona?.path;
      if (file) shell.openPath(file);
      break;
    }
    case 'memory-open': {
      const file = userFiles?.memory?.path;
      if (file) shell.openPath(file);
      break;
    }
    case 'clip-save': goClipReply({ chat: false }); break;
    case 'do-something': sendCommand('do-something'); break;
    case 'fix-add': saveFix(value?.heard, value?.meant); break;
    case 'fix-remove': dropFix(value); break;
    case 'menu-keyboard': menuKeyboardOn(Boolean(value)); break;
    case 'wake-sensitivity':
      updateConfig({ voice: { wakeThreshold: thresholdFromPct(value) } }); // live: the sidecar gets the new config
      break;
    case 'talk-hotkey': return setTalkHotkey(value);
    case 'apps-pick-program': return pickProgram().catch((err) => ({ ok: false, message: `No se pudo: ${err.message}` }));
    case 'apps-add-link': return addLink(value);
    case 'apps-update': return updateApp(value);
    case 'apps-remove': return removeApp(value);
    case 'apps-test': return { ok: true, text: apps().dryRun(value) };
    case 'apps-rescan': return rescanApps();
    case 'apps-promote': return promoteApp(value);
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
    case 'quit': return askQuit({ chat: false });
    case 'quit-answer': return answerQuit(value);
    default: break;
  }
}

let overlayFolded = false;
let registeredShortcuts = [];
let menuCloseCombo = ''; // the shortcut that closes her menu, as registered

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
  // Close her menu: the first of these that's free (another app may hold Ctrl+Alt+M)
  menuCloseCombo = '';
  for (const combo of [s.menuClose, 'Ctrl+Alt+Shift+M', 'Ctrl+Alt+F12']) {
    if (!combo || menuCloseCombo) continue;
    try {
      if (globalShortcut.register(combo, () => menuGuard.forceClose('shortcut'))) {
        registeredShortcuts.push(combo);
        menuCloseCombo = combo;
      }
    } catch { /* a bad combo in config.json: the next one */ }
  }
  logEvent(voiceLogPath(), `[capri] close-menu shortcut: ${menuCloseCombo || 'none free'}`);
  rebuildTray(); // the tray shows the combo that's really there
  talkCombo = '';
  const talk = talkHotkey(config.load());
  if (talk && registerTalk(talk)) talkCombo = talk;
}

// Push to talk (OÍDO in her menu, hearing.talkHotkey): she listens right away, as if you had
// said "hey Jarvis". DORMANT, she wakes up first.
let talkCombo = '';

function talkHotkey(cfg) {
  return normalizeAccelerator(cfg.hearing?.talkHotkey) || normalizeAccelerator(cfg.shortcuts?.talk) || 'Ctrl+Alt+V';
}

function talkNow() {
  // Ctrl+Alt+V toggles: once more stops listening
  if (voiceListening) {
    voice?.pttStop();
    return;
  }
  if (voiceMic.needed && !voiceMic.open) {
    // the mic could not open: say why instead of looking dead
    if (voiceMic.message) logEvent(voiceLogPath(), `[capri] mic unavailable: ${voiceMic.message}`);
    sendCommand('line', {
      badge: 'MIC',
      text: 'No pude abrir el micrófono. Revisa el dispositivo en OÍDO.',
    });
    return;
  }
  llm?.cancel();
  speakQueue?.stop();
  goodnight.cancel();
  followUp.cancel();
  if (overlayFolded) sendCommand('wake');
  voice?.pttStart();
}

function registerTalk(combo) {
  try {
    if (globalShortcut.register(combo, talkNow)) {
      registeredShortcuts.push(combo);
      return true;
    }
    console.error(`[capri] shortcut already taken: ${combo}`);
  } catch (err) {
    console.error(`[capri] bad shortcut "${combo}": ${err.message}`);
  }
  return false;
}

function unregisterTalk(combo) {
  if (!combo) return;
  try { globalShortcut.unregister(combo); } catch { /* already gone */ }
  registeredShortcuts = registeredShortcuts.filter((c) => c !== combo);
}

// A new combo from her menu: { key, code, ctrlKey, altKey, shiftKey, metaKey } or { accel }.
// { ok, accel } or { ok: false, message } in Spanish for her menu.
function setTalkHotkey(value) {
  const accel = value?.accel != null ? normalizeAccelerator(value.accel) : acceleratorFromKey(value || {});
  if (!accel) return { ok: false, message: 'Esa no sirve: Ctrl, Alt o Win más una tecla.' };
  const cfg = config.load();
  if (accel === talkCombo) return { ok: true, accel };
  const others = [
    [cfg.shortcuts?.toggle, 'mostrar / ocultar'],
    [cfg.shortcuts?.chat, 'abrir el chat'],
    [cfg.clips?.saveHotkey, 'guardar clip'],
  ];
  const clash = others.find(([combo]) => sameCombo(combo, accel));
  if (clash) return { ok: false, message: `${accel} ya es «${clash[1]}».` };
  const old = talkCombo;
  unregisterTalk(old);
  if (!registerTalk(accel)) {
    if (old && registerTalk(old)) talkCombo = old;
    return { ok: false, message: `${accel} ya lo usa otra app.` };
  }
  talkCombo = accel;
  config.save({ hearing: { talkHotkey: accel } });
  rebuildTray();
  return { ok: true, accel };
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
      replyMode: String(cfg.voice?.replyMode || 'blips'),
      locked: Boolean(cfg.position?.locked),
      theme: cfg.ui?.theme === 'capri' ? 'capri' : 'cyberpunk',
      gaming: {
        mode: cfg.gaming?.mode === 'off' ? 'off' : 'auto',
        drone: cfg.gaming?.drone !== false,
      },
      comments: {
        enabled: cfg.comments?.enabled !== false,
        minMinutes: Number(cfg.comments?.minMinutes) || 20,
        maxMinutes: Number(cfg.comments?.maxMinutes) || 40,
      },
      behavior: {
        greetings: cfg.behavior?.greetings !== false,
        unlockGreeting: cfg.behavior?.unlockGreeting !== false,
        caresses: cfg.behavior?.caresses !== false,
        musicDance: cfg.behavior?.musicDance !== false,
      },
      appFx: cfg.fx?.apps !== false,
      scanlines: cfg.fx?.scanlines !== false,
      musicPlayer: ['namida', 'spotify', 'none'].includes(cfg.music?.player) ? cfg.music.player : 'namida',
      render: parseRenderMode(cfg.render),
    },
    hearing: {
      fixes: cleanFixes(cfg.hearing?.fixes),
      lastHeard,
      sensitivity: pctFromThreshold(cfg.voice?.wakeThreshold),
      sensMin: SENS_MIN,
      sensMax: SENS_MAX,
      sensStep: SENS_STEP,
      talkHotkey: talkCombo || talkHotkey(cfg),
      talkActive: Boolean(talkCombo),
      followUpSec: followUpSec(cfg),
      wakePhrase: wakePhraseLabel(
        cfg.voice?.wakeModel,
        path.join(resolveVoiceModelsRoot(cfg), 'models'),
      ),
    },
    music: {
      clientId: String(cfg.music?.spotify?.clientId || ''),
      connected: Boolean(spotifyAccessToken),
    },
    model: (() => {
      const id = String(cfg.llm?.provider || 'local');
      return {
        provider: PROVIDERS[id] ? id : 'local',
        providers: providerOptions(),
        model: String(cfg.llm?.model || ''),
        local: !isCloud(id),
        hasKey: Boolean(llmKey(id)),
        shareScreen: cfg.llm?.shareScreen === true,
        shareMemory: cfg.llm?.shareMemory === true,
      };
    })(),
    apps: appsMenuState(),
    found: {
      at: scanned().at || null,
      scanning: Boolean(scanRunning),
      counts: scanned().counts || null,
      items: foundApps().map((a) => ({
        name: a.name,
        source: a.source,
        sourceLabel: appScan.SOURCE_LABEL[a.source] || a.source,
        typeLabel: TYPE_LABEL[a.type] || a.type,
        target: a.type === 'steam' ? `steam ${a.target}` : a.target,
      })),
    },
    clips: {
      hotkey: cfg.clips?.saveHotkey || 'Alt+F10',
      folder: clipFolderLabel(cfg),
    },
    shortcuts: [
      { label: 'Mostrar / ocultar Capri', accel: cfg.shortcuts?.toggle || '' },
      { label: 'Abrir el chat', accel: cfg.shortcuts?.chat || '' },
      { label: 'Escuchar / detener', accel: talkCombo || talkHotkey(cfg) },
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
    // always there: her menu stuck open can't hold the screen
    { label: t.closeMenu, accelerator: menuCloseCombo || undefined, click: () => menuGuard.forceClose('tray') },
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
  tray.setToolTip(`Capri — ${talkCombo || talkHotkey(config.load())} escucha / detiene`);
  tray.on('click', () => sendCommand('status'));
  rebuildTray();
}

function registerIpc() {
  ipcMain.on('overlay:interactive', (_e, on) => setClickThrough(!on));
  ipcMain.on('overlay:rearm', () => rearmOverlay()); // the pointer moved over her and she never heard of it
  ipcMain.on('appfx:hit', (_e, id) => appFx.hit(id));
  ipcMain.on('overlay:menu', (_e, open) => menuGuard.menuChanged(Boolean(open)));
  ipcMain.on('overlay:beat', (_e, state) => menuGuard.beat(state && typeof state === 'object' ? state : {}));
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
  ipcMain.on('menu:open', () => {
    if (!trayMenu) rebuildTray();
    try {
      trayMenu?.popup({ window: overlay });
    } catch (err) {
      console.error('[capri] tray menu:', err.message);
    }
  });
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
    const result = applyMenuAction(payload.id, payload.value);
    return result && typeof result === 'object' ? result : { ok: true };
  });
  ipcMain.on('settings:close', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  });
  ipcMain.handle('settings:open', (_e, tab = null) => openSettingsTab(tab || null));
  // artist handoff stills → %USERPROFILE%\Desktop\capri-art-kit\shots\
  ipcMain.handle('art:capture', async (_e, payload = {}) => {
    if (!overlay || overlay.isDestroyed()) return { ok: false, error: 'no overlay' };
    const dir = path.join(process.env.USERPROFILE || app.getPath('home'), 'Desktop', 'capri-art-kit', 'shots');
    fs.mkdirSync(dir, { recursive: true });
    const name = String(payload.name || 'frame').replace(/[^\w.-]+/g, '_');
    const image = await overlay.webContents.capturePage();
    const file = path.join(dir, `${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  });
  // her hello at boot: the overlay shows it, and it plays from the cached wav if there is one
  greeting = async function greeting({ unlock = false } = {}) {
    const cfg = config.load();
    if (cfg.behavior?.greetings === false || (unlock && cfg.behavior?.unlockGreeting === false)) return null;
    const now = Date.now();
    if (now - lastGreetingAt < GREETING_COOLDOWN_MS) {
      logEvent(voiceLogPath(), `[capri] greeting skipped cooldown reason=${unlock ? 'unlock' : 'boot'}`);
      return null;
    }
    const picked = pickGreeting({ last: config.load().greeting?.last || null });
    config.save({ greeting: { last: picked.id } });
    lastGreetingAt = now;
    logEvent(voiceLogPath(), `[capri] greeting ${unlock ? 'unlock' : 'start'} id=${picked.id}`);
    let text = picked.text;
    if (llm) {
      let generated = null;
      await new Promise((resolve) => {
        llm.chat({
          user: unlock ? 'Salúdame brevemente porque acabo de desbloquear la computadora.' : 'Salúdame brevemente al iniciar.',
          onToken: () => {},
          onDone: ({ text: value }) => { generated = String(value || '').trim(); resolve(); },
          onError: () => resolve(),
        });
      });
      if (generated && generated.length <= 180) text = generated;
      else logEvent(voiceLogPath(), '[capri] greeting fallback local');
    }
    if (voiceReplyOn()) speakLine(text);
    if (unlock) sendCommand('line', { badge: 'ONLINE', text });
    return { ...picked, text };
  };
  ipcMain.handle('greet', async () => {
    if (bootGreetingDone) return null;
    bootGreetingDone = true;
    return greeting();
  });
  ipcMain.handle('llm:status', () => (
    isCloud(config.load().llm?.provider) ? 'ready' : lms?.status() || 'ready'
  ));
  ipcMain.on('systemfx:done', (_e, id) => systemFxWaiters.get(Number(id))?.());
  ipcMain.handle('chat:send', async (_e, text) => {
    const line = String(text || '').trim();
    if (!line || !overlay) return { ok: false };
    // her "¿seguro que apago la compu?" waiting for this answer (Paso 4G)
    const powerAnswer = await systemFlow.answer(line);
    if (powerAnswer) return { ok: true };
    // her "¿quisiste decir…?" / "¿seguro?" waiting for this answer (Paso 4C)
    const answered = await apps().answer(line);
    if (answered) return appReply(answered);
    const fixOrder = parseFixCommand(line);
    if (fixOrder) {
      const done = goFixReply(fixOrder);
      if (done.line) return done; // said something; a fix that can't be saved (too long) goes to the model
    }
    const powerOrder = await systemFlow.command(line);
    if (powerOrder) return { ok: true };
    const musicOrder = parseMusicCommand(line, { herSong: config.load().music?.herSong });
    if (musicOrder) return musicReply(musicOrder);
    if (isSleepCommand(line)) return goSleepReply();
    if (quitConfirm.pending) return answerQuit(line);
    if (isQuitCommand(line)) return askQuit({ chat: true });
    if (isClipCommand(line)) return goClipReply();
    if (isMuteCommand(line)) return goMicReply(false);
    if (isUnmuteCommand(line)) return goMicReply(true);
    if (isForgetCommand(line)) return goForgetReply();
    // typing to her while she's DORMANT (or asking her to wake) brings her back, no model needed
    if (overlayFolded || isWakeCommand(line)) return goWakeReply();
    const appOrder = await apps().command(line); // "abre Discord", "cierra Spotify"
    if (appOrder) return appReply(appOrder);
    // the local stack is only waited for when it is the one who answers
    if (!isCloud(config.load().llm?.provider)) {
      const boot = await lms.whenReady();
      if (boot === 'failed') {
        overlay.webContents.send('chat:error', { kind: 'offline', text: 'No pude despertar LM Studio. Revisa que esté instalado y vuelve a intentarlo.' });
        return { ok: false };
      }
    }
    const speakId = ttsOn() ? speakQueue?.start() : 0;
    if (!speakId) speakQueue?.stop();
    llmBusy = true;
    let said = '';
    let outcome = null;
    try {
      outcome = await llm.chat({
        user: line,
        onMood: (name) => speakQueue?.setMood?.(name),
        onToken: (piece) => {
          said += typeof piece === 'string' ? piece : piece?.text || '';
          overlay?.webContents.send('chat:token', piece);
          if (speakId) speakQueue?.feed(piece);
        },
        onDone: (payload) => {
          if (speakId) {
            if (payload?.mood) speakQueue?.setMood?.(payload.mood);
            speakQueue?.flush(speakId);
          }
          overlay?.webContents.send('chat:done', payload);
          followUp.reply(payload?.text || said, { spoken: Boolean(speakId) });
          if (payload?.action) void runReplyAction(payload.action);
        },
        onError: (payload) => {
          if (speakId) speakQueue?.stop(speakId);
          followUp.reply('', {});
          overlay?.webContents.send('chat:error', payload);
        },
      });
    } finally {
      llmBusy = false;
      // who answered and how it went, with no key and no text of the answer (Paso 4K)
      if (outcome) logEvent(voiceLogPath(), `[capri] llm ${outcome.provider}/${outcome.model} ${outcome.outcome}: ${outcome.ms}ms`);
    }
    return { ok: true };
  });
  ipcMain.on('chat:cancel', () => {
    llm?.cancel();
    speakQueue?.stop();
    followUp.cancel();
  });
  ipcMain.on('voice:interrupt', () => {
    llm?.cancel();
    speakQueue?.stop();
    followUp.cancel();
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
  if (route === 'eval') {
    // what her page says about itself (menu, click-through...), for smoke tests
    return { ok: true, value: await overlay.webContents.executeJavaScript(String(body.js || 'null')), clickThrough };
  }
  if (route === 'force-close-menu') {
    menuGuard.forceClose('debug');
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

// How her window is drawn, read before Chromium starts (menu › COMPORTAMIENTO › Pantalla).
function applyRender() {
  const { software, switches } = renderSwitches(config.load().render);
  for (const [name, value] of switches) {
    if (value == null) app.commandLine.appendSwitch(name);
    else app.commandLine.appendSwitch(name, value);
  }
  if (software) app.disableHardwareAcceleration();
}

function main() {
  applyRender();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => sendCommand('status'));
  if (process.platform === 'win32') app.setAppUserModelId('capri.desktop');

  app.whenReady().then(async () => {
    restoreSpotifyToken();
    serveProtocol();
    registerIpc();
    userFiles = ensureUserFiles({ userData: app.getPath('userData'), root: ROOT });
    llm = createLlm({
      loadConfig: () => config.load(),
      personaPath: userFiles.persona.path,
      memoryPath: userFiles.memory.path,
      apiKey: (id) => llmKey(id),
      // what she may tell a cloud provider about your screen, only with the switch on
      screenContext: () => {
        const title = String(lastWindows?.fgTitle || '').trim();
        const exe = String(lastWindows?.fgExe || '').split(/[\\/]/).pop();
        return [exe, title && `«${title}»`].filter(Boolean).join(' ');
      },
      onFallback: (line) => sendCommand('box-log', { kind: 'sistema', text: line }),
      ensureLocal: () => lms?.whenReady(),
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
        if (payload?.type === 'transcript') {
          if (payload.followUp) comments?.heard();
          followUp.heard({ followUp: Boolean(payload.followUp) });
        }
        followUp.onVoiceEvent(payload);
        if (payload?.type === 'stopped' && payload.quiet) {
          logEvent(voiceLogPath(), '[capri] follow-up closed: nobody answered');
          comments?.missed();
        }
        if (payload?.type === 'tts_state') ttsLoading = payload.state === 'loading';
        if (payload?.type === 'talking') voiceTalking = true;
        if (payload?.type === 'talking_done' || payload?.type === 'stopped') {
          voiceTalking = false;
          speechOver(); // her goodbye before a power-off is over (Paso 4G)
        }
        if (payload?.type === 'listening') {
          voiceListening = true;
          openChat();
        }
        if (payload?.type === 'stopped') voiceListening = false;
        if (payload?.type === 'mic') {
          voiceMic = {
            open: payload.open !== false,
            needed: payload.needed !== false,
            message: String(payload.message || ''),
          };
        }
        if (payload?.type === 'devices') rebuildTray();
        goodnight.onVoiceEvent(payload); // her goodnight line over: now she folds
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
        && ttsOn()
        && !voiceTalking
        && !llmBusy
        && !gameMode?.active()
        && !goodnight.pending
      ),
      minMs: () => commentRange(config.load().comments?.minMinutes, 20),
      maxMs: () => commentRange(config.load().comments?.maxMinutes, 40),
      onLine: (line, kind) => {
        if (!line) return;
        llm?.rememberAssistant?.(line);
        const spoken = Boolean(speakLine(line));
        sendCommand('line', { badge: COMMENT_BADGE[kind] || 'CAPRI', text: line });
        if (spoken) followUp.listenAfter(line);
      },
      onIgnored: (line) => {
        if (!line) return;
        const spoken = Boolean(speakLine(line));
        sendCommand('line', { badge: 'CAPRI', text: line });
        if (spoken) followUp.listenAfter(line);
      },
      onError: (err, phase) => logEvent(voiceLogPath(), `[capri] ${phase} comment failed: ${err.message}`),
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
        const cfg = config.load();
        comments?.observe(cfg.llm?.shareScreen === true
          ? windowContext(data, { apps: cfg.gaming?.apps || [] })
          : null);
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
    setTimeout(() => seedAppTable().catch((err) => appLog(`apps seed failed: ${err.message}`)), 5000);
    setTimeout(scanIfStale, 20000); // after her voice is up: the disk is busy enough before
    setTimeout(() => maybeOpenSetupHint().catch((err) => logEvent(voiceLogPath(), `[capri] setup hint failed: ${err.message}`)), 2500);

    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
    // after sleep or a locked screen, once Windows has settled
    powerMonitor.on('resume', () => setTimeout(() => recoverAfterUnlock('resume'), 2000));
    // a sidecar that slept with the audio devices open can leave Windows with no sound at all:
    // stop it as the PC goes down and start it fresh once Windows has its devices back
    powerMonitor.on('suspend', () => {
      if (!voice) return;
      logEvent(voiceLogPath(), '[capri] voice sidecar stopped: PC suspending');
      voice.stop();
    });
    powerMonitor.on('resume', () => setTimeout(() => {
      if (!voice) return;
      logEvent(voiceLogPath(), '[capri] voice sidecar restarted after resume');
      voice.stop();
      voice.start();
    }, 4000));
    powerMonitor.on('unlock-screen', () => setTimeout(() => {
      recoverAfterUnlock('unlock');
      // Greeting after the UI is free: never leave the overlay holding focus over Ajustes.
      Promise.resolve(greeting?.({ unlock: true })).catch((err) => {
        logEvent(voiceLogPath(), `[capri] greeting timer failed: ${err.message}`);
      });
    }, 1000));
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
