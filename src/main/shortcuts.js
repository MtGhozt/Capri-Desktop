'use strict';

// Global shortcuts: show/hide, chat, push-to-talk, the menu-close combo and the emergency quit.
// main.js keeps only the values the tray and Ajustes read back.

const { globalShortcut } = require('electron');

const config = require('./config');
const state = require('./state');
const { logEvent, voiceLogPath } = require('./log');
const { normalizeAccelerator, acceleratorFromKey, sameCombo, shortcutConflict } = require('./hearing');

// Public escape hatch: always registered, no confirm (see README "Si Capri se traba").
const FORCE_QUIT_ACCEL = 'Ctrl+Alt+Shift+Q';

function createShortcuts(deps) {

  const {
    toggleVisible,
    toggleChat,
    doQuit,
    forceCloseMenu,
    rebuildTray,
    sendCommand,
    goodnight,
    followUp,
    getVoice,
    getLlm,
    getSpeakQueue,
    getVoiceListening,
    getVoiceMic,
  } = deps;

  let registeredShortcuts = [];
  let menuCloseCombo = ''; // the shortcut that closes her menu, as registered
  let talkCombo = '';
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
        if (globalShortcut.register(combo, () => forceCloseMenu('shortcut'))) {
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
  function talkHotkey(cfg) {
    return normalizeAccelerator(cfg.hearing?.talkHotkey) || normalizeAccelerator(cfg.shortcuts?.talk) || 'Ctrl+Alt+V';
  }

  function talkNow() {
    const voice = getVoice();
    const voiceMic = getVoiceMic();
    // Ctrl+Alt+V toggles: once more stops listening
    if (getVoiceListening()) {
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
    getLlm()?.cancel();
    getSpeakQueue()?.stop();
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

  return {
    shortcutActive,
    registerShortcuts,
    setShortcut,
    talkHotkey,
    talkNow,
    getTalkCombo: () => talkCombo,
    getMenuCloseCombo: () => menuCloseCombo,
  };
}

module.exports = { createShortcuts };
