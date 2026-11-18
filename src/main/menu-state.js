'use strict';

// The menu:get payload: one projection of config and live state that the tray menu, the overlay
// quick menu and the settings window all render. Her live pieces (instances, the mutable lets)
// come in as getters so the payload is always the current one.

const path = require('node:path');
const fs = require('node:fs');
const { app, screen } = require('electron');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const {
  PROVIDERS, providerOptions, isCloud, isAgent, defaultBaseUrl, BRAIN_GROUPS, FREE_KEY_LINKS, OWN_KEY_LINKS,
  supportsVision, provider, activeBrainIds,
} = require('./chat-providers');
const { gameAppKey } = require('./game-detect');
const { aboutInfo } = require('./about');
const { detectAgents } = require('./agent-brain');
const { modelForProvider } = require('./chat-models');
const { parseRenderMode, HINTS: RENDER_HINTS, SOFTWARE_CONFIRM } = require('./render-mode');
const { checkVoiceDir } = require('./voice');
const { hasNvidiaGpu } = require('./voice-install');
const { VC_MESSAGE, missingVcRuntime } = require('./vc-runtime');
const { activeVoiceLabel } = require('./voice-ref');
const { normalizeTimeFormat } = require('./reminders');
const { normalizeGamingMode } = require('./game-comment');
const { pctFromThreshold, SENS_MIN, SENS_MAX, SENS_STEP } = require('./hearing');
const { wakePhraseLabel } = require('./wake-phrase');
const { clipFolderLabel } = require('./clips');
const { micActive } = require('./voice-config');
const { cleanFixes } = require('./fixes');
const { TYPE_LABEL } = require('./apps-config');

function createMenuState(deps) {

  const {
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
    getVoice,
    getVoiceInstall,
    getReminders,
    getLastWindows,
    getTalkCombo,
    getScanRunning,
    hasSpotifyToken,
  } = deps;

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
      folded: Boolean(extra.folded ?? state.overlayFolded),
      cfg: {
        visible: cfg.visible,
        scale: cfg.scale,
        muted: cfg.muted,
        wander: cfg.wander,
        possess: cfg.possess,
        mic: micActive(cfg),
        micDevice: cfg.voice?.inputDevice ?? null,
        replyMode: String(cfg.voice?.replyMode || 'blips'),
        wakeSensitivity: String(cfg.voice?.wakeSensitivity || 'normal'),
        voice: {
          dir: String(cfg.voice?.dir || ''),
          installed: Boolean(checkVoiceDir(cfg.voice?.dir || '').ok),
          ttsRef: cfg.voice?.ttsRef || null,
          status: voiceStatus(cfg),
          tts: state.lastTts,
          source: activeVoiceLabel(cfg.voice),
        },
        locked: Boolean(cfg.position?.locked),
        userName: String(cfg.userName || ''),
        timeZone: String(cfg.timeZone || ''),
        timeFormat: normalizeTimeFormat(cfg.timeFormat),
        weatherPlace: String(cfg.weatherPlace || ''),
        reminders: (getReminders()?.list?.() || []).map((item) => ({
          id: item.id,
          at: item.at,
          text: item.text,
          when: reminderLabel(item),
          eventAt: item.eventAt || null,
          noticeMin: item.noticeMin || 0,
        })),
        theme: cfg.ui?.theme === 'capri' ? 'capri' : 'cyberpunk',
        gaming: {
          mode: normalizeGamingMode(cfg.gaming?.mode),
          drone: cfg.gaming?.drone !== false,
          apps: Array.isArray(cfg.gaming?.apps) ? cfg.gaming.apps : [],
          gamepadPtt: Array.isArray(cfg.gaming?.gamepadPtt) ? cfg.gaming.gamepadPtt.map(Number).filter(Number.isFinite) : [6, 7],
          fgExe: getLastWindows()?.fgExe || '',
          fgKey: gameAppKey(getLastWindows()?.fgExe || ''),
          commentWarned: Boolean(cfg.gaming?.commentWarned),
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
        musicPlayer: ['namida', 'spotify', 'youtube', 'none'].includes(cfg.music?.player) ? cfg.music.player : 'namida',
        render: parseRenderMode(cfg.render),
      },
      renderHints: RENDER_HINTS,
      softwareConfirm: SOFTWARE_CONFIRM,
      hearing: {
        fixes: cleanFixes(cfg.hearing?.fixes),
        lastHeard: state.lastHeard,
        sensitivity: pctFromThreshold(cfg.voice?.wakeThreshold),
        sensMin: SENS_MIN,
        sensMax: SENS_MAX,
        sensStep: SENS_STEP,
        talkHotkey: getTalkCombo() || talkHotkey(cfg),
        talkActive: Boolean(getTalkCombo()),
        pauseBeforeCut: String(cfg.voice?.pauseBeforeCut || 'normal'),
        followUpSec: followUpSec(cfg),
        wakePhrase: wakePhraseLabel(
          cfg.voice?.wakeModel,
          path.join(resolveVoiceModelsRoot(cfg), 'models'),
        ),
      },
      music: {
        clientId: String(cfg.music?.spotify?.clientId || ''),
        connected: hasSpotifyToken(),
      },
      model: (() => {
        const id = String(cfg.llm?.provider || 'local');
        const safe = PROVIDERS[id] ? id : 'local';
        const hasKeys = {};
        for (const pid of Object.keys(PROVIDERS)) {
          if (!PROVIDERS[pid].local) hasKeys[pid] = Boolean(llmKey(pid));
        }
        return {
          provider: safe,
          brains: activeBrainIds(cfg.llm),
          brainChain: activeBrainIds(cfg.llm).map((brain) => ({
            id: brain,
            label: provider(brain).label,
          })),
          providers: providerOptions(),
          groups: BRAIN_GROUPS,
          freeLinks: FREE_KEY_LINKS,
          ownLinks: OWN_KEY_LINKS,
          // light = overlay quick menu: skip PATH scans so the first paint is not empty for seconds
          agentsInstalled: extra.light ? (extra.agentsInstalled || []) : detectAgents(),
          agentPreferred: String(cfg.llm?.agentPreferred || 'claude'),
          model: String(cfg.llm?.model || ''),
          models: Object.fromEntries(BRAIN_GROUPS.cards.map((pid) => [
            pid,
            modelForProvider(cfg.llm || {}, pid, PROVIDERS),
          ])),
          baseUrls: { ...(cfg.llm?.baseUrls || {}) },
          baseUrl: String(cfg.llm?.baseUrl || defaultBaseUrl(safe)),
          local: !isCloud(safe),
          agent: isAgent(safe),
          hasKey: Boolean(llmKey(safe)),
          hasKeys,
          shareScreen: cfg.llm?.shareScreen === true,
          autoLook: cfg.llm?.autoLook === true,
          shareMemory: cfg.llm?.shareMemory === true,
          vision: supportsVision(
            String(cfg.llm?.provider || 'local'),
            String(cfg.llm?.model || ''),
          ),
        };
      })(),
      about: aboutInfo({ version: app.getVersion() }),
      updates: {
        enabled: cfg.updates?.enabled !== false,
        skippedVersion: String(cfg.updates?.skippedVersion || ''),
        lastCheck: Number(cfg.updates?.lastCheck) || 0,
      },
      apps: extra.light ? { list: [] } : appsMenuState(),
      agents: extra.light ? [] : assistants.statusAll(),
      found: extra.light ? { at: null, scanning: false, counts: null, items: [] } : {
        at: scanned().at || null,
        scanning: Boolean(getScanRunning()),
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
        hotkey: hasNvidiaGpu() ? (cfg.clips?.saveHotkey || 'Alt+F10') : GAME_BAR_CLIP_HOTKEY,
        folder: clipFolderLabel(cfg),
        nvidia: hasNvidiaGpu(),
      },
      shortcuts: [
        { id: 'toggle', label: 'Mostrar / ocultar Capri', accel: cfg.shortcuts?.toggle || '', active: Boolean(shortcutActive.toggle) },
        { id: 'chat', label: 'Abrir el chat', accel: cfg.shortcuts?.chat || '', active: Boolean(shortcutActive.chat) },
        { id: 'talk', label: 'Escuchar / detener', accel: getTalkCombo() || talkHotkey(cfg), active: Boolean(getTalkCombo()) },
      ],
      micDevices: getVoice()?.devices() || [],
      voiceInstall: getVoiceInstall()?.status?.() || null,
      vcMissing: missingVcRuntime(),
      vcMessage: VC_MESSAGE,
      displays: displays.map((d, i) => ({
        id: d.id,
        label: `${i + 1} — ${d.size.width}×${d.size.height}`,
        current: d.id === current,
      })),
      login: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      deskShortcut: fs.existsSync(path.join(app.getPath('desktop'), 'Capri.lnk')),
      online: t.online(PORT),
    };
  }

  return menuState;
}

module.exports = { createMenuState };
