'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, powerMonitor, clipboard,
} = require('electron');

const config = require('./config');
const state = require('./state');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch } = require('./windows');
const { createLlm } = require('./llm');
const {
  PROVIDERS, providerOptions, BRAIN_GROUPS, FREE_KEY_LINKS, OWN_KEY_LINKS,
  provider,
} = require('./chat-providers');
const {
  keepCaptureFile,
} = require('./screen-look');
const { gameAppKey, windowedGameInFront } = require('./game-detect');
const { detectAgents, pickAuto, openAgentIds, runAgent } = require('./agent-brain');
const { renderSwitches, HINTS: RENDER_HINTS, SOFTWARE_CONFIRM } = require('./render-mode');
const { createLms } = require('./lms');
const { createVoice } = require('./voice');
const { createVoiceInstall, voiceInstallDir, hasNvidiaGpu } = require('./voice-install');
const { VC_URL, VC_MESSAGE, missingVcRuntime } = require('./vc-runtime');
const { activeVoiceLabel } = require('./voice-ref');
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
const { createMusicWiring } = require('./music-wiring');
const { createAppsWiring } = require('./apps-wiring');
const { createScreenCapture } = require('./screen-capture');
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
const { createChatSettings } = require('./chat-settings');
const { createShortcuts } = require('./shortcuts');
const { createTray } = require('./tray');
const { registerOverlayIpc } = require('./ipc-overlay');
const { registerSettingsIpc } = require('./ipc-settings');
const { registerVoiceIpc } = require('./ipc-voice');
const { registerMiscIpc } = require('./ipc-misc');
const {
  normalizeGamingMode, gameCommentVoiceReady, canGameComment, gameCommentKind,
} = require('./game-comment');
const { vramText } = require('./vram');
const { logEvent, voiceLogPath } = require('./log');
const { createVoiceWiring } = require('./voice-wiring');
const { createOffers } = require('./offers');
const { createOverlayWindow } = require('./overlay-window');
const { createTurnTiming, currentTurn, fromSidecar } = require('./timing');
const turns = createTurnTiming({ log: (line) => logEvent(voiceLogPath(), line) });
const { createChatVisible } = require('./chat-visible');
const { saveClip, clipFolderLabel } = require('./clips');
const { micActive } = require('./voice-config');
const { createFollowUp, readMs } = require('./follow-up');
const {
  SENS_MIN, SENS_MAX, SENS_STEP, pctFromThreshold,
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
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const CLAUDE_CODE_HELP = 'https://code.claude.com/docs/en/quickstart';
// the word in the corner of the panel when she talks to the room
const COMMENT_BADGE = { comentar: 'CAPRI', musica: 'MUSIC', juego: 'GAME', video: 'VIDEO', programando: 'CODE' };

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let overlay = null;
let settingsWindow = null;
let windowWatch = null;
// the watcher only speaks when something changes: the overlay asks for this when it (re)loads
let lastWindows = null;
let llm = null;
let lms = null;
let voice = null;
let voiceInstall = null;
let speakQueue = null;
let comments = null;
let voiceListening = false;
let quietWake = false; // the capture running now began as an auto wake over a game
let voiceMic = { open: true, needed: true, message: '' };
let voiceQueue = [];
const chatVisible = createChatVisible({ log: (line) => logEvent(voiceLogPath(), `[capri] ${line}`) });
let gameMode = null;
let gameWindow = null;
const gameQuiet = createGameQuiet({ isActive: () => Boolean(gameMode?.locking?.()) });
let reminders = null;
let weather = null;
let greeting = null;
let whatsNewLines = null; // this boot's "what's new" lines, once only
let userFiles = null;

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

// Her overlay window (overlay-window.js): create, fit, click-through, chat focus, Esc, demo.
const overlayWin = createOverlayWindow({
  root: ROOT,
  userSoundsDir,
  DEV,
  demoSteps,
  gameQuiet,
  chatVisible,
  getOverlay: () => overlay,
  setOverlay: (win) => { overlay = win; },
  getSettingsWindow: () => settingsWindow,
  getMenuGuard: () => menuGuard,
  getRendererRecover: () => rendererRecover,
  getSystemFlow: () => systemFlow,
  getLlm: () => llm,
  getLastWindows: () => lastWindows,
  getVoiceQueue: () => voiceQueue,
  setVoiceQueue: (q) => { voiceQueue = q; },
  getMenuGuardTimer: () => menuGuardTimer,
  setMenuGuardTimer: (t) => { menuGuardTimer = t; },
  rebuildTray: (...args) => rebuildTray(...args),
});
const {
  serveProtocol, targetDisplay, overlayArea, fitOverlay, rearmOverlay, recoverAfterUnlock,
  resyncOverlay, raiseOverlay, createOverlay, setClickThrough, takeEscape, systemEscape,
  sendCommand, openChat, closeChat, menuKeyboardOn, toggleChat, toggleVisible, playDemo,
  demoWindow, resetOverlayInput,
} = overlayWin;
const getClickThrough = overlayWin.getClickThrough;
const getQuitSolid = overlayWin.getQuitSolid;
const setQuitSolidFlag = overlayWin.setQuitSolidFlag;
const getLastInteractive = overlayWin.getLastInteractive;
const setLastInteractive = overlayWin.setLastInteractive;
const getMenuKeyboard = overlayWin.getMenuKeyboard;

function trayNotice(text) {
  const line = String(text || '').trim();
  if (!line) return;
  logEvent(voiceLogPath(), `[capri] tray notice: ${line}`);
  try { getTray()?.displayBalloon?.({ title: 'Capri', content: line }); } catch { /* tray gone */ }
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
  clickThrough: () => getClickThrough(),
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
      if (!chatVisible.get() && !getMenuKeyboard()) {
        overlay?.setFocusable(false);
        setClickThrough(true, 'menu-close');
      }
    }
  },
  log: (line) => logEvent(voiceLogPath(), line),
});

let menuGuardTimer = 0;

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
    && !getMenuKeyboard()
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
  apps: (...args) => apps(...args),
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
  goWhatsNewReply, goAbilitiesReply, goSearchReply, goMicReply, goFixReply, goClipReply, goReminderReply, refreshSettingsMenu,
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
    setQuitSolidFlag(true);
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
    setQuitSolidFlag(false);
    if (!overlay || overlay.isDestroyed()) return;
    if (!chatVisible.get() && !getMenuKeyboard()) overlay.setFocusable(false);
    setClickThrough(getClickThrough());
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
  rebuildTray: (...args) => rebuildTray(...args),
  showLine,
});
const { music, connectSpotify, disconnectSpotify, restoreSpotifyToken, hasToken: hasSpotifyToken } = musicWiring;

// Her brain's settings and cloud keys (chat-settings.js).
const chatSettings = createChatSettings({ updateConfig });
const {
  llmKey, hasAnyLlmKey, setChatProvider, setChatModel, reorderBrains, setChatKey, probeChatFromMenu,
} = chatSettings;

// Ajustes › AUDIO helpers (voice-wiring.js): folder, install, custom ref, reply-on status.
const voiceWiring = createVoiceWiring({
  root: ROOT,
  updateConfig,
  getOverlay: () => overlay,
  getSettingsWindow: () => settingsWindow,
  getVoice: () => voice,
  getVoiceInstall: () => voiceInstall,
});
const {
  resolveVoiceModelsRoot, pickVoiceDir, runVoiceInstall, pickVoiceRefWav, pickVoiceRefText,
  saveVoiceRef, clearVoiceRef, voiceReplyOn, voiceStatus,
} = voiceWiring;

// Optional update / profile bubbles (offers.js).
const offers = createOffers({
  updateConfig,
  sendCommand,
  appLog: (text) => appLog(text),
  gameQuietActive: () => gameQuiet.active(),
});
const { runUpdateCheck, answerUpdatePrompt, maybeOfferProfile, answerProfilePrompt } = offers;

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

// Looking at the screen (screen-capture.js): the shot in memory and the auto look.
const screenCapture = createScreenCapture({
  getOverlay: () => overlay,
  getLlm: () => llm,
  getSpeakQueue: () => speakQueue,
  getGameMode: () => gameMode,
  getLastWindows: () => lastWindows,
  chatVisible,
  voiceReplyOn,
  openChat,
  resetOverlayInput,
  reapplyClickThrough: () => setClickThrough(getClickThrough()),
  targetDisplay,
});
const { captureFilePath, snapScreenForLook, armAutoLook } = screenCapture;

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

// Global shortcuts (shortcuts.js): show/hide, chat, push to talk, menu close, emergency quit.
const shortcuts = createShortcuts({
  toggleVisible,
  toggleChat,
  doQuit,
  forceCloseMenu: (...args) => menuGuard.forceClose(...args),
  rebuildTray: (...args) => rebuildTray(...args),
  sendCommand,
  goodnight,
  followUp,
  getVoice: () => voice,
  getLlm: () => llm,
  getSpeakQueue: () => speakQueue,
  getVoiceListening: () => voiceListening,
  getVoiceMic: () => voiceMic,
});
const {
  shortcutActive, registerShortcuts, setShortcut, talkHotkey, getTalkCombo, getMenuCloseCombo,
} = shortcuts;

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
  rebuildTray: (...args) => rebuildTray(...args),
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
  getTalkCombo,
  getScanRunning,
  hasSpotifyToken,
});

// Her tray icon and menu (tray.js).
const trayWiring = createTray({
  root: ROOT,
  menuState,
  applyMenuAction,
  forceCloseMenu: (...args) => menuGuard.forceClose(...args),
  sendCommand,
  getMenuCloseCombo,
  getTalkCombo,
  talkHotkey,
});
const { rebuildTray, createTray: createTrayIcon, getTray, getTrayMenu } = trayWiring;


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
  goWhatsNewReply, goAbilitiesReply, goSearchReply,
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
    getTray,
    getTrayMenu,
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
    getLastInteractive,
    setLastInteractive,
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
    return { ok: true, value: await overlay.webContents.executeJavaScript(String(body.js || 'null')), clickThrough: getClickThrough() };
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
      onUnlock: () => gameWindow.unlock(),
      onRelock: () => gameWindow.relock(),
    });
    createTrayIcon();
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
        // Comment + fullscreen game in foreground, or a known windowed game: keep Capri above.
        if (gameMode?.locking?.() && normalizeGamingMode(cfg.gaming?.mode) === 'comment') gameQuiet.pin(overlay);
        else if (!gameMode?.active() && windowedGameInFront(data, gameApps)) gameQuiet.pin(overlay);
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
