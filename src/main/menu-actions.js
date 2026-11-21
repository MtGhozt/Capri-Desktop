'use strict';

// Every menu id that comes in over `menu:action` (her menu, Ajustes and the tray), in one place.
// It was a single ~330-line switch in main.js: same cases, split by domain so no function grows
// past a screen. A domain that does not own the id answers NOT_MINE and the next one is asked.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, shell, clipboard } = require('electron');

const config = require('./config');
const state = require('./state');
const { reviveMigratedTts } = require('./config');
const { provider, isCloud } = require('./chat-providers');
const { consentNotice } = require('./screen-look');
const { patchGamingApps } = require('./game-detect');
const { isAllowedOpenUrl } = require('./about');
const { detectAgents } = require('./agent-brain');
const { parseRenderMode } = require('./render-mode');
const { COMMENT_WARN, normalizeGamingMode } = require('./game-comment');
const { openClipsFolder } = require('./clips');
const { cleanName } = require('./name-command');
const { copyErrorPayload } = require('./diagnose');
const { normalizeTimeFormat, calendarUrl } = require('./reminders');
const {
  thresholdFromPct, wakeSensitivity,
} = require('./hearing');
const { voiceLogPath } = require('./log');
const { PYTHON_URL } = require('./voice-install');
const { VC_URL } = require('./vc-runtime');

const NOT_MINE = Symbol('not-mine');

function createMenuActions(deps) {

  const {
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
    getVoiceInstall,
    getGameMode,
    getGameWindow,
    getReminders,
    getWeather,
    getLlm,
    getUserFiles,
    getLastWindows,
  } = deps;

  function applyAppsAction(id, value) {
    switch (id) {
      case 'apps-pick-program': return pickProgram().catch((err) => ({ ok: false, message: `No se pudo: ${err.message}` }));
      case 'apps-pick-folder-file': return pickFolderOrFile().catch((err) => ({ ok: false, message: `No se pudo: ${err.message}` }));
      case 'apps-add-link': return addLink(value);
      case 'apps-update': return updateApp(value);
      case 'apps-remove': return removeApp(value);
      case 'apps-test': return { ok: true, text: apps().dryRun(value) };
      case 'apps-rescan': return rescanApps();
      case 'apps-promote': return promoteApp(value);
      case 'clips-dir': openClipsFolder(config.load()); break;
      default: return NOT_MINE;
    }
  }

  function applyVoiceAction(id, value) {
    const voiceInstall = getVoiceInstall();
    switch (id) {
      case 'reply-mode':
        // Picking VOZ starts OmniVoice loading now, not a stale "off" from the blips it was using.
        if (value === 'voice') state.lastTts = { engine: 'omnivoice', state: 'loading' };
        updateConfig({ voice: {
          replyMode: String(value || 'blips'),
          ...(value === 'voice' ? reviveMigratedTts(config.load().voice) : {}),
        } });
        break;
      case 'voice-dir': return pickVoiceDir().catch((err) => ({ ok: false, message: `No se pudo: ${err.message}` }));
      case 'voice-install': return runVoiceInstall(value).catch((err) => ({ ok: false, message: `No se pudo: ${err.message}` }));
      case 'voice-install-cancel': return voiceInstall?.cancel() || { ok: false, message: 'Nada que cancelar.' };
      case 'voice-ref-pick': return pickVoiceRefWav().catch((err) => ({ ok: false, message: `No se pudo: ${err.message}` }));
      case 'voice-ref-text': return pickVoiceRefText().catch((err) => ({ ok: false, message: `No se pudo: ${err.message}` }));
      case 'voice-ref-save': return saveVoiceRef(value);
      case 'voice-ref-clear': return clearVoiceRef();
      case 'open-python':
        shell.openExternal(PYTHON_URL);
        return { ok: true };
      case 'open-vc':
        shell.openExternal(VC_URL);
        return { ok: true };
      case 'sounds-dir':
        fs.mkdirSync(userSoundsDir(), { recursive: true });
        shell.openPath(userSoundsDir());
        break;
      case 'mic': goMicReply(Boolean(value), { chat: false }); break;
      case 'mic-device': updateConfig({ voice: { inputDevice: value } }); break;
      case 'wake-sensitivity':
        updateConfig({ voice: { wakeThreshold: thresholdFromPct(value) } }); // live: the sidecar gets the new config
        break;
      case 'wake-level':
        // The preset sets every wake knob at once; the % slider above stays the fine knob.
        updateConfig({ voice: { wakeSensitivity: String(value || 'normal'), ...wakeSensitivity(value) } });
        break;
      case 'pause-before-cut':
        updateConfig({ voice: { pauseBeforeCut: ['short', 'normal', 'long'].includes(String(value)) ? String(value) : 'normal' } });
        break;
      default: return NOT_MINE;
    }
  }

  function applyMusicAction(id, value) {
    switch (id) {
      case 'music-player':
        updateConfig({ music: { player: ['namida', 'spotify', 'youtube', 'none'].includes(value) ? value : 'namida' } });
        break;
      case 'spotify-connect':
        updateConfig({ music: { spotify: { clientId: String(value || '').trim().slice(0, 100) } } });
        return connectSpotify(value);
      case 'spotify-disconnect':
        disconnectSpotify();
        break;
      default: return NOT_MINE;
    }
  }

  function applyChatAction(id, value) {
    switch (id) {
      case 'model-provider': return setChatProvider(value);
      case 'model-reorder': return reorderBrains(value);
      case 'model-set': return setChatModel(value);
      case 'model-key': return setChatKey(value);
      case 'model-probe': return probeChatFromMenu(value);
      case 'model-share': {
        const wasOn = config.load().llm?.shareScreen === true;
        updateConfig({ llm: value });
        const cfg = config.load();
        if (value?.shareScreen && !wasOn && !cfg.llm?.screenConsent) {
          const id = String(cfg.llm?.provider || 'local');
          sendCommand('line', {
            badge: 'PANTALLA',
            text: consentNotice({
              label: provider(id).label,
              model: String(cfg.llm?.model || provider(id).model || ''),
              cloud: isCloud(id),
            }),
          });
          updateConfig({ llm: { screenConsent: true } });
        }
        if ('autoLook' in (value || {}) || 'shareScreen' in (value || {})) armAutoLook();
        break;
      }
      case 'persona-reload': {
        const r = getLlm().reloadPersona();
        sendCommand('line', {
          badge: 'MEM',
          text: r.ok ? 'Personalidad recargada. Soy más yo que antes.' : 'No pude releer persona.md.',
        });
        break;
      }
      case 'persona-open': {
        const file = getUserFiles()?.persona?.path;
        if (file) shell.openPath(file);
        break;
      }
      case 'memory-open': {
        const file = getUserFiles()?.memory?.path;
        if (file) shell.openPath(file);
        break;
      }
      default: return NOT_MINE;
    }
  }

  function applyGameAction(id, value) {
    const lastWindows = getLastWindows();
    const gameMode = getGameMode();
    const gameWindow = getGameWindow();
    switch (id) {
      case 'gaming-mode': {
        // Manual No molestar always wins: apply now (never wait for the next window tick).
        // Off suppresses this process until it changes; on clears that suppress.
        const off = value === 'off';
        const cur = config.load().gaming || {};
        if (off) {
          const keep = normalizeGamingMode(cur.mode) === 'comment' ? 'comment'
            : (cur.lastMode === 'comment' ? 'comment' : 'quiet');
          updateConfig({ gaming: { mode: 'off', lastMode: keep } });
          gameMode?.dismiss?.(lastWindows);
        } else {
          const back = cur.lastMode === 'comment' ? 'comment' : 'quiet';
          updateConfig({ gaming: { mode: back } });
          gameMode?.clearSuppress?.();
        }
        gameMode?.update?.(lastWindows);
        break;
      }
      case 'gaming-play': {
        // Ajustes › Comportamiento: En juegos → quiet (No molestar) | comment.
        const next = value === 'comment' ? 'comment' : 'quiet';
        const cur = config.load().gaming || {};
        const warn = next === 'comment' && !cur.commentWarned;
        updateConfig({
          gaming: {
            mode: next,
            lastMode: next,
            ...(warn ? { commentWarned: true } : {}),
          },
        });
        gameMode?.clearSuppress?.();
        gameMode?.update?.(lastWindows);
        // Mid-game switch: quiet hides now; comment stays visible (manual No molestar = quiet).
        if (gameMode?.active()) gameWindow?.visual(next);
        if (warn) return { ok: true, warning: COMMENT_WARN };
        return { ok: true };
      }
      case 'drone-mode': updateConfig({ gaming: { drone: Boolean(value) } }); break;
      case 'game-list':
      case 'game-allow':
      case 'game-ignore':
      case 'game-forget': {
        const exe = String(value?.exe || lastWindows?.fgExe || '').trim();
        if (!exe) break;
        const action = id === 'game-ignore' || value === 'ignore' ? 'ignore'
          : id === 'game-forget' || value === 'remove' ? 'remove'
            : 'allow';
        updateConfig({ gaming: { apps: patchGamingApps(config.load().gaming?.apps, exe, action) } });
        // Ignore/allow must take effect now, not after the next focus change.
        gameMode?.update?.(lastWindows);
        return action === 'remove'
          ? { ok: true, message: `${path.basename(exe, path.extname(exe))} quitado de la lista ✓` }
          : { ok: true };
      }
      default: return NOT_MINE;
    }
  }

  function applySystemAction(id, value) {
    switch (id) {
      case 'updates-enabled':
        updateConfig({ updates: { enabled: Boolean(value) } });
        return { ok: true };
      case 'check-updates':
        return runUpdateCheck({ force: true });
      case 'update-answer':
        return answerUpdatePrompt(value);
      case 'recommend-profile':
        return maybeOfferProfile({ force: true });
      case 'profile-answer':
        return answerProfilePrompt(value);
      case 'share-logs': {
        const file = voiceLogPath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        clipboard.writeText(file);
        shell.showItemInFolder(file);
        return { ok: true, message: 'Ruta de voice.log copiada.' };
      }
      case 'open-log': {
        const file = voiceLogPath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (!fs.existsSync(file)) fs.writeFileSync(file, '');
        shell.showItemInFolder(file);
        return { ok: true, message: 'Log abierto.' };
      }
      case 'copy-error': {
        const user = path.basename(process.env.USERPROFILE || os.homedir());
        const payload = copyErrorPayload(value, { user });
        clipboard.writeText(payload.text);
        return { ...payload, message: 'Error copiado.' };
      }
      case 'desktop-shortcut': {
        try {
          const link = path.join(app.getPath('desktop'), 'Capri.lnk');
          if (value === false) { // the Comportamiento toggle turned it off
            if (fs.existsSync(link)) fs.unlinkSync(link);
            return { ok: true, message: 'Acceso directo quitado del Escritorio.' };
          }
          const ok = shell.writeShortcutLink(link, {
            target: process.execPath,
            cwd: path.dirname(process.execPath),
            description: 'Capri Desktop',
            icon: process.execPath,
            iconIndex: 0,
          });
          return ok
            ? { ok: true, message: 'Acceso directo creado en el Escritorio.' }
            : { ok: false, message: 'No se pudo crear el acceso directo.' };
        } catch (err) {
          return { ok: false, message: `No se pudo crear el acceso: ${err.message}` };
        }
      }
      case 'diagnose':
        return runDiagnostics().then((res) => ({ ok: true, ...res }));
      case 'diagnose-copy':
        return runDiagnostics().then(({ text }) => {
          clipboard.writeText(text);
          return { ok: true, message: 'Reporte copiado.' };
        });
      case 'render': {
        if (parseRenderMode(value) !== value) return { ok: false, message: 'Esa opción de pantalla no existe.' };
        if (parseRenderMode(config.load().render) === value) return { ok: true }; // already on it
        config.save({ render: value, visible: true });
        if (DEV) {
          doQuit();
          return { ok: true, message: 'Cerré Capri. Volvé a ejecutar pnpm start para aplicar Pantalla.' };
        }
        app.relaunch(); // read once, when Chromium starts
        app.exit(0);
        break;
      }
      case 'display':
        config.save({ displayId: value });
        fitOverlay();
        rebuildTray();
        break;
      case 'shortcuts-file':
        config.load();
        if (!fs.existsSync(config.filePath())) config.save({});
        shell.openPath(config.filePath());
        break;
      case 'startup':
        app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: Boolean(value) });
        rebuildTray();
        break;
      case 'hooks-install': runHooks('install'); break;
      case 'hooks-remove': runHooks('uninstall'); break;
      case 'agent-install': return assistants.install(value);
      case 'agent-remove': return assistants.uninstall(value);
      case 'agents-refresh': return { ok: true, agents: detectAgents({ force: true }) };
      case 'quit': return askQuit({ chat: false });
      case 'quit-answer': return answerQuit(value);
      default: return NOT_MINE;
    }
  }

  function applyDesktopAction(id, value) {
    const reminders = getReminders();
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
      case 'open-url': {
        const url = String(value || '');
        if (!isAllowedOpenUrl(url)) return { ok: false, message: 'Esa página no está en la lista.' };
        shell.openExternal(url);
        return { ok: true };
      }
      case 'pet-annoyed':
        return { ok: true, line: commandReply('cariciaMolesta', { chat: false, badge: 'OYE' }) };
      case 'wander': updateConfig({ wander: Boolean(value) }); break;
      case 'possess': updateConfig({ possess: Boolean(value) }); break;
      case 'forget': goForgetReply({ chat: false }); break;
      case 'user-name': {
        const name = cleanName(value);
        if (!name) return { ok: false, message: 'Ese nombre no me sirve.' };
        updateConfig({ userName: name });
        return { ok: true, message: `Te voy a llamar ${name}.` };
      }
      case 'time-zone': updateConfig({ timeZone: String(value || '').trim() }); break;
      case 'time-format': updateConfig({ timeFormat: normalizeTimeFormat(value) }); break;
      case 'weather-place': {
        const place = String(value || '').trim().slice(0, 80);
        updateConfig({ weatherPlace: place });
        if (!place) return { ok: true, label: '' };
        if (!getWeather()?.resolvePlace) return { ok: true, offline: true };
        return getWeather().resolvePlace(place).then((resolved) => ({ ok: true, ...resolved }));
      }
      case 'reminder-update': {
        const id = String(value?.id || '').trim();
        const at = Date.parse(String(value?.at || ''));
        if (!id || !Number.isFinite(at)) return { ok: false, message: 'Hora inválida.' };
        const current = (reminders?.list?.() || []).find((item) => item.id === id);
        if (!current) return { ok: false, message: 'No encontré ese recordatorio.' };
        const done = applyReminderEventMove(current, at);
        refreshSettingsMenu();
        return done
          ? { ok: true, message: `Pasado a ${reminderLabel(done)}.` }
          : { ok: false, message: 'No encontré ese recordatorio.' };
      }
      case 'reminder-calendar': {
        const id = String(value?.id || value || '').trim();
        const item = (reminders?.list?.() || []).find((one) => one.id === id);
        if (!item?.fixed) return { ok: false, message: 'Ese recordatorio no tiene fecha fija.' };
        shell.openExternal(calendarUrl(item));
        return { ok: true };
      }
      case 'reminder-delete': {
        const done = reminders?.remove?.(String(value?.id || value || '').trim());
        refreshSettingsMenu();
        return done
          ? { ok: true, message: `Borrado: ${done.text}.` }
          : { ok: false, message: 'No encontré ese recordatorio.' };
      }
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
      case 'clip-save': goClipReply({ chat: false }); break;
      case 'do-something': sendCommand('do-something'); break;
      case 'fix-add': saveFix(value?.heard, value?.meant); break;
      case 'fix-remove': dropFix(value); break;
      case 'menu-keyboard': menuKeyboardOn(Boolean(value)); break;
      case 'talk-hotkey': return setShortcut('talk', value); // old alias from OÍDO
      case 'shortcut-set': return setShortcut(value?.id, value);
      case 'drag-lock':
        config.save({ position: { locked: Boolean(value) } });
        sendCommand('lock-position', { on: Boolean(value) });
        break;
      case 'theme':
        updateConfig({ ui: { theme: value === 'capri' ? 'capri' : 'cyberpunk' } });
        break;
      case 'lang': updateConfig({ lang: value }); break;
      default: return NOT_MINE;
    }
  }

  const domains = [
    applyAppsAction, applyVoiceAction, applyMusicAction, applyChatAction,
    applyGameAction, applySystemAction, applyDesktopAction,
  ];

  return function applyMenuAction(id, value) {
    for (const run of domains) {
      const result = run(id, value);
      if (result !== NOT_MINE) return result;
    }
  };
}

module.exports = { createMenuActions };
