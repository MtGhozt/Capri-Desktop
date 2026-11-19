'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage, powerMonitor, dialog, safeStorage, clipboard, desktopCapturer,
} = require('electron');

const config = require('./config');
const state = require('./state');
const { reviveMigratedTts } = require('./config');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch, restoreForeground } = require('./windows');
const { createLlm } = require('./llm');
const {
  PROVIDERS, providerOptions, isAgent, defaultBaseUrl, BRAIN_GROUPS, FREE_KEY_LINKS, OWN_KEY_LINKS,
  providerAfterKeyRemoved, supportsVision, provider, activeBrainIds,
} = require('./chat-providers');
const {
  captureScreenJpeg, createCaptureShield, keepCaptureFile, shouldAutoLook, AUTO_LOOK_MS,
} = require('./screen-look');
const { gameAppKey, windowedGameInFront } = require('./game-detect');
const { probeProvider } = require('./llm-probe');
const { checkForUpdate } = require('./updates');
const { detectAgents, pickAuto, openAgentIds, runAgent } = require('./agent-brain');
const { switchProvider, setProviderModel, modelForProvider } = require('./chat-models');
const { renderSwitches, HINTS: RENDER_HINTS, SOFTWARE_CONFIRM } = require('./render-mode');
const { createLms } = require('./lms');
const { createVoice, checkVoiceDir, resolveVoiceDir } = require('./voice');
const { createVoiceInstall, PYTHON_URL, voiceInstallDir, hasNvidiaGpu } = require('./voice-install');
const { VC_URL, VC_MESSAGE, missingVcRuntime } = require('./vc-runtime');
const { activeVoiceLabel, saveCustomRef, transcriptFor } = require('./voice-ref');
const { createSpeakQueue } = require('./speak');
const {
  createReminders, formatWhen, deliverReminder,
  resolveFireAt, durationText, parseMoveTarget,
} = require('./reminders');
const { createWeather, isWeatherOrHolidayQuestion } = require('./weather');
const pcActions = require('./pc-actions');
const { createQuitFlow } = require('./quit-flow');
const { createGoodnight } = require('./goodnight');
const { bootNotes } = require('./whats-new');
const { checkLine, formatReport, redact } = require('./diagnose');
const { createSystemFlow, runSystem } = require('./system-command');
const { wakePhraseLabel } = require('./wake-phrase');
const { createTokenStore } = require('./spotify');
const { createMusicWiring } = require('./music-wiring');
const { createAppsWiring } = require('./apps-wiring');
const { pickLine, fillLine } = require('./lines-es');
const { addFix, removeFix, cleanFixes } = require('./fixes');
const { readTranscript } = require('./fix-command');
const { stripWakeWord, wakeTranscriptOk, isSttHallucination } = require('./command-text');
const { GREETINGS, pickGreeting } = require('./greetings');
const { windowContext } = require('./context');
const { createComments } = require('./comments');
const { createGameMode, FOCUS_LOSS_DEBOUNCE_MS } = require('./game-mode');
const { createGameQuiet } = require('./game-quiet');
const { createGameWindow } = require('./game-window');
const { createMenuState } = require('./menu-state');
const { createReplies } = require('./replies');
const { createTurn } = require('./turn');
const { createMenuActions } = require('./menu-actions');
const { registerOverlayIpc } = require('./ipc-overlay');
const { registerSettingsIpc } = require('./ipc-settings');
const { registerVoiceIpc } = require('./ipc-voice');
const { registerMiscIpc } = require('./ipc-misc');
const {
  normalizeGamingMode, gameCommentVoiceReady, canGameComment, gameCommentKind,
} = require('./game-comment');
const { vramText } = require('./vram');
const {
  recommendProfile, detectHardware, hardwareFingerprint, shouldOfferBubble,
  applyPatch, bubbleLine, matchesConfig,
} = require('./recommend-profile');
const { logEvent, voiceLogPath } = require('./log');
const { createTurnTiming, currentTurn, fromSidecar } = require('./timing');
const turns = createTurnTiming({ log: (line) => logEvent(voiceLogPath(), line) });
const { createChatVisible } = require('./chat-visible');
const { saveClip, clipFolderLabel } = require('./clips');
const { micActive, voiceStatus: ttsStatus } = require('./voice-config');
const { createFollowUp, readMs } = require('./follow-up');
const {
  SENS_MIN, SENS_MAX, SENS_STEP, pctFromThreshold,
  normalizeAccelerator, acceleratorFromKey, sameCombo, shortcutConflict,
} = require('./hearing');
const { createAppFx } = require('./app-fx');
const { createMenuGuard } = require('./menu-guard');
const { createRendererRecover } = require('./renderer-recover');
const { toOverlayRect } = require('./rects');
const appScan = require('./app-scan');
const hooks = require('../../scripts/install-hooks');
const { createAssistants } = require('./assistants');
const demoSteps = require('../../scripts/demo-sequence');
const { createSettingsWindow } = require('./settings-window');
const { ensureUserFiles } = require('./user-files');
const { needsModelSetup, probeLocalLlm, SETUP_HINT } = require('./setup');

const ROOT = path.resolve(__dirname, '..', '..');
const assistants = createAssistants({ root: ROOT });
// Silently rewrite any old Capri Antigravity hooks.json that still has the quoted command form.
// Must run before any agent-install IPC so the user never sees the broken form again.
assistants.repairOnStartup();
const DEV = process.argv.includes('--dev');
const E2E = process.env.CAPRI_E2E === '1' || process.env.CAPRI_E2E === 'true';
const PORT = Number(process.env.CAPRI_PORT) || 47823;
// Public escape hatch: always registered, no confirm (see README "Si Capri se traba").
const FORCE_QUIT_ACCEL = 'Ctrl+Alt+Shift+Q';
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
let voiceInstall = null;
let lastAutoLookAt = 0;
let autoLookTimer = null;
let speakQueue = null;
let comments = null;
let voiceListening = false;
let quietWake = false; // the capture running now began as an auto wake over a game
let voiceMic = { open: true, needed: true, message: '' };
let voiceQueue = [];
const chatVisible = createChatVisible({ log: (line) => logEvent(voiceLogPath(), `[capri] ${line}`) });
let previousForeground = null;
let menuKeyboard = false; // her menu has a text field open (Corregir lo último): it needs the keyboard
let gameMode = null;
let gameWindow = null;
// A game on the screen: no show()/focus()/moveTop(), click-through stays on (game-quiet.js).
const gameQuiet = createGameQuiet({ isActive: () => Boolean(gameMode?.active()) });
let reminders = null;
let weather = null;
let greeting = null;
let whatsNewLines = null; // this boot's "what's new" lines, once only
let userFiles = null;

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
  if (gameQuiet.active()) return; // a game owns the screen: clicks stay passed through
  overlay.setIgnoreMouseEvents(false);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  fitOverlay();
  setTimeout(() => {
    if (!overlay || overlay.isDestroyed() || menuGuard.menuOpen) return;
    setClickThrough(true, 'rearm');
  }, 0);
  sendCommand('rearmed'); // click-through again: she waits for the pointer to be on her
  console.log('[capri] mouse hook set up again');
}

// Win+L / sleep freezes heartbeats and Windows drops global shortcuts. Reset so the quick menu
// and Ajustes are not stuck under an interactive fullscreen overlay with a dead Esc hook.
// Same root cause as the look/drag freeze: busy/dragging can stay true across the lock, so
// refreshHit keeps the overlay interactive over the whole desktop — rearm alone is not enough.
function recoverAfterUnlock(reason = 'unlock') {
  if (!overlay || overlay.isDestroyed()) return;
  logEvent(voiceLogPath(), `[capri] recover after ${reason}`);
  menuGuard.forceClose(reason);
  menuKeyboardOn(false);
  if (chatVisible.get()) closeChat('unlock');
  else {
    overlay.setFocusable(false);
    overlay.showInactive();
  }
  // Clear busy/drag + reapply click-through (look/speak fault path). 'rearmed' alone leaves them.
  resetOverlayInput(reason);
  rearmOverlay();
  // force Esc re-bind: Windows drops the accelerator on the lock screen while we still think it's ours
  takeEscape(false);
  raiseOverlay();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    try { settingsWindow.moveTop(); settingsWindow.focus(); } catch { /* gone */ }
  }
}

function resyncOverlay(reason = 'resync') {
  if (!overlay || overlay.isDestroyed()) return;
  logEvent(voiceLogPath(), `[capri] overlay resync after ${reason}`);
  recoverAfterUnlock(reason);
}

// Back on top of everything, the taskbar included (it comes up over her when it's clicked). Twice:
// the taskbar can come up again a moment later, as its menus and previews open.
function raiseOverlay() {
  if (gameQuiet.active()) return; // never moveTop() over a game
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
  overlay.showInactive();
  logEvent(voiceLogPath(), `[capri] startup window show visible=${overlay.isVisible()} opacity=${overlay.getOpacity()} render=${config.load().render}`);
  // always shown: put away, she's still there as her biochip in the corner. Sized again first:
  // Windows keeps a new window inside the work area, and resting on the taskbar it covers it too.
  overlay.once('ready-to-show', () => {
    fitOverlay();
    overlay.showInactive();
    logEvent(voiceLogPath(), `[capri] startup ready-to-show visible=${overlay.isVisible()} opacity=${overlay.getOpacity()}`);
    if (!menuGuardTimer) menuGuardTimer = setInterval(() => menuGuard.tick(), 2000);
    for (const payload of voiceQueue) overlay.webContents.send('voice:event', payload);
    voiceQueue = [];
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
    rendererRecover.gone(details.reason);
  });
  // a stalled page can't take clicks back from the screen: give them back / reload once
  overlay.webContents.on('unresponsive', () => {
    rendererRecover.unresponsive();
  });
  overlay.webContents.on('responsive', () => {
    logEvent(voiceLogPath(), '[capri] renderer responsive again');
    rendererRecover.reset();
  });
  overlay.webContents.on('did-finish-load', () => {
    fitOverlay();
    overlay.showInactive();
    logEvent(voiceLogPath(), `[capri] startup did-finish-load visible=${overlay.isVisible()} opacity=${overlay.getOpacity()}`);
    rendererRecover.reset();
    for (const payload of voiceQueue) overlay.webContents.send('voice:event', payload);
    voiceQueue = [];
  });
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
let lastThrough = null; // last value written to the log: hover flips it on every click
let handedBackAt = 0; // when she last gave the keyboard back to the window before her
let quitSolid = false; // ¿Salir? visible: ignoreMouseEvents stays off until clear + grace
let lastInteractive = null; // last hover state she acted on: an unchanged ask costs nothing
function setClickThrough(on, reason = 'state') {
  clickThrough = Boolean(on);
  // Anything but hover moved her: the next hover ask has to be applied, not deduped away.
  if (reason !== 'hover-on' && reason !== 'hover-off') lastInteractive = null;
  if (!overlay || overlay.isDestroyed()) return;
  // ¿Salir? / open menu: never re-enable ignoreMouseEvents (hover can stay false after Win+L).
  // A game owns the screen: clicks always pass through, whatever she last asked for.
  const through = gameQuiet.active()
    ? true
    : (quitSolid || menuGuard?.menuOpen) ? false : clickThrough;
  // Hover can flip dozens of times/sec at the hit edge — only act (and log) on real changes.
  if (through === lastThrough) return;
  lastThrough = through;
  if (reason !== 'hover-on' && reason !== 'hover-off' && reason !== 'heartbeat') {
    logEvent(voiceLogPath(), `[capri] click-through ${through ? 'on' : 'off'} reason=${reason}`);
  }
  if (through) overlay.setIgnoreMouseEvents(true, { forward: true });
  else overlay.setIgnoreMouseEvents(false);
}

function trayNotice(text) {
  const line = String(text || '').trim();
  if (!line) return;
  logEvent(voiceLogPath(), `[capri] tray notice: ${line}`);
  try { tray?.displayBalloon?.({ title: 'Capri', content: line }); } catch { /* tray gone */ }
}

// Crash / hang: reload once, then tray notice — never loop forever holding the desktop.
const rendererRecover = createRendererRecover({
  reload: () => {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.webContents.reloadIgnoringCache();
  },
  notice: trayNotice,
  log: (line) => logEvent(voiceLogPath(), line),
  setClickThrough,
});

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
  onMenu: (open) => {
    takeEscape(open);
    if (open) {
      overlay?.setFocusable(true);
      setClickThrough(false, 'menu-open');
      try { overlay?.focus(); } catch { /* focus can fail during unlock */ }
    } else {
      if (!chatVisible.get() && !menuKeyboard) {
        overlay?.setFocusable(false);
        setClickThrough(true, 'menu-close');
      }
    }
  },
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

function openChat(source = 'overlay') {
  if (!overlay) return;
  if (gameQuiet.active()) return; // no show()/focus() and no chat while a game is on
  if (!chatVisible.get()) previousForeground = captureForeground();
  chatVisible.set(true, source);
  overlay.setFocusable(true);
  overlay.show();
  overlay.focus();
  setClickThrough(clickThrough);
  sendCommand('chat', { on: true });
}

function closeChat(source = 'overlay') {
  const wasOpen = chatVisible.get();
  chatVisible.set(false, source);
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
  if (on && gameQuiet.active()) return; // never pull the window up over a game
  if (on) {
    if (!menuKeyboard && !chatVisible.get()) previousForeground = captureForeground();
    menuKeyboard = true;
    overlay.setFocusable(true);
    overlay.show();
    overlay.focus();
    setClickThrough(clickThrough);
    return;
  }
  if (!menuKeyboard) return;
  menuKeyboard = false;
  if (chatVisible.get()) return; // the chat still has it
  const target = previousForeground;
  previousForeground = null;
  handedBackAt = Date.now();
  if (target != null) restoreForeground(target);
  overlay.setFocusable(false);
  overlay.showInactive();
  setClickThrough(clickThrough);
}

function toggleChat() {
  if (chatVisible.get()) closeChat('shortcut');
  else openChat('shortcut');
}

function toggleVisible(force) {
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  if (!visible && chatVisible.get()) closeChat('stow');
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
  return {
    ...cfg,
    idle,
    lang: resolveLang(cfg.lang),
    langSetting: cfg.lang,
    dev: DEV,
    e2e: E2E,
    whatsNew: whatsNewLines,
    floorGap: overlayArea().gap,
  };
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
    && !state.overlayFolded
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
// The current user turn is on the async context; greetings and comments are not, so they stay untimed.
function startSpeakTurn() {
  if (!voiceReplyOn() || !speakQueue) return 0;
  const turn = currentTurn();
  const speakId = speakQueue.start(turn) || 0;
  if (speakId && turn && voice?.connected?.()) turns.expectAudio(turn);
  return speakId;
}

function speakLine(line) {
  const speakId = startSpeakTurn();
  if (!speakId) return 0;
  speakQueue.feed(line);
  speakQueue.flush(speakId);
  return speakId;
}

async function runAgentAsBrain(providerId, user, persona) {
  const cfg = config.load();
  const installed = detectAgents();
  const kind = PROVIDERS[providerId]?.agent || 'auto';
  const open = openAgentIds([
    { title: lastWindows?.fgTitle, process: lastWindows?.fgExe },
    ...(lastWindows?.wins || []).map((w) => ({ title: w.title, process: w.exe || w.process })),
  ]);
  const id = kind === 'auto'
    ? pickAuto({ installed, openIds: open, preferred: cfg.llm?.agentPreferred })
    : kind;
  if (!id) throw Object.assign(new Error('No hay un agente CLI listo en el PATH.'), { offline: true });
  const windows = (lastWindows?.wins || [])
    .map((w) => [w.exe || w.process, w.title].filter(Boolean).join(' — '))
    .filter(Boolean)
    .slice(0, 12);
  const context = [
    lastWindows?.fgTitle && `Ventana activa: ${lastWindows.fgTitle}`,
    windows.length && `Apps/ventanas abiertas: ${windows.join(' | ')}`,
  ].filter(Boolean).join('\n');
  return runAgent({ id, prompt: context ? `${user}\n\n${context}` : user, persona, installed });
}

let pendingUpdate = null;

async function runUpdateCheck({ force = false } = {}) {
  const cfg = config.load();
  const now = Date.now();
  const result = await checkForUpdate({
    localVersion: app.getVersion(),
    skippedVersion: cfg.updates?.skippedVersion,
    enabled: force ? true : cfg.updates?.enabled !== false,
    lastCheck: force ? 0 : cfg.updates?.lastCheck,
    now,
  });
  if (result.checked) updateConfig({ updates: { lastCheck: now } });
  if (result.error) {
    appLog(`updates check failed: ${result.error}`);
    return force ? { ok: false, message: 'No pude mirar GitHub ahora.' } : { ok: true };
  }
  if (!result.update) {
    return force ? { ok: true, message: 'Ya estás al día.' } : { ok: true };
  }
  pendingUpdate = result.update;
  sendCommand('update-ask', {
    text: `¡Salió Capri v${result.update.version}! ¿Querés actualizar?`,
    version: result.update.version,
    url: result.update.url,
  });
  return { ok: true, update: result.update };
}

function answerUpdatePrompt(value) {
  const update = pendingUpdate;
  pendingUpdate = null;
  const answer = String(value || '');
  if (answer === 'yes' && update?.url) {
    shell.openExternal(update.url);
    return { ok: true };
  }
  if (answer === 'skip' && update?.version) {
    updateConfig({ updates: { skippedVersion: update.version } });
    return { ok: true };
  }
  return { ok: true }; // later
}

let pendingProfile = null;

function maybeOfferProfile({ force = false } = {}) {
  if (gameQuiet.active()) return { ok: true, skipped: 'game' };
  const cfg = config.load();
  const hw = detectHardware();
  if (!hw) return { ok: true, skipped: 'detect' };
  const rec = recommendProfile(hw);
  if (force && matchesConfig(cfg, rec)) {
    sendCommand('line', { badge: 'PERFIL', text: 'Ya estás en el perfil que te conviene.' });
    return { ok: true, skipped: 'match' };
  }
  if (!shouldOfferBubble({
    cfg,
    rec,
    hw,
    force,
    firstRun: !cfg.welcomed,
    gameQuiet: gameQuiet.active(),
  })) {
    return { ok: true, skipped: 'no-offer' };
  }
  pendingProfile = { rec, hw };
  sendCommand('profile-ask', { text: bubbleLine(rec) });
  return { ok: true, offered: true };
}

function answerProfilePrompt(value) {
  const pending = pendingProfile;
  pendingProfile = null;
  if (!pending?.rec || !pending?.hw) return { ok: true };
  const answer = String(value || '');
  if (answer === 'apply') {
    updateConfig(applyPatch(pending.rec));
    return { ok: true, applied: true };
  }
  if (answer === 'dismiss') {
    updateConfig({ profile: { dismissedHw: hardwareFingerprint(pending.hw) } });
    return { ok: true, dismissed: true };
  }
  return { ok: true };
}

// One of her direct-command lines (lines-es.js), said and shown where the command came from:
// her chat bubble, or the panel when it came from her menu or the tray.
function announce(line, opts) {
  const spoken = Boolean(speakLine(line));
  followUp.reply(line, { spoken }); // a question to what you said: she listens for the answer
  return showLine(line, opts);
}

function showLine(line, { chat = false, badge = 'CAPRI', hold } = {}) {
  if (chat) {
    overlay?.webContents.send('chat:token', line);
    overlay?.webContents.send('chat:done', { text: line });
  } else {
    sendCommand('line', { badge, text: line, ...(hold ? { hold } : {}) });
  }
  return line;
}

function commandReply(kind, opts) {
  return announce(pickLine(kind), opts);
}

// Everything she answers to an order: her lines, the PC and music paths, timers (replies.js).
const replies = createReplies({
  announce,
  showLine,
  commandReply,
  speakLine,
  followUp,
  goodnight,
  sendCommand,
  updateConfig,
  apps,
  allApps: () => allApps(),
  askQuit,
  saveFix,
  dropFix,
  getMusic: () => music,
  getSystemFlow: () => systemFlow,
  getReminders: () => reminders,
  getWeather: () => weather,
  getSettingsWindow: () => settingsWindow,
  getLlm: () => llm,
});
const {
  pcReply, musicReply, runReplyAction, goSleepReply, goWakeReply, goForgetReply, goNameReply,
  goWhatsNewReply, goMicReply, goFixReply, goClipReply, goReminderReply, refreshSettingsMenu,
  weatherFallbackLine, reminderLabel, applyReminderEventMove, GAME_BAR_CLIP_HOTKEY,
} = replies;

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

function resolveVoiceModelsRoot(cfg = config.load()) {
  const raw = cfg?.voice?.dir;
  if (raw != null && String(raw).trim()) return path.resolve(String(raw).trim());
  return path.join(ROOT, 'voice');
}

// Real exit: stop the voice sidecar first (will-quit also does; do it here so it can't linger),
// then app.quit(). A delayed exit covers anything that holds the process open.
function doQuit() {
  try { voice?.stop(); } catch { /* already gone */ }
  app.quit();
  setTimeout(() => {
    try { app.exit(0); } catch { /* process already exiting */ }
  }, 1500);
}

let quitChat = false;
let quitSolidTimer = 0;
function setQuitSolid(on) {
  if (quitSolidTimer) {
    clearTimeout(quitSolidTimer);
    quitSolidTimer = 0;
  }
  if (on) {
    if (gameQuiet.active()) return; // ¿Salir? never comes up over a game
    quitSolid = true;
    if (!overlay || overlay.isDestroyed()) return;
    setClickThrough(false);
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setFocusable(true);
    overlay.show();
    try { overlay.focus(); } catch { /* focus can fail mid-quit */ }
    return;
  }
  // restore normal click-through only after the confirm closes (+~300 ms)
  quitSolidTimer = setTimeout(() => {
    quitSolidTimer = 0;
    quitSolid = false;
    if (!overlay || overlay.isDestroyed()) return;
    if (!chatVisible.get() && !menuKeyboard) overlay.setFocusable(false);
    setClickThrough(clickThrough);
  }, 300);
}
const quitFlow = createQuitFlow({
  quit: doQuit,
  onAsk: () => {
    const line = pickLine('salirPreguntar');
    const spoken = Boolean(speakLine(line));
    followUp.reply(line, { spoken });
    if (quitChat) showLine(line, { chat: true, badge: 'SALIR' });
    setQuitSolid(true);
    sendCommand('quit-ask', { text: line });
  },
  onCancel: () => {
    announce(pickLine('salirCancelado'), { chat: quitChat, badge: 'SALIR' });
  },
  onClear: () => {
    sendCommand('quit-clear');
    setQuitSolid(false);
  },
});

function askQuit({ chat = false } = {}) {
  quitChat = Boolean(chat);
  return quitFlow.ask();
}

function answerQuit(value) {
  return quitFlow.answer(value);
}

// -- what she hears wrong (Paso 4A) --------------------------------------------------------

const hearingFixes = () => cleanFixes(config.load().hearing?.fixes);

// A transcript from the sidecar, read with her fixes. An order about the fixes themselves is left
// as said: "cuando digo jarbis quiero decir Jarvis" must still say jarbis.
function hearTranscript(payload) {
  const said = String(payload?.text || '');
  // Known Whisper noise (YouTube outros, Amara…): never become a turn.
  if (said.trim() && isSttHallucination(said)) {
    logEvent(voiceLogPath(), `[capri] stt hallucination dropped: ${JSON.stringify(said.trim().slice(0, 200))}`);
    return { ...payload, missed: true };
  }
  // A whisper wake must open with "Capri": video speech that mentions her midway is not an order.
  if (payload?.wake === 'whisper' && !wakeTranscriptOk(said)) {
    logEvent(voiceLogPath(), `[capri] wake miss: heard ${JSON.stringify(said.slice(0, 200))} (no Capri at the start)`);
    return { ...payload, missed: true };
  }
  const read = readTranscript(said, hearingFixes());
  if (!read.order && said.trim()) state.lastHeard = said.trim();
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

// -- her apps (Paso 4C) ---------------------------------------------------------------------
// "abre Discord", "cierra Spotify": straight from her table (config apps.list), no model.
// The table, the scan and the dialogs live in apps-wiring.js.

const appsWiring = createAppsWiring({
  log: (text) => appLog(text),
  announce,
  sendCommand,
  zap: (rect) => appFx.zap(rect),
  spark: (app) => appFx.spark(app),
  getOverlay: () => overlay,
});
const {
  apps, appReply, allApps, seedAppTable, scanned, scanIfStale, foundApps, promoteApp, rescanApps,
  addLink, updateApp, removeApp, pickProgram, pickFolderOrFile, appsMenuState, getScanRunning,
} = appsWiring;

// Spotify's tokens and the music player wiring (music-wiring.js).
const musicWiring = createMusicWiring({
  allApps: () => allApps(),
  rebuildTray,
  showLine,
});
const { music, connectSpotify, disconnectSpotify, restoreSpotifyToken, hasToken: hasSpotifyToken } = musicWiring;

// Cloud chat keys, kept encrypted with your Windows account in their own file: never in config.json,
// never in a log (Paso 4K). Same store as Spotify's tokens.
const llmKeysFile = () => path.join(app.getPath('userData'), 'llm-keys');
const llmKeys = () => createTokenStore({ file: llmKeysFile(), safeStorage });
function llmKey(id) {
  return String(llmKeys().read()?.[id] || '');
}
function saveLlmKey(id, key) {
  const all = llmKeys().read();
  // A file we cannot decrypt keeps every key in it: writing just this one would wipe the rest.
  if (!all && fs.existsSync(llmKeysFile())) {
    console.error('[capri] llm-keys could not be decrypted; left it untouched');
    return null;
  }
  const next = all || {};
  const clean = String(key || '').trim();
  if (clean) next[id] = clean;
  else delete next[id];
  llmKeys().write(next);
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
  // First-run: pick free Gemini so the Gratis card shows it selected (recomendado).
  if (String(config.load().llm?.provider || 'local') === 'local') setChatProvider('gemini');
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
const appLog = (text) => logEvent(voiceLogPath(), `[capri] ${text}`);

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

// "abrí Descargas": a folder or any file, opened through the shell like a .lnk.
// Ajustes › AUDIO: her voice folder chosen with a dialog instead of hand-editing config.json.
// A folder that cannot run (no server.py / no .venv) is refused and the config is left alone.
async function pickVoiceDir() {
  const res = await dialog.showOpenDialog(overlay, {
    title: 'Carpeta de voz',
    properties: ['openDirectory'],
  });
  const chosen = !res.canceled && res.filePaths?.[0];
  if (!chosen) return { ok: false, message: '' };
  const check = checkVoiceDir(chosen);
  if (!check.ok) return check;
  await voice?.stop(); // applyConfig below brings it back up on the new folder
  updateConfig({ voice: { dir: check.dir, ...reviveMigratedTts(config.load().voice) } });
  const says = String(config.load().voice?.replyMode || 'blips') === 'voice' ? '' : ' Elegí VOZ en Respuesta para que te hable.';
  return { ok: true, message: `Voz en ${path.basename(check.dir)}.${says}` };
}

// Ajustes › AUDIO › Instalar voz: sources → %LOCALAPPDATA%\capri-desktop\voice, then setup.ps1.
async function runVoiceInstall(value = {}) {
  if (!voiceInstall) return { ok: false, message: 'Instalador de voz no listo.' };
  const result = await voiceInstall.start({
    omniVoice: value?.omniVoice == null ? undefined : Boolean(value.omniVoice),
  });
  if (!result.ok) {
    return {
      ok: false,
      needPython: Boolean(result.needPython),
      message: result.error || 'Error al instalar la voz.',
      pythonUrl: PYTHON_URL,
    };
  }
  const dir = result.dir || voiceInstall.dir();
  const check = checkVoiceDir(dir);
  if (!check.ok) return { ok: false, message: check.message || 'La voz no quedó usable.' };
  await voice?.stop();
  state.ttsLoading = true;
  state.lastTts = { engine: 'omnivoice', state: 'loading' };
  updateConfig({
    voice: {
      dir: check.dir,
      noticeShown: true,
      ...(result.omniVoice ? { tts: 'auto' } : {}),
    },
  });
  voice?.start({ force: true });
  return {
    ok: true,
    needVc: Boolean(result.needVc),
    message: result.needVc ? VC_MESSAGE : 'Voz instalada',
    dir: check.dir,
  };
}

// After look/speak/hide: never leave the overlay eating the desktop or stuck click-through.
function resetOverlayInput(reason = 'reset') {
  if (!overlay || overlay.isDestroyed()) return;
  try {
    if (!overlay.isVisible()) overlay.showInactive();
  } catch { /* gone */ }
  // show()/hide() can desync ignoreMouseEvents from our clickThrough flag — reapply.
  setClickThrough(clickThrough);
  sendCommand('input-reset', { reason: String(reason || 'reset') });
}

// Phase 6C: JPEG in memory. Win32 uses setContentProtection so Capri stays visible and out of the shot.
// The screen she captures is the one with the window in front, not wherever the mouse is resting:
// a second monitor showing only the wallpaper (and the "Activar Windows" watermark) was the bug.
function lookDisplay() {
  const rect = lastWindows?.fgRect;
  const dip = rect && typeof screen.screenToDipRect === 'function'
    ? screen.screenToDipRect(null, { x: rect.x, y: rect.y, width: rect.w, height: rect.h })
    : null;
  return (dip && screen.getDisplayMatching(dip))
    || screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    || targetDisplay();
}

// Where an older build left the shot even though the consent text says it stays in memory.
function captureFilePath() {
  return path.join(path.dirname(voiceLogPath()), 'last-capture.jpg');
}

async function snapScreenForLook() {
  const display = lookDisplay();
  const displayIndex = screen.getAllDisplays().findIndex((d) => d.id === display?.id);
  const shield = createCaptureShield({
    platform: process.platform,
    setContentProtection: (on) => {
      if (!overlay || overlay.isDestroyed()) throw new Error('no overlay');
      overlay.setContentProtection(Boolean(on));
    },
    hide: () => {
      if (!overlay || overlay.isDestroyed()) return;
      overlay.hide();
    },
    show: () => {
      if (!overlay || overlay.isDestroyed()) return;
      overlay.showInactive();
    },
    reapplyClickThrough: () => {
      if (!overlay || overlay.isDestroyed()) return;
      setClickThrough(clickThrough);
    },
  });
  try {
    let captured = null;
    const image = await captureScreenJpeg({
      getSources: (opts) => desktopCapturer.getSources(opts),
      displayId: display?.id,
      displayIndex,
      attempts: 3,
      retryDelayMs: 150,
      beforeCapture: () => shield.before(),
      afterCapture: () => shield.after(),
      onCapture: (info) => { captured = info; },
    });
    logEvent(voiceLogPath(), `[capri] screen capture time=${Date.now()} display=${captured?.displayId || display?.id || '?'} size=${captured?.size?.width || 0}x${captured?.size?.height || 0} brain=pending image=${image ? 'attached' : 'none'}`);
    if (!image) return null;
    keepCaptureFile({
      image,
      file: captureFilePath(),
      debugSave: config.load().voice?.debugSave === true,
    });
    return image;
  } catch (err) {
    try { shield.after(); } catch { /* already cleaned */ }
    resetOverlayInput('look-capture-error');
    throw err;
  }
}

function sayWithoutLlm(text) {
  const line = String(text || '').trim();
  if (!line || !overlay) return;
  openChat('say');
  const speakId = startSpeakTurn();
  if (!speakId) speakQueue?.stop();
  overlay.webContents.send('chat:token', line);
  overlay.webContents.send('chat:done', { text: line });
  if (speakId) {
    speakQueue?.feed(line);
    speakQueue?.flush(speakId);
  }
}

function armAutoLook() {
  if (autoLookTimer) {
    clearInterval(autoLookTimer);
    autoLookTimer = null;
  }
  const cfg = config.load();
  if (!cfg.llm?.autoLook || !cfg.llm?.shareScreen) return;
  autoLookTimer = setInterval(() => {
    void maybeAutoLook();
  }, 60_000);
}

async function maybeAutoLook() {
  const cfg = config.load();
  let idleSeconds = 0;
  try { idleSeconds = powerMonitor.getSystemIdleTime(); } catch { idleSeconds = 0; }
  if (!shouldAutoLook({
    enabled: cfg.llm?.autoLook === true,
    shareScreen: cfg.llm?.shareScreen === true,
    lastAt: lastAutoLookAt,
    intervalMs: AUTO_LOOK_MS,
    gameActive: Boolean(gameMode?.active?.()),
    fullscreen: Boolean(lastWindows?.fgFull),
    idleSeconds,
  })) return;
  const id = String(cfg.llm?.provider || 'local');
  const model = String(cfg.llm?.model || provider(id).model || '');
  if (!supportsVision(id, model) && !isAgent(id)) return;
  if (state.llmBusy || state.overlayFolded || chatVisible.get() || state.voiceTalking) return;
  const image = await snapScreenForLook();
  if (!image) return;
  lastAutoLookAt = Date.now();
  const line = 'Mirá mi pantalla un segundo y comentá algo breve de lo que ves.';
  openChat('look');
  const speakId = voiceReplyOn() ? speakQueue?.start() : 0;
  if (!speakId) speakQueue?.stop();
  state.llmBusy = true;
  try {
    await llm?.chat?.({
      user: line,
      image,
      onMood: (name) => speakQueue?.setMood?.(name),
      onToken: (piece) => {
        overlay?.webContents.send('chat:token', piece);
        if (speakId) speakQueue?.feed(piece);
      },
      onDone: (payload) => {
        // text before audio: the bubble answers at once even if TTS takes seconds
        overlay?.webContents.send('chat:done', payload);
        if (speakId) {
          if (payload?.mood) speakQueue?.setMood?.(payload.mood);
          speakQueue?.flush(speakId);
        }
      },
      onError: (payload) => {
        if (speakId) speakQueue?.stop(speakId);
        overlay?.webContents.send('chat:error', payload);
      },
    });
  } finally {
    state.llmBusy = false;
  }
}

// Ajustes › AUDIO › Usar mi propia voz: pick a short .wav (transcript typed in the panel).
async function pickVoiceRefWav() {
  const parent = (settingsWindow && !settingsWindow.isDestroyed()) ? settingsWindow : overlay;
  const res = await dialog.showOpenDialog(parent, {
    title: 'Tu voz (.wav o transcripción .txt)',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio o transcripción', extensions: ['wav', 'txt'] }],
  });
  const files = !res.canceled ? (res.filePaths || []) : [];
  const file = files.find((item) => /\.wav$/i.test(item)) || files.find((item) => /\.txt$/i.test(item));
  if (!file) return { ok: false, message: '' };
  if (/\.txt$/i.test(file)) {
    const wav = file.replace(/\.txt$/i, '.wav');
    if (!fs.existsSync(wav)) return { ok: false, message: 'No encontré el .wav con el mismo nombre.' };
    return { ok: true, path: wav, transcriptPath: file, transcript: transcriptFor(wav, file) };
  }
  const selectedTxt = files.find((item) => /\.txt$/i.test(item)
    && path.basename(item, path.extname(item)).toLowerCase() === path.basename(file, path.extname(file)).toLowerCase());
  const sidecar = file.replace(/\.wav$/i, '.txt');
  const transcriptPath = selectedTxt || (fs.existsSync(sidecar) ? sidecar : '');
  return { ok: true, path: file, transcriptPath, transcript: transcriptFor(file, transcriptPath) };
}

// Ajustes › AUDIO › Cargar .txt: only the transcript, never the audio.
async function pickVoiceRefText() {
  const parent = (settingsWindow && !settingsWindow.isDestroyed()) ? settingsWindow : overlay;
  const res = await dialog.showOpenDialog(parent, {
    title: 'Transcripción del audio (.txt)',
    properties: ['openFile'],
    filters: [{ name: 'Transcripción', extensions: ['txt'] }],
  });
  const file = !res.canceled && res.filePaths?.[0];
  if (!file) return { ok: false, message: '' };
  return { ok: true, transcript: transcriptFor('', file) };
}

async function saveVoiceRef(value = {}) {
  const cfg = config.load();
  const dir = resolveVoiceDir(ROOT, cfg) || voiceInstall?.dir?.();
  const saved = saveCustomRef({
    voiceDir: dir,
    wavPath: value?.path || value?.wav,
    transcript: value?.transcript ?? value?.text,
    transcriptPath: value?.transcriptPath,
  });
  if (!saved.ok) return saved;
  await voice?.stop();
  state.ttsLoading = true;
  state.lastTts = { engine: 'omnivoice', state: 'loading' };
  updateConfig({
    voice: {
      ttsRef: saved.ttsRef,
      ttsSourceName: saved.sourceName,
      ...reviveMigratedTts(cfg.voice),
      ...(String(cfg.voice?.tts || 'off').toLowerCase() === 'off' ? { tts: 'auto' } : {}),
    },
  });
  voice?.start({ force: true });
  return {
    ok: true,
    message: saved.message || 'Tu voz (archivo) lista.',
    ttsRef: saved.ttsRef,
    sourceName: saved.sourceName,
  };
}

function clearVoiceRef() {
  voice?.stop();
  updateConfig({ voice: { ttsRef: null } });
  voice?.start({ force: true });
  return { ok: true, message: 'Voz por defecto.' };
}

// Whether a spoken line is wanted. Loading TTS does not gate it: the sidecar holds the reply
// until the clone is up, so a reply is never dropped into silence nor spoken by Kokoro.
function voiceReplyOn() {
  const cfg = config.load();
  if (cfg.muted) return false;
  if (String(cfg.voice?.replyMode || 'blips').toLowerCase() !== 'voice') return false;
  const kind = String(cfg.voice?.tts || 'off').toLowerCase();
  return kind !== 'off' && kind !== 'none' && kind !== 'false';
}

// Ajustes › AUDIO: the shared helper (voice-config.js) with what only main knows.
function voiceStatus(cfg) {
  return ttsStatus(cfg, {
    running: voice?.running?.(),
    tts: state.lastTts,
    sleeping: state.overlayFolded,
  });
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
  rebuildTray(); // debounced: settings click bursts rebuild once
  return cfg;
}

// CEREBRO (4K + fase 5): who answers her. Switching keeps each local URL/model apart; the key
// never leaves its own encrypted file.
function setChatProvider(id) {
  if (!PROVIDERS[id]) return { ok: false, message: 'Ese proveedor no existe.' };
  const cfg = config.load();
  const active = activeBrainIds(cfg.llm);
  const enabled = active.includes(id);
  const brains = enabled
    ? active.filter((brain) => brain !== id)
    : (() => {
      const next = active.filter((brain) => brain !== id);
      const localIndex = next.indexOf('local');
      next.splice(localIndex < 0 ? next.length : localIndex, 0, id);
      return next;
    })();
  if (!brains.length) brains.push('local');
  const primary = brains[0];
  const next = switchProvider(cfg.llm || {}, primary, PROVIDERS);
  const patch = { provider: next.provider, brains, model: next.model, models: next.models };
  if (primary === 'local') patch.localModel = next.model;
  // Picking a specific CLI sets the Automático primary for later.
  const agentKind = PROVIDERS[primary].agent;
  if (agentKind && agentKind !== 'auto') patch.agentPreferred = agentKind;
  if (PROVIDERS[primary].local) {
    const urls = { ...(cfg.llm?.baseUrls || {}) };
    const from = String(cfg.llm?.provider || 'local');
    if (PROVIDERS[from]?.local && cfg.llm?.baseUrl) urls[from] = cfg.llm.baseUrl;
    patch.baseUrl = urls[primary] || defaultBaseUrl(primary);
    patch.baseUrls = { ...urls, [primary]: patch.baseUrl };
  }
  updateConfig({ llm: patch });
  return { ok: true };
}

function setChatModel(value) {
  const provider = String(value?.provider || config.load().llm?.provider || 'local');
  const model = String(value?.model ?? value ?? '').trim().slice(0, 120);
  if (!model) return { ok: false, message: 'Falta el nombre del modelo.' };
  const cfg = config.load();
  const next = setProviderModel(cfg.llm || {}, provider, model);
  const patch = {
    models: next.models,
    ...(provider === cfg.llm?.provider ? { model } : {}),
    ...(provider === 'local' ? { localModel: model } : {}),
  };
  if (value?.baseUrl != null && PROVIDERS[provider]?.local) {
    const baseUrl = String(value.baseUrl).trim().replace(/\/+$/, '') || defaultBaseUrl(provider);
    const urls = { ...(cfg.llm?.baseUrls || {}), [provider]: baseUrl };
    if (provider === cfg.llm?.provider) patch.baseUrl = baseUrl;
    patch.baseUrls = urls;
  }
  updateConfig({ llm: patch });
  return { ok: true, model };
}

function reorderBrains(value) {
  const cfg = config.load();
  const brains = activeBrainIds(cfg.llm);
  const index = brains.indexOf(String(value?.id || ''));
  const next = index + (value?.direction === 'up' ? -1 : 1);
  if (index < 0 || next < 0 || next >= brains.length) return { ok: true };
  [brains[index], brains[next]] = [brains[next], brains[index]];
  updateConfig({ llm: { brains, provider: brains[0], model: modelForProvider(cfg.llm, brains[0], PROVIDERS) } });
  return { ok: true };
}

function setChatKey(value) {
  const provider = String(value?.provider || config.load().llm?.provider || 'local');
  if (!PROVIDERS[provider] || PROVIDERS[provider].local) return { ok: false, message: 'Ese proveedor no usa clave.' };
  const saved = saveLlmKey(provider, value?.key);
  if (saved === null) return { ok: false, message: 'No pude leer las claves guardadas; no toqué nada.' };
  if (!saved) {
    // A removed key that was answering hands her to someone who still has one.
    const active = String(config.load().llm?.provider || 'local');
    const next = providerAfterKeyRemoved(active, provider, (pid) => Boolean(llmKey(pid)));
    if (next !== active) setChatProvider(next);
  }
  return { ok: true, hasKey: saved, message: saved ? 'Clave guardada.' : 'Clave borrada.' };
}

async function probeChatFromMenu(value = {}) {
  const id = String(value.provider || config.load().llm?.provider || 'local');
  if (!PROVIDERS[id]) return { ok: false, message: 'Ese proveedor no existe.' };
  if (isAgent(id)) {
    const agents = detectAgents();
    const want = PROVIDERS[id].agent === 'auto'
      ? pickAuto({ installed: agents, preferred: config.load().llm?.agentPreferred })
      : PROVIDERS[id].agent;
    const hit = agents.find((a) => a.id === want);
    if (!hit?.ready) {
      const how = hit?.installHow ? ` Cómo instalarlo: ${hit.installHow}` : '';
      return { ok: false, message: `No encuentro ese agente en el PATH.${how}` };
    }
    setChatProvider(id);
    return { ok: true, message: `Listo. Usaré ${hit.label} (más lento; gasta su plan).` };
  }
  if (value.key != null && !PROVIDERS[id].local) {
    const clean = String(value.key).trim();
    if (clean) saveLlmKey(id, clean);
  }
  if (value.model || value.baseUrl != null) {
    setChatModel({
      provider: id,
      model: value.model || config.load().llm?.model || PROVIDERS[id].model,
      baseUrl: value.baseUrl,
    });
  }
  const cfg = config.load();
  const result = await probeProvider({
    id,
    model: String(cfg.llm?.models?.[id] || (id === 'local' ? cfg.llm?.localModel : null) || PROVIDERS[id].model),
    key: PROVIDERS[id].local ? '' : llmKey(id),
    baseUrl: cfg.llm?.baseUrls?.[id] || cfg.llm?.baseUrl,
  });
  // Capri's line only — never echo the key or the raw server body.
  return { ok: Boolean(result.ok), message: String(result.message || '') };
}

function probePython() {
  return new Promise((resolve) => {
    execFile('py', ['-3.11', '--version'], { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`.trim();
      if (err && !out) return resolve({ ok: false, detail: 'no responde' });
      resolve({ ok: /^Python 3\.11/.test(out), detail: out || 'sin salida' });
    });
  });
}

// The "Diagnóstico" card: a few facts support can act on, no paths and no keys.
async function runDiagnostics() {
  const py = await probePython();
  const vcMissing = missingVcRuntime();
  const agents = detectAgents().filter((a) => a.installed);
  const running = Boolean(voice?.running?.());
  const user = path.basename(process.env.USERPROFILE || os.homedir());
  const checks = [
    { label: 'Python 3.11', ok: py.ok, detail: py.detail },
    { label: 'VC++ 2015-2022 (x64)', ok: !vcMissing, detail: vcMissing ? 'falta vcruntime140.dll' : 'instalado' },
    { label: 'Voz', ok: running, detail: running ? 'sidecar activo' : 'detenida' },
    {
      label: 'Agentes de código',
      ok: agents.length > 0,
      detail: agents.map((a) => a.label).join(', ') || 'ninguno en el PATH',
    },
  ];
  const text = redact(formatReport({
    version: app.getVersion(),
    windows: os.release(),
    log: voiceLogPath(),
    checks,
  }), { user });
  return { checks, lines: checks.map((c) => redact(checkLine(c), { user })), text };
}

// Every menu action, split by domain in menu-actions.js.
const applyMenuAction = createMenuActions({
  sendCommand,
  playDemo,
  toggleVisible,
  updateConfig,
  pickVoiceDir,
  runVoiceInstall,
  pickVoiceRefWav,
  pickVoiceRefText,
  saveVoiceRef,
  clearVoiceRef,
  setChatProvider,
  reorderBrains,
  setChatModel,
  setChatKey,
  probeChatFromMenu,
  runUpdateCheck,
  answerUpdatePrompt,
  maybeOfferProfile,
  answerProfilePrompt,
  runDiagnostics,
  armAutoLook,
  doQuit,
  connectSpotify,
  disconnectSpotify,
  fitOverlay,
  rebuildTray,
  goMicReply,
  goForgetReply,
  pickProgram,
  pickFolderOrFile,
  addLink,
  updateApp,
  removeApp,
  apps,
  rescanApps,
  promoteApp,
  saveFix,
  dropFix,
  setShortcut,
  askQuit,
  answerQuit,
  menuKeyboardOn,
  goSleepReply,
  goWakeReply,
  commandReply,
  goClipReply,
  refreshSettingsMenu,
  applyReminderEventMove,
  reminderLabel,
  runHooks,
  assistants,
  loginItemOptions,
  userSoundsDir,
  DEV,
  getVoiceInstall: () => voiceInstall,
  getGameMode: () => gameMode,
  getGameWindow: () => gameWindow,
  getReminders: () => reminders,
  getWeather: () => weather,
  getLlm: () => llm,
  getUserFiles: () => userFiles,
  getLastWindows: () => lastWindows,
});

let registeredShortcuts = [];
let menuCloseCombo = ''; // the shortcut that closes her menu, as registered
const shortcutActive = { toggle: false, chat: false, talk: false };
const shortcutCombo = { toggle: '', chat: '', talk: '' };

// Ajustes › Atajos edits these; a combo another app already holds stays in config.json as is.
function registerShortcuts() {
  for (const accel of registeredShortcuts) {
    try { globalShortcut.unregister(accel); } catch { /* already gone */ }
  }
  registeredShortcuts = [];
  shortcutActive.toggle = false;
  shortcutActive.chat = false;
  shortcutActive.talk = false;
  shortcutCombo.toggle = '';
  shortcutCombo.chat = '';
  shortcutCombo.talk = '';
  const bind = (accel, run) => {
    const combo = String(accel || '').trim();
    if (!combo) return false;
    try {
      if (globalShortcut.register(combo, run)) {
        registeredShortcuts.push(combo);
        return true;
      }
      console.error(`[capri] shortcut already taken: ${combo}`);
    } catch (err) {
      console.error(`[capri] bad shortcut "${combo}": ${err.message}`);
    }
    return false;
  };
  const s = config.load().shortcuts || {};
  if (bind(s.toggle, () => toggleVisible())) {
    shortcutActive.toggle = true;
    shortcutCombo.toggle = s.toggle;
  }
  if (bind(s.chat, () => toggleChat())) {
    shortcutActive.chat = true;
    shortcutCombo.chat = s.chat;
  }
  // Always on: emergency quit with no confirmation (README "Si Capri se traba").
  bind(FORCE_QUIT_ACCEL, () => doQuit());
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
  talkCombo = '';
  const talk = talkHotkey(config.load());
  if (talk && registerShortcut('talk', talk)) {
    talkCombo = talk;
    shortcutActive.talk = true;
    shortcutCombo.talk = talk;
  }
  rebuildTray(); // the tray shows the combo that's really there
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
  if (state.overlayFolded) sendCommand('wake');
  voice?.pttStart();
}

const shortcutRuns = {
  toggle: () => toggleVisible(),
  chat: () => toggleChat(),
  talk: () => talkNow(),
};

function registerShortcut(id, combo) {
  try {
    if (globalShortcut.register(combo, shortcutRuns[id])) {
      registeredShortcuts.push(combo);
      return true;
    }
    console.error(`[capri] shortcut already taken: ${combo}`);
  } catch (err) {
    console.error(`[capri] bad shortcut "${combo}": ${err.message}`);
  }
  return false;
}

function unregisterShortcut(combo) {
  if (!combo) return;
  try { globalShortcut.unregister(combo); } catch { /* already gone */ }
  registeredShortcuts = registeredShortcuts.filter((c) => c !== combo);
}

// A new combo from her menu: { key, code, ctrlKey, altKey, shiftKey, metaKey } or { accel }.
// { ok, accel } or { ok: false, message } in Spanish for her menu.
function setShortcut(id, value) {
  if (!['toggle', 'chat', 'talk'].includes(id)) {
    return { ok: false, message: 'Ese atajo no se puede cambiar.' };
  }
  const accel = value?.accel != null ? normalizeAccelerator(value.accel) : acceleratorFromKey(value || {});
  if (!accel) return { ok: false, message: 'Esa no sirve: Ctrl, Alt o Win más una tecla.' };
  const cfg = config.load();
  const combos = [
    ['toggle', cfg.shortcuts?.toggle, 'mostrar / ocultar'],
    ['chat', cfg.shortcuts?.chat, 'abrir el chat'],
    ['talk', talkHotkey(cfg), 'escuchar / detener'],
    ['clip', cfg.clips?.saveHotkey, 'guardar clip'],
    ['menu', menuCloseCombo, 'cerrar el menú'],
    ['force', FORCE_QUIT_ACCEL, 'salir de emergencia'],
  ];
  const clash = shortcutConflict(accel, combos, id);
  if (clash) return { ok: false, message: `${accel} ya es «${clash[2]}».` };
  const old = id === 'talk' ? talkCombo : (shortcutActive[id] ? shortcutCombo[id] : '');
  if (old && sameCombo(old, accel)) return { ok: true, accel };
  unregisterShortcut(old);
  if (!registerShortcut(id, accel)) {
    if (old && registerShortcut(id, old)) {
      shortcutCombo[id] = old;
      shortcutActive[id] = true;
    } else {
      shortcutCombo[id] = '';
      shortcutActive[id] = false;
    }
    if (id === 'talk') talkCombo = old && shortcutActive.talk ? old : '';
    return { ok: false, message: `${accel} ya lo usa otra app.` };
  }
  shortcutCombo[id] = accel;
  shortcutActive[id] = true;
  if (id === 'talk') {
    talkCombo = accel;
    config.save({ hearing: { talkHotkey: accel } });
  } else {
    config.save({ shortcuts: { [id]: accel } });
  }
  rebuildTray();
  return { ok: true, accel };
}

const menuState = createMenuState({
  state,
  appScan,
  PORT,
  GAME_BAR_CLIP_HOTKEY,
  shortcutActive,
  assistants,
  resolveLang,
  targetDisplay,
  voiceStatus,
  appsMenuState,
  scanned,
  foundApps,
  loginItemOptions,
  reminderLabel,
  talkHotkey,
  followUpSec,
  resolveVoiceModelsRoot,
  llmKey,
  getVoice: () => voice,
  getVoiceInstall: () => voiceInstall,
  getReminders: () => reminders,
  getLastWindows: () => lastWindows,
  getTalkCombo: () => talkCombo,
  getScanRunning,
  hasSpotifyToken,
});

let trayRebuildTimer = null;
function rebuildTray(immediate = false) {
  if (!tray) return;
  if (!immediate) {
    if (trayRebuildTimer) clearTimeout(trayRebuildTimer);
    trayRebuildTimer = setTimeout(() => {
      trayRebuildTimer = null;
      rebuildTray(true);
    }, 300);
    return;
  }
  if (trayRebuildTimer) {
    clearTimeout(trayRebuildTimer);
    trayRebuildTimer = null;
  }
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
    ...(!s.folded ? [{
      label: s.cfg.visible ? t.hide : t.show,
      accelerator: s.shortcuts.find((k) => k.id === 'toggle')?.accel || undefined,
      click: () => applyMenuAction('visible'),
    }] : []),
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
  rebuildTray(true);
}

const turn = createTurn({
  turns,
  quitFlow,
  announce,
  showLine,
  followUp,
  appReply,
  apps,
  allApps,
  answerQuit,
  askQuit,
  goFixReply,
  goNameReply,
  goWhatsNewReply,
  goReminderReply,
  goSleepReply,
  goWakeReply,
  goClipReply,
  goMicReply,
  goForgetReply,
  pcReply,
  musicReply,
  runReplyAction,
  sayWithoutLlm,
  snapScreenForLook,
  weatherFallbackLine,
  startSpeakTurn,
  resetOverlayInput,
  getSystemFlow: () => systemFlow,
  getSpeakQueue: () => speakQueue,
  getLlm: () => llm,
  getLms: () => lms,
  getOverlay: () => overlay,
});

function registerIpc() {
  greeting = registerVoiceIpc(ipcMain, {
    pickGreeting,
    speakLine,
    voiceReplyOn,
    sendCommand,
    followUp,
    turns,
    getReminders: () => reminders,
    getLlm: () => llm,
    getVoice: () => voice,
    getSpeakQueue: () => speakQueue,
  }).greeting;
  registerSettingsIpc(ipcMain, {
    rendererConfig,
    updateConfig,
    demoWindow,
    runHooks,
    hooks,
    rebuildTray,
    menuState,
    applyMenuAction,
    openSettingsTab,
    targetDisplay,
    userSoundsDir,
    SOUND_EXT,
    CLAUDE_CODE_HELP,
    getOverlay: () => overlay,
    getVoice: () => voice,
    getTray: () => tray,
    getTrayMenu: () => trayMenu,
    getSettingsWindow: () => settingsWindow,
  });
  registerOverlayIpc(ipcMain, {
    state,
    gameQuiet,
    setClickThrough,
    rearmOverlay,
    appFx,
    menuGuard,
    rebuildTray,
    closeChat,
    chatVisible,
    getVoice: () => voice,
    getLastWindows: () => lastWindows,
    getOverlay: () => overlay,
    getLastInteractive: () => lastInteractive,
    setLastInteractive: (value) => { lastInteractive = value; },
  });
  registerMiscIpc(ipcMain, {
    turn,
    systemFxWaiters,
    userSoundsDir,
    SOUND_EXT,
    getLms: () => lms,
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
  // E2E needs a parallel instance against a temp userData; never steal the user's Capri.
  // Packaged Capri and `electron .` share this lock when they share userData (%APPDATA%\capri-desktop).
  // They can still both point voice.dir at the same folder — the sidecar then uses models/.omnivoice.lock.
  if (!E2E && !app.requestSingleInstanceLock()) {
    console.warn('[capri] another Capri is already running (single-instance lock); quitting this process');
    app.quit();
    return;
  }
  if (!E2E) app.on('second-instance', () => sendCommand('status'));
  if (process.platform === 'win32') app.setAppUserModelId('capri.desktop');

  // Main must stay up so the tray / Ctrl+Alt+Shift+Q can still kill a wedged overlay.
  process.on('uncaughtException', (err) => {
    console.error('[capri] uncaughtException:', err);
    try { logEvent(voiceLogPath(), `[capri] uncaughtException: ${err?.stack || err}`); } catch { /* log gone */ }
    try { trayNotice(`Error interno: ${String(err?.message || err).slice(0, 120)}`); } catch { /* tray gone */ }
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[capri] unhandledRejection:', reason);
    try {
      logEvent(voiceLogPath(), `[capri] unhandledRejection: ${reason?.stack || reason}`);
    } catch { /* log gone */ }
  });

  if (E2E) {
    // Playwright drives her; expose an instant quit without going through the menu.
    global.__capriForceQuit = () => doQuit();
  }

  app.whenReady().then(async () => {
    restoreSpotifyToken();
    serveProtocol();
    registerIpc();
    // 0.2.8: an older build wrote the shot here even though consent says it stays in memory.
    keepCaptureFile({ file: captureFilePath(), debugSave: config.load().voice?.debugSave === true });
    // "what's new" once, only after an update: computed before lastSeenVersion moves on
    whatsNewLines = bootNotes({
      version: app.getVersion(),
      lastSeenVersion: config.load().lastSeenVersion,
      configExisted: config.existedAtLoad(),
    });
    if (config.load().lastSeenVersion !== app.getVersion()) config.save({ lastSeenVersion: app.getVersion() });
    userFiles = ensureUserFiles({ userData: app.getPath('userData'), root: ROOT });
    weather = createWeather();
    llm = createLlm({
      loadConfig: () => config.load(),
      personaPath: userFiles.persona.path,
      memoryPath: userFiles.memory.path,
      apiKey: (id) => llmKey(id),
      runAgentChat: ({ provider, user, persona }) => runAgentAsBrain(provider, user, persona),
      temporalExtras: async (cfg, user) => {
        const bits = [];
        if (isWeatherOrHolidayQuestion(user)) {
          try {
            bits.push(await weather.contextSnippet({
              place: cfg.weatherPlace,
              timeZone: cfg.timeZone,
            }));
          } catch { /* offline / bad city: skip */ }
        }
        try {
          bits.push(await pcActions.contextSnippet(user));
        } catch { /* PC probe failed: skip */ }
        return bits.filter(Boolean).join(' ');
      },
      // what she may tell a cloud provider about your screen, only with the switch on
      screenContext: () => {
        const title = String(lastWindows?.fgTitle || '').trim();
        const exe = String(lastWindows?.fgExe || '').split(/[\\/]/).pop();
        const open = (lastWindows?.wins || [])
          .map((w) => [w.exe || w.process, w.title].filter(Boolean).join(' — '))
          .filter(Boolean)
          .slice(0, 12);
        return [
          exe,
          title && `«${title}»`,
          open.length && `Apps/ventanas abiertas: ${open.join(' | ')}`,
        ].filter(Boolean).join('\n');
      },
      onFallback: (line) => sendCommand('box-log', { kind: 'sistema', text: line }),
      ensureLocal: () => lms?.whenReady(),
      localInstalled: () => (lms ? lms.installed() : undefined),
    });
    lms = createLms({
      loadConfig: () => config.load(),
      onStatus: (state) => overlay?.webContents.send('llm:boot', { state }),
    });
    lms.start();
    voiceInstall = createVoiceInstall({
      root: ROOT,
      version: () => app.getVersion(),
      onProgress: (state) => {
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          settingsWindow.webContents.send('voice:install', state);
        }
      },
      // The same lines "Ver detalles" shows, in voice.log (logEvent redacts secrets).
      onLine: (line) => logEvent(voiceLogPath(), `[capri] voice install: ${line}`),
    });
    const managedVoiceDir = path.resolve(voiceInstallDir());
    const configuredVoiceDir = String(config.load().voice?.dir || '').trim();
    if (configuredVoiceDir && path.resolve(configuredVoiceDir).toLowerCase() === managedVoiceDir.toLowerCase()) {
      try {
        voiceInstall.syncManaged({
          destRoot: managedVoiceDir,
          onSync: (rel) => logEvent(voiceLogPath(), `[capri] synced managed voice source: ${rel}`),
        });
      } catch (err) {
        logEvent(voiceLogPath(), `[capri] managed voice source sync failed: ${err.message}`);
      }
    }
    voice = createVoice({
      root: ROOT,
      loadConfig: () => config.load(),
      markNoticeShown: () => config.save({ voice: { noticeShown: true } }),
      onEvent: (event) => {
        const t = TRAY[resolveLang(config.load().lang)];
        const payload = event?.type === 'transcript'
          ? hearTranscript(event)
          : event?.type === 'voice-missing'
            ? { type: 'notice', level: 'info', message: t.voiceMissing }
            : event?.type === 'voice-failed'
              ? { type: 'notice', level: 'error', message: t.voiceFailed }
              : event?.type === 'vc-missing'
                ? { type: 'notice', level: 'error', badge: 'VC++', message: VC_MESSAGE, url: VC_URL }
                : event;
        if (payload?.missed) return; // background audio said "Capri", she was not called
        if (payload?.type === 'transcript') {
          if (payload.turn) turns.stashVoice(payload.turn, payload.stt);
          if (payload.followUp) comments?.heard();
          followUp.heard({ followUp: Boolean(payload.followUp) });
        }
        followUp.onVoiceEvent(payload);
        if (payload?.type === 'stopped' && payload.quiet) {
          logEvent(voiceLogPath(), '[capri] follow-up closed: nobody answered');
          comments?.missed();
        }
        if (payload?.type === 'tts_state') {
          state.ttsLoading = payload.state === 'loading';
          state.lastTts = {
            engine: String(payload.engine || ''),
            state: String(payload.state || ''),
            // engine=off reason=sleeping is intentional DORMANT, not a failed start.
            reason: String(payload.reason || (payload.engine === 'off' && state.overlayFolded ? 'sleeping' : '')),
          };
          // replyMode=voice with nothing to speak with: the technical reason is already in the log
          // (sidecar side); say which state was reached and why she stays quiet.
          const quiet = voiceStatus(config.load());
          if (quiet) logEvent(voiceLogPath(), `[capri] replyMode=voice, tts engine=${state.lastTts.engine || '?'} state=${state.lastTts.state || '?'}: ${quiet}`);
        }
        if (payload?.type === 'talking') {
          state.voiceTalking = true;
          if (payload.turn) turns.noteAudio(payload.turn, fromSidecar(payload));
        }
        if (payload?.type === 'talking_done' || payload?.type === 'stopped') {
          if (payload?.type === 'talking_done' && payload.turn && !payload.interrupted) {
            turns.noteAudio(payload.turn, fromSidecar(payload), { done: true });
          }
          state.voiceTalking = false;
          speechOver(); // her goodbye before a power-off is over (Paso 4G)
        }
        if (payload?.type === 'listening') {
          voiceListening = true;
          // An auto wake while a game owns the screen: its capture runs, nothing shows.
          quietWake = Boolean(gameMode?.active()) && payload.wake === true;
          openChat('wake'); // gated inside: no focus or chat while a game is on
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
        // The wake listen and the line it heard never reach the renderer over a game: no
        // unfold, no chat. PTT and follow-up carry no wake marker and keep flowing.
        const hideWake = quietWake
          || (payload?.type === 'transcript' && Boolean(payload.wake) && gameMode?.active());
        if (!hideWake) {
          if (overlay?.webContents && !overlay.webContents.isDestroyed() && !overlay.webContents.isLoading()) {
            overlay.webContents.send('voice:event', payload);
          } else {
            voiceQueue.push(payload);
          }
        }
        if (payload?.type === 'transcript') quietWake = false; // that capture had its say
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
        && !state.overlayFolded
        && !chatVisible.get()
        && !state.ttsLoading
        && voiceReplyOn()
        && !state.voiceTalking
        && !state.llmBusy
        && !gameMode?.active()
        && !goodnight.pending
      ),
      minMs: () => commentRange(config.load().comments?.minMinutes, 20),
      maxMs: () => commentRange(config.load().comments?.maxMinutes, 40),
      onLine: (line, kind) => {
        if (!line) return;
        const spoken = Boolean(speakLine(line));
        // only the follow-up window may reuse this line; it never becomes history
        if (spoken && followUpSec(config.load()) > 0) {
          llm?.rememberComment?.(line, readMs(line) + followUpSec(config.load()) * 1000 + 6000);
        }
        sendCommand('line', { badge: COMMENT_BADGE[kind] || 'CAPRI', text: line });
        if (spoken) followUp.listenAfter(line);
      },
      onIgnored: (line) => {
        if (!line) return;
        const spoken = Boolean(speakLine(line));
        if (spoken && followUpSec(config.load()) > 0) {
          llm?.rememberComment?.(line, readMs(line) + followUpSec(config.load()) * 1000 + 6000);
        }
        sendCommand('line', { badge: 'CAPRI', text: line });
        if (spoken) followUp.listenAfter(line);
      },
      onError: (err, phase) => logEvent(voiceLogPath(), `[capri] ${phase} comment failed: ${err.message}`),
    });
    voice.prepareGreetings(GREETINGS);
    voice.start();
    gameWindow = createGameWindow({
      config,
      logEvent,
      voiceLogPath,
      vramText,
      setClickThrough,
      gameQuiet,
      getOverlay: () => overlay,
      getGameMode: () => gameMode,
      sendCommand,
      llm,
      goodnight,
      followUp,
      normalizeGamingMode,
      speakLine,
      pickLine,
      lms,
      gameCommentVoiceReady,
      canGameComment,
      gameCommentKind,
      windowContext,
      getLastWindows: () => lastWindows,
      speakQueue,
      currentTurn,
      voice,
      state,
    });
    gameMode = createGameMode({
      enabled: () => normalizeGamingMode(config.load().gaming?.mode) !== 'off',
      apps: () => config.load().gaming?.apps || [],
      setWakeMuted: (on) => voice?.setWakeMuted?.(on),
      exitDelayMs: FOCUS_LOSS_DEBOUNCE_MS, // focus must be gone 10 s: a flicker never ends game mode
      onDecision: (decision) => gameWindow.log(`game decision=${decision.reason} rule=${decision.rule} exe=${decision.exe || '?'} full=${decision.full}`),
      onEnter: (windows) => gameWindow.enter(windows),
      onExit: () => gameWindow.leave(),
    });
    createTray();
    comments.start();
    armAutoLook();
    reminders = createReminders({
      file: path.join(app.getPath('userData'), 'reminders.json'),
      fire: (item, { missed }) => {
        let line = fillLine(pickLine('recordatorio'), { text: item.text });
        if (missed) {
          line = item.count > 1
            ? `Se me pasaron ${item.count} cosas: ${item.text}`
            : `Se me pasó avisarte: ${item.text}`;
        } else if (item.count > 1) {
          line = `Te recuerdo ${item.count} cosas: ${item.text}`;
        }
        deliverReminder({
          line,
          noMolestar: Boolean(gameMode?.active?.()),
          speak: (text) => speakLine(text),
          // long enough to read: the bubble auto-hides on its own hold
          show: (text) => showLine(text, { badge: 'RECORDATORIO', hold: Math.max(6000, readMs(text)) }),
        });
      },
    });
    // the overlay needs a moment before her first line can land in the bubble
    setTimeout(() => reminders?.start(), 3000);
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
        const gameApps = cfg.gaming?.apps || [];
        // Comment + fullscreen game, or a known windowed game: keep Capri above (no game-mode enter).
        if (gameMode?.active() && normalizeGamingMode(cfg.gaming?.mode) === 'comment') {
          gameQuiet.pin(overlay);
        } else if (!gameMode?.active() && windowedGameInFront(data, gameApps)) {
          gameQuiet.pin(overlay);
        }
        gameWindow?.comment(); // comment mode: voice-only, respects interval + quiet gates
        comments?.observe(cfg.llm?.shareScreen === true
          ? windowContext(data, { apps: gameApps })
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
      log: appLog,
      onDebug: DEV ? debugHandler : null,
    });
    registerShortcuts();
    setTimeout(() => seedAppTable().catch((err) => appLog(`apps seed failed: ${err.message}`)), 5000);
    setTimeout(scanIfStale, 20000); // after her voice is up: the disk is busy enough before
    setTimeout(() => maybeOpenSetupHint().catch((err) => logEvent(voiceLogPath(), `[capri] setup hint failed: ${err.message}`)), 2500);
    setTimeout(() => runUpdateCheck().catch((err) => appLog(`updates check failed: ${err.message}`)), 8000);
    // after welcome / what's-new: one optional profile bubble (never over a game / first run)
    setTimeout(() => {
      try { maybeOfferProfile(); } catch (err) { appLog(`profile offer failed: ${err.message}`); }
    }, 12000);
    // warm CLI PATH cache so Ajustes › Cerebro does not stall the first open
    setTimeout(() => { try { detectAgents(); } catch { /* PATH oddities */ } }, 2500);

    // Unlock often reshuffles bounds/DPI; re-fit and reapply ignoreMouseEvents (show/hide desync).
    screen.on('display-metrics-changed', () => {
      resyncOverlay('display-metrics-changed');
    });
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
    // after sleep or a locked screen, once Windows has settled; Win+L emits both events.
    let unlockResyncTimer = 0;
    let unlockResyncAfter = null;
    const scheduleUnlockResync = (reason, after = null) => {
      if (after) unlockResyncAfter = after;
      if (unlockResyncTimer) clearTimeout(unlockResyncTimer);
      unlockResyncTimer = setTimeout(() => {
        unlockResyncTimer = 0;
        const done = unlockResyncAfter;
        unlockResyncAfter = null;
        resyncOverlay(reason);
        done?.();
      }, 500);
    };
    powerMonitor.on('resume', () => scheduleUnlockResync('resume'));
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
    powerMonitor.on('unlock-screen', () => scheduleUnlockResync('unlock', () => {
      // Greeting after the UI is free: never leave the overlay holding focus over Ajustes.
      Promise.resolve(greeting?.({ unlock: true })).catch((err) => {
        logEvent(voiceLogPath(), `[capri] greeting timer failed: ${err.message}`);
      });
    }));
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    windowWatch?.stop();
    gameMode?.stop();
    reminders?.stop();
    comments?.stop();
    voice?.stop();
    lms?.unload();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
