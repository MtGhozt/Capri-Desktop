'use strict';

// Ajustes › AUDIO helpers that lived in main.js: pick/install the voice folder, custom ref wav/txt,
// and the shared "is voice reply on / why is she quiet" status. The sidecar client stays in voice.js.

const path = require('node:path');
const fs = require('node:fs');
const { dialog } = require('electron');

const config = require('./config');
const state = require('./state');
const { reviveMigratedTts } = require('./config');
const { checkVoiceDir, resolveVoiceDir } = require('./voice');
const { PYTHON_URL } = require('./voice-install');
const { VC_MESSAGE } = require('./vc-runtime');
const { saveCustomRef, transcriptFor } = require('./voice-ref');
const { voiceStatus: ttsStatus } = require('./voice-config');

function createVoiceWiring(deps) {
  const {
    root,
    updateConfig,
    getOverlay,
    getSettingsWindow,
    getVoice,
    getVoiceInstall,
  } = deps;

  function resolveVoiceModelsRoot(cfg = config.load()) {
    const raw = cfg?.voice?.dir;
    if (raw != null && String(raw).trim()) return path.resolve(String(raw).trim());
    return path.join(root, 'voice');
  }

  // Ajustes › AUDIO: her voice folder chosen with a dialog instead of hand-editing config.json.
  // A folder that cannot run (no server.py / no .venv) is refused and the config is left alone.
  async function pickVoiceDir() {
    const res = await dialog.showOpenDialog(getOverlay(), {
      title: 'Carpeta de voz',
      properties: ['openDirectory'],
    });
    const chosen = !res.canceled && res.filePaths?.[0];
    if (!chosen) return { ok: false, message: '' };
    const check = checkVoiceDir(chosen);
    if (!check.ok) return check;
    await getVoice()?.stop(); // applyConfig below brings it back up on the new folder
    updateConfig({ voice: { dir: check.dir, ...reviveMigratedTts(config.load().voice) } });
    const says = String(config.load().voice?.replyMode || 'blips') === 'voice' ? '' : ' Elegí VOZ en Respuesta para que te hable.';
    return { ok: true, message: `Voz en ${path.basename(check.dir)}.${says}` };
  }

  // Ajustes › AUDIO › Instalar voz: sources → %LOCALAPPDATA%\capri-desktop\voice, then setup.ps1.
  async function runVoiceInstall(value = {}) {
    const voiceInstall = getVoiceInstall();
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
    await getVoice()?.stop();
    state.ttsLoading = true;
    state.lastTts = { engine: 'omnivoice', state: 'loading' };
    updateConfig({
      voice: {
        dir: check.dir,
        noticeShown: true,
        ...(result.omniVoice ? { tts: 'auto' } : {}),
      },
    });
    getVoice()?.start({ force: true });
    return {
      ok: true,
      needVc: Boolean(result.needVc),
      message: result.needVc ? VC_MESSAGE : 'Voz instalada',
      dir: check.dir,
    };
  }

  // Ajustes › AUDIO › Usar mi propia voz: pick a short .wav (transcript typed in the panel).
  async function pickVoiceRefWav() {
    const settingsWindow = getSettingsWindow();
    const overlay = getOverlay();
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
    const settingsWindow = getSettingsWindow();
    const overlay = getOverlay();
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
    const dir = resolveVoiceDir(root, cfg) || getVoiceInstall()?.dir?.();
    const saved = saveCustomRef({
      voiceDir: dir,
      wavPath: value?.path || value?.wav,
      transcript: value?.transcript ?? value?.text,
      transcriptPath: value?.transcriptPath,
    });
    if (!saved.ok) return saved;
    await getVoice()?.stop();
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
    getVoice()?.start({ force: true });
    return {
      ok: true,
      message: saved.message || 'Tu voz (archivo) lista.',
      ttsRef: saved.ttsRef,
      sourceName: saved.sourceName,
    };
  }

  function clearVoiceRef() {
    getVoice()?.stop();
    updateConfig({ voice: { ttsRef: null } });
    getVoice()?.start({ force: true });
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
      running: getVoice()?.running?.(),
      tts: state.lastTts,
      sleeping: state.overlayFolded,
    });
  }

  return {
    resolveVoiceModelsRoot,
    pickVoiceDir,
    runVoiceInstall,
    pickVoiceRefWav,
    pickVoiceRefText,
    saveVoiceRef,
    clearVoiceRef,
    voiceReplyOn,
    voiceStatus,
  };
}

module.exports = { createVoiceWiring };
