'use strict';

// Her window while a game owns the screen: enter/leave (voice sidecar and model unloaded), the
// quiet vs comment visual, and the voice-only comment line. The gameMode detector and the
// gameQuiet window rules stay in main.js and come in as deps.

function createGameWindow(deps) {
  let gameWork = Promise.resolve();
  let gameWasFolded = false;
  let gameHadLlm = false;
  let gameHidHer = false; // quiet (No molestar) folded her; comment mode keeps her visible
  let lastGameCommentAt = 0; // voice-only in-game line (comment mode), capped by GAME_COMMENT_MS

  const {
    config,
    logEvent,
    voiceLogPath,
    vramText,
    setClickThrough,
    gameQuiet,
    getOverlay,
    getGameMode,
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
    getLastWindows,
    speakQueue,
    currentTurn,
    voice,
    state,
  } = deps;

  // -- game mode ---------------------------------------------------------------------------
  // A fullscreen game gets the whole GPU: the voice sidecar (OmniVoice) and Gemma go, she folds
  // into DORMANT and stays quiet, and both come back 30 s after the game is really gone.

  const gameLog = (text) => logEvent(voiceLogPath(), `[capri] ${text}`);

  // One step at a time: unloading takes seconds, and a game can come and go meanwhile.
  function queueGame(step) {
    gameWork = gameWork.then(step).catch((err) => gameLog(`game mode: ${err.message}`));
    return gameWork;
  }

  // Quiet = hide (today). Comment = stay visible + click-through + pinned above the game.
  function applyGamePlayVisual(play) {
    setClickThrough(true, 'game');
    if (play === 'comment') {
      gameHidHer = false;
      gameQuiet.pin(getOverlay());
      if (state.overlayFolded) sendCommand('wake', { silent: true });
      return;
    }
    // quiet / No molestar (and manual quiet while a game is on): fold her away
    gameHidHer = true;
    sendCommand('sleep');
  }

  async function gameEnter(windows) {
    gameWasFolded = state.overlayFolded;
    gameHidHer = false;
    gameLog(`game on exe=${windows?.fgExe || '?'} ${vramText()}`);
    setClickThrough(true, 'game'); // clicks pass through over the game from here on
    llm?.cancel();
    goodnight.cancel();
    followUp.cancel();
    const play = normalizeGamingMode(config.load().gaming?.mode);
    if (play === 'comment') {
      // Visible, fully click-through, never focus; pin above borderless fullscreen.
      applyGamePlayVisual('comment');
    } else {
      try { speakLine(pickLine('juegoEntrar')); } catch { /* pool missing in old builds */ }
      applyGamePlayVisual('quiet'); // DORMANT / hidden; click-through stays on (game-quiet)
    }
    if (lms?.status() === 'booting') await lms.whenReady(); // a load in flight would land anyway
    gameHadLlm = lms?.status() === 'ready';
    await lms?.unloadAll?.();
    if (!getGameMode()?.active()) {
      gameLog('game enter cancelled after focus lost');
      return;
    }
    if (play === 'comment') gameQuiet.pin(getOverlay()); // re-assert after unload wait
    gameLog(`game on after unload wakeMuted=${Boolean(voice?.wakeMuted?.())} mode=${play} hid=${gameHidHer} ${vramText()}`);
  }

  // Comment mode: voice-only pool line while quiet gates stay on. No bubble, no focus.
  // Comentar is the opt-in: speak even when replyMode is blips/silent, if the sidecar is up.
  function maybeGameComment() {
    const cfg = config.load();
    const mode = normalizeGamingMode(cfg.gaming?.mode);
    const busy = Boolean(state.ttsLoading || state.voiceTalking || state.llmBusy || goodnight.pending);
    const voiceReady = gameCommentVoiceReady({
      muted: Boolean(cfg.muted),
      connected: Boolean(voice?.connected?.()),
      tts: cfg.voice?.tts,
    });
    if (!canGameComment({
      mode,
      gameActive: Boolean(getGameMode()?.active()),
      lastAt: lastGameCommentAt,
      voiceOn: voiceReady,
      busy,
    })) return;
    if (!speakQueue) return; // no voice path → nothing (never a bubble over the game)
    const context = cfg.llm?.shareScreen === true
      ? windowContext(getLastWindows(), { apps: cfg.gaming?.apps || [] })
      : null;
    const kind = gameCommentKind({ shareScreen: cfg.llm?.shareScreen === true, context });
    let line = '';
    try { line = pickLine(kind); } catch { /* pool missing */ }
    if (!line) return;
    // Bypass speakLine/voiceReplyOn: replyMode must not silence Comentar.
    const speakId = speakQueue.start(currentTurn()) || 0;
    if (!speakId) return;
    lastGameCommentAt = Date.now();
    speakQueue.feed(line);
    speakQueue.flush(speakId);
  }

  async function gameLeave() {
    gameLog(`game off ${vramText()}`);
    sendCommand('game-drone', { on: false });
    gameQuiet.restore(getOverlay()); // Capri's normal top level, clicks passing through, chat untouched
    // Only wake if quiet mode hid her (comment stayed visible the whole time).
    if (gameHidHer && !gameWasFolded) sendCommand('wake', { silent: true });
    if (gameHadLlm) await lms?.reload?.();
    try { speakLine(pickLine('juegoSalir')); } catch { /* pool missing */ }
    gameLog(`game off after reload ${vramText()}`);
    gameWasFolded = false;
    gameHadLlm = false;
    gameHidHer = false;
  }

  // Focus lost during exit grace: clicks/chat back; VRAM unload stays until leave().
  function gameUnlock() {
    setClickThrough(false, 'game-focus-lost');
  }

  function gameRelock() {
    setClickThrough(true, 'game');
    if (normalizeGamingMode(config.load().gaming?.mode) === 'comment') {
      gameQuiet.pin(getOverlay());
    }
  }

  return {
    // queued: a game comes and goes while the sidecar unloads
    enter: (windows) => queueGame(() => gameEnter(windows)),
    leave: () => queueGame(gameLeave),
    unlock: gameUnlock,
    relock: gameRelock,
    comment: maybeGameComment,
    visual: applyGamePlayVisual,
    log: gameLog,
  };
}

module.exports = { createGameWindow };
