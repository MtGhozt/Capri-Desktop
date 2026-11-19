'use strict';

// Looking at the screen: the display with the window in front, the in-memory JPEG and its shield
// (screen-look.js), and the auto look that comments on it every minute. main.js only wires it.

const path = require('node:path');
const { screen, desktopCapturer, powerMonitor } = require('electron');

const config = require('./config');
const state = require('./state');
const {
  captureScreenJpeg, createCaptureShield, keepCaptureFile, shouldAutoLook, AUTO_LOOK_MS,
} = require('./screen-look');
const { supportsVision, isAgent, provider } = require('./chat-providers');
const { logEvent, voiceLogPath } = require('./log');

function createScreenCapture(deps) {
  const {
    getOverlay,
    getLlm,
    getSpeakQueue,
    getGameMode,
    getLastWindows,
    chatVisible,
    voiceReplyOn,
    openChat,
    resetOverlayInput,
    reapplyClickThrough,
    targetDisplay,
  } = deps;

  let lastAutoLookAt = 0;
  let autoLookTimer = null;

  // Phase 6C: JPEG in memory. Win32 uses setContentProtection so Capri stays visible and out of the shot.
  // The screen she captures is the one with the window in front, not wherever the mouse is resting:
  // a second monitor showing only the wallpaper (and the "Activar Windows" watermark) was the bug.
  function lookDisplay() {
    const rect = getLastWindows()?.fgRect;
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
    const overlay = getOverlay();
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
        reapplyClickThrough();
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
      gameActive: Boolean(getGameMode()?.active?.()),
      fullscreen: Boolean(getLastWindows()?.fgFull),
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
    const speakQueue = getSpeakQueue();
    const speakId = voiceReplyOn() ? speakQueue?.start() : 0;
    if (!speakId) speakQueue?.stop();
    state.llmBusy = true;
    try {
      await getLlm()?.chat?.({
        user: line,
        image,
        onMood: (name) => speakQueue?.setMood?.(name),
        onToken: (piece) => {
          getOverlay()?.webContents.send('chat:token', piece);
          if (speakId) speakQueue?.feed(piece);
        },
        onDone: (payload) => {
          // text before audio: the bubble answers at once even if TTS takes seconds
          getOverlay()?.webContents.send('chat:done', payload);
          if (speakId) {
            if (payload?.mood) speakQueue?.setMood?.(payload.mood);
            speakQueue?.flush(speakId);
          }
        },
        onError: (payload) => {
          if (speakId) speakQueue?.stop(speakId);
          getOverlay()?.webContents.send('chat:error', payload);
        },
      });
    } finally {
      state.llmBusy = false;
    }
  }

  return {
    lookDisplay,
    captureFilePath,
    snapScreenForLook,
    armAutoLook,
    maybeAutoLook,
  };
}

module.exports = { createScreenCapture };
