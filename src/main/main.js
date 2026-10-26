'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage,
} = require('electron');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch, restoreForeground } = require('./windows');
const { createLlm } = require('./llm');
const { createLms } = require('./lms');
const { createVoice } = require('./voice');
const { createSpeakQueue } = require('./speak');
const hooks = require('../../scripts/install-hooks');
const demoSteps = require('../../scripts/demo-sequence');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.CAPRI_PORT) || 47823;
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const CLAUDE_CODE_HELP = 'https://code.claude.com/docs/en/quickstart';

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
let voiceQueue = [];
let chatOpen = false;
let previousForeground = null;

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

function fitOverlay() {
  if (!overlay) return;
  const { workArea } = targetDisplay();
  overlay.setBounds(workArea);
  overlay.webContents.send('overlay:resize', { width: workArea.width, height: workArea.height });
}

function createOverlay() {
  const { workArea } = targetDisplay();
  overlay = new BrowserWindow({
    ...workArea,
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
  // always shown: put away, she's still there as her biochip in the corner
  overlay.once('ready-to-show', () => {
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
  return { ...cfg, idle, lang: resolveLang(cfg.lang), langSetting: cfg.lang, dev: DEV };
}

function ttsOn() {
  const cfg = config.load();
  if (cfg.muted) return false;
  const kind = String(cfg.voice?.tts || 'kokoro').toLowerCase();
  if (kind === 'off' || kind === 'none' || kind === 'false') return false;
  return Boolean(voice?.connected?.());
}

function updateConfig(patch) {
  config.save(patch);
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);
  voice?.applyConfig();
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
    case 'sleep': sendCommand('sleep'); break;
    case 'wake': sendCommand('wake'); break;
    case 'scale': updateConfig({ scale: Number(value) }); break;
    case 'muted': updateConfig({ muted: Boolean(value) }); break;
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
    case 'mic': updateConfig({ voice: { enabled: Boolean(value) } }); break;
    case 'mic-device': updateConfig({ voice: { inputDevice: value } }); break;
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
      mic: cfg.voice?.enabled !== false,
      micDevice: cfg.voice?.inputDevice ?? null,
    },
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
  ipcMain.on('overlay:folded', (_e, on) => {
    overlayFolded = Boolean(on);
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
  ipcMain.handle('llm:status', () => lms?.status() || 'ready');
  ipcMain.handle('chat:send', async (_e, text) => {
    const line = String(text || '').trim();
    if (!line || !overlay) return { ok: false };
    const boot = await lms.whenReady();
    if (boot === 'failed') {
      overlay.webContents.send('chat:error', { kind: 'offline' });
      return { ok: false };
    }
    speakQueue?.stop();
    if (ttsOn()) speakQueue?.start();
    await llm.chat({
      user: line,
      onToken: (piece) => {
        overlay?.webContents.send('chat:token', piece);
        if (ttsOn()) speakQueue?.feed(piece);
      },
      onDone: (payload) => {
        if (ttsOn()) speakQueue?.flush();
        overlay?.webContents.send('chat:done', payload);
      },
      onError: (payload) => {
        speakQueue?.stop();
        overlay?.webContents.send('chat:error', payload);
      },
    });
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
      onEvent: (payload) => {
        if (payload?.type === 'listening') openChat();
        if (payload?.type === 'devices') rebuildTray();
        if (overlay?.webContents && !overlay.webContents.isDestroyed()) {
          overlay.webContents.send('voice:event', payload);
        } else {
          voiceQueue.push(payload);
        }
      },
    });
    createOverlay();
    speakQueue = createSpeakQueue({
      send: (msg) => {
        if (!voice) return;
        if (msg.type === 'speak') voice.speak(msg.text);
        else if (msg.type === 'speak_flush') voice.speakFlush();
        else if (msg.type === 'stop_speak') voice.stopSpeak();
      },
    });
    voice.start();
    createTray();
    windowWatch = startWindowWatch({
      overlay,
      onUpdate: (data) => {
        lastWindows = data;
        overlay?.webContents.send('windows:update', data);
      },
    });
    createBridge({
      port: PORT,
      onEvent: (evt) => overlay?.webContents.send('claude:event', evt),
      onDebug: DEV ? debugHandler : null,
    });
    globalShortcut.register('Control+Alt+C', () => toggleVisible());
    globalShortcut.register('Control+Alt+T', () => toggleChat());
    globalShortcut.register('Control+Alt+V', () => {
      llm?.cancel();
      speakQueue?.stop();
      voice?.pttStart();
    });
    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    windowWatch?.stop();
    voice?.stop();
    lms?.unload();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
