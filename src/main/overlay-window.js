'use strict';

// Her overlay BrowserWindow: size/fit, create, click-through, chat focus handoff, Esc hooks and
// the demo window. main.js keeps the tray/menu-guard/recover wiring and passes them as getters.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, screen, protocol, net, globalShortcut,
} = require('electron');

const config = require('./config');
const { restoreForeground } = require('./windows');
const { logEvent, voiceLogPath } = require('./log');

const DEMO_TERMINAL = `<body style="margin:0;background:#14101c;color:#8f8aa3;font:13px/1.7 Consolas,monospace;padding:14px 18px">
<div style="color:#36ff7a">PS C:\\night-city-api&gt; npm test -- gigs</div>
<div>&nbsp;&nbsp;GET /gigs</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ returns 20 items per page</div>
<div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ paginates with a cursor</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ rejects a bad cursor</div>
<div>&nbsp;&nbsp;6 passing (212ms)</div><div style="color:#36ff7a">PS C:\\night-city-api&gt; _</div></body>`;

function createOverlayWindow(deps) {
  const {
    root,
    userSoundsDir,
    DEV,
    demoSteps,
    gameQuiet,
    chatVisible,
    getOverlay,
    setOverlay,
    getSettingsWindow,
    getMenuGuard,
    getRendererRecover,
    getSystemFlow,
    getLlm,
    getLastWindows,
    getVoiceQueue,
    setVoiceQueue,
    getMenuGuardTimer,
    setMenuGuardTimer,
    rebuildTray,
  } = deps;

  // Click-through, as she last asked for it: put back after anything that may touch the window's
  // styles (focusable, show, focus), and again on her heartbeat, so it can't stay off by itself.
  let clickThrough = true;
  let lastThrough = null; // last value written to the log: hover flips it on every click
  let handedBackAt = 0; // when she last gave the keyboard back to the window before her
  let quitSolid = false; // ¿Salir? visible: ignoreMouseEvents stays off until clear + grace
  let lastInteractive = null; // last hover state she acted on: an unchanged ask costs nothing
  let escapeTaken = false;
  let systemEsc = false;
  let previousForeground = null;
  let menuKeyboard = false;
  let demoWin = null;
  let demoTimer = null;

  // capri://app/...        -> files of this repo
  // capri://usersounds/... -> the user's own sound overrides
  function serveProtocol() {
    protocol.handle('capri', (request) => {
      const url = new URL(request.url);
      const base = url.host === 'usersounds' ? userSoundsDir() : root;
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
    const overlay = getOverlay();
    if (!overlay) return;
    const { area, gap } = overlayArea();
    overlay.setBounds(area);
    overlay.webContents.send('overlay:resize', { width: area.width, height: area.height, gap });
  }

  function sendCommand(name, payload = {}) {
    getOverlay()?.webContents.send('capri:command', { name, ...payload });
  }

  function setClickThrough(on, reason = 'state') {
    clickThrough = Boolean(on);
    // Anything but hover moved her: the next hover ask has to be applied, not deduped away.
    if (reason !== 'hover-on' && reason !== 'hover-off') lastInteractive = null;
    const overlay = getOverlay();
    if (!overlay || overlay.isDestroyed()) return;
    // ¿Salir? / open menu: never re-enable ignoreMouseEvents (hover can stay false after Win+L).
    // A game owns the screen: clicks always pass through, whatever she last asked for.
    const through = gameQuiet.active()
      ? true
      : (quitSolid || getMenuGuard()?.menuOpen) ? false : clickThrough;
    // Hover can flip dozens of times/sec at the hit edge — only act (and log) on real changes.
    if (through === lastThrough) return;
    lastThrough = through;
    if (reason !== 'hover-on' && reason !== 'hover-off' && reason !== 'heartbeat') {
      logEvent(voiceLogPath(), `[capri] click-through ${through ? 'on' : 'off'} reason=${reason}`);
    }
    if (through) overlay.setIgnoreMouseEvents(true, { forward: true });
    else overlay.setIgnoreMouseEvents(false);
  }

  // The pointer reaches her click-through window through a mouse hook, and Windows drops a hook that
  // doesn't answer in time without a word (waking from sleep, a locked screen, a stall): she can't be
  // clicked anymore. Off then on puts in a new one; her place on top and her size are set again too.
  function rearmOverlay() {
    const overlay = getOverlay();
    if (!overlay || overlay.isDestroyed()) return;
    if (gameQuiet.active()) return; // a game owns the screen: clicks stay passed through
    overlay.setIgnoreMouseEvents(false);
    overlay.setAlwaysOnTop(true, 'screen-saver');
    fitOverlay();
    setTimeout(() => {
      if (!getOverlay() || getOverlay().isDestroyed() || getMenuGuard().menuOpen) return;
      setClickThrough(true, 'rearm');
    }, 0);
    sendCommand('rearmed'); // click-through again: she waits for the pointer to be on her
    console.log('[capri] mouse hook set up again');
  }

  // After look/speak/hide: never leave the overlay eating the desktop or stuck click-through.
  function resetOverlayInput(reason = 'reset') {
    const overlay = getOverlay();
    if (!overlay || overlay.isDestroyed()) return;
    try {
      if (!overlay.isVisible()) overlay.showInactive();
    } catch { /* gone */ }
    // show()/hide() can desync ignoreMouseEvents from our clickThrough flag — reapply.
    setClickThrough(clickThrough);
    sendCommand('input-reset', { reason: String(reason || 'reset') });
  }

  // Esc while her menu is open, wherever the keyboard is: the overlay rarely has it (it never takes
  // it by itself), so a key listener in her page alone can't be counted on.
  function takeEscape(on) {
    try {
      // Always unregister first: after Win+L the OS may have dropped the hook while escapeTaken stayed true.
      if (escapeTaken || !on) {
        try { globalShortcut.unregister('Escape'); } catch { /* already gone */ }
        escapeTaken = false;
      }
      if (!on) return;
      escapeTaken = globalShortcut.register('Escape', () => getMenuGuard().forceClose('esc'));
    } catch (err) {
      console.error(`[capri] Esc for the menu: ${err.message}`);
      escapeTaken = false;
    }
  }

  // Esc while she says goodbye and the screen goes down (Paso 4G): the only key that stops it from anywhere.
  function systemEscape(on) {
    if (on) {
      if (systemEsc || escapeTaken) return;
      try {
        if (globalShortcut.register('Escape', () => getSystemFlow().cancel('esc'))) systemEsc = true;
      } catch (err) {
        console.error(`[capri] Esc for the countdown: ${err.message}`);
      }
      return;
    }
    if (!systemEsc) return;
    try { globalShortcut.unregister('Escape'); } catch { /* already gone */ }
    systemEsc = false;
  }

  function overlayHwnd() {
    const overlay = getOverlay();
    if (!overlay) return null;
    const handle = overlay.getNativeWindowHandle();
    return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  }

  function captureForeground() {
    const self = overlayHwnd();
    const fg = getLastWindows()?.fg;
    if (fg != null && self != null && String(fg) !== String(self)) return fg;
    return previousForeground;
  }

  function openChat(source = 'overlay') {
    const overlay = getOverlay();
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
    getLlm()?.cancel();
    if (wasOpen) sendCommand('chat', { on: false });
    const target = previousForeground;
    previousForeground = null;
    // Restore first while we still own focus, then drop keyboard on the overlay.
    handedBackAt = Date.now();
    if (target != null) restoreForeground(target);
    getOverlay()?.setFocusable(false);
    getOverlay()?.showInactive();
    setClickThrough(clickThrough);
  }

  // Her menu's text fields (Corregir lo último): the keyboard while they're open, given back after.
  function menuKeyboardOn(on) {
    const overlay = getOverlay();
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

  // Back on top of everything, the taskbar included (it comes up over her when it's clicked). Twice:
  // the taskbar can come up again a moment later, as its menus and previews open.
  function raiseOverlay() {
    if (gameQuiet.active()) return; // never moveTop() over a game
    for (const wait of [0, 400]) {
      setTimeout(() => {
        const overlay = getOverlay();
        if (!overlay || overlay.isDestroyed()) return;
        overlay.setAlwaysOnTop(true, 'screen-saver');
        overlay.moveTop();
      }, wait);
    }
  }

  // Win+L / sleep freezes heartbeats and Windows drops global shortcuts. Reset so the quick menu
  // and Ajustes are not stuck under an interactive fullscreen overlay with a dead Esc hook.
  // Same root cause as the look/drag freeze: busy/dragging can stay true across the lock, so
  // refreshHit keeps the overlay interactive over the whole desktop — rearm alone is not enough.
  function recoverAfterUnlock(reason = 'unlock') {
    const overlay = getOverlay();
    if (!overlay || overlay.isDestroyed()) return;
    logEvent(voiceLogPath(), `[capri] recover after ${reason}`);
    getMenuGuard().forceClose(reason);
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
    const settingsWindow = getSettingsWindow();
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      try { settingsWindow.moveTop(); settingsWindow.focus(); } catch { /* gone */ }
    }
  }

  function resyncOverlay(reason = 'resync') {
    const overlay = getOverlay();
    if (!overlay || overlay.isDestroyed()) return;
    logEvent(voiceLogPath(), `[capri] overlay resync after ${reason}`);
    recoverAfterUnlock(reason);
  }

  function createOverlay() {
    const overlay = new BrowserWindow({
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
    setOverlay(overlay);

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
      if (!getMenuGuardTimer()) setMenuGuardTimer(setInterval(() => getMenuGuard().tick(), 2000));
      for (const payload of getVoiceQueue()) overlay.webContents.send('voice:event', payload);
      setVoiceQueue([]);
    });
    overlay.webContents.on('render-process-gone', (_e, details) => {
      console.error('[capri] renderer gone:', details.reason);
      getRendererRecover().gone(details.reason);
    });
    // a stalled page can't take clicks back from the screen: give them back / reload once
    overlay.webContents.on('unresponsive', () => {
      getRendererRecover().unresponsive();
    });
    overlay.webContents.on('responsive', () => {
      logEvent(voiceLogPath(), '[capri] renderer responsive again');
      getRendererRecover().reset();
    });
    overlay.webContents.on('did-finish-load', () => {
      fitOverlay();
      overlay.showInactive();
      logEvent(voiceLogPath(), `[capri] startup did-finish-load visible=${overlay.isVisible()} opacity=${overlay.getOpacity()}`);
      getRendererRecover().reset();
      for (const payload of getVoiceQueue()) overlay.webContents.send('voice:event', payload);
      setVoiceQueue([]);
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

  function playDemo() {
    clearTimeout(demoTimer);
    let i = 0;
    const next = () => {
      if (i >= demoSteps.length) return;
      const [delay, evt] = demoSteps[i++];
      demoTimer = setTimeout(() => {
        getOverlay()?.webContents.send('claude:event', evt);
        next();
      }, delay);
    };
    next();
  }

  // During the demo, a little fake terminal for her to sit on and take over (window tracking is
  // Windows only, so only there). Opened without stealing focus; closing it drops her off it.
  function demoWindow(open) {
    demoWin?.destroy();
    demoWin = null;
    if (!open || process.platform !== 'win32') return false;
    const b = getOverlay().getBounds();
    demoWin = new BrowserWindow({
      x: Math.round(b.x + b.width * 0.5 - 310), y: Math.round(b.y + b.height * 0.42), width: 620, height: 300,
      show: false, alwaysOnTop: true, title: 'night-city-api — npm test', backgroundColor: '#14101c', autoHideMenuBar: true,
    });
    demoWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEMO_TERMINAL)}`);
    demoWin.once('ready-to-show', () => demoWin?.showInactive());
    demoWin.on('closed', () => { demoWin = null; });
    return true;
  }

  return {
    serveProtocol,
    targetDisplay,
    overlayArea,
    fitOverlay,
    rearmOverlay,
    recoverAfterUnlock,
    resyncOverlay,
    raiseOverlay,
    createOverlay,
    setClickThrough,
    getClickThrough: () => clickThrough,
    getQuitSolid: () => quitSolid,
    setQuitSolidFlag: (on) => { quitSolid = Boolean(on); },
    getLastInteractive: () => lastInteractive,
    setLastInteractive: (value) => { lastInteractive = value; },
    getHandedBackAt: () => handedBackAt,
    getMenuKeyboard: () => menuKeyboard,
    takeEscape,
    systemEscape,
    sendCommand,
    overlayHwnd,
    openChat,
    closeChat,
    menuKeyboardOn,
    toggleChat,
    toggleVisible,
    playDemo,
    demoWindow,
    resetOverlayInput,
  };
}

module.exports = { createOverlayWindow };
