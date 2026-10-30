'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { redactSpotifyConfig } = require('./spotify');
const {
  findNamidaTrack, listNamidaFiles, shuffleInPlace, writeNamidaM3u,
} = require('./namida-search');

// PowerShell can't read inside app.asar: in the packaged app the script sits in app.asar.unpacked
const unpackedPath = (p) => p.split(`app.asar${path.sep}`).join(`app.asar.unpacked${path.sep}`);
const KEY_SCRIPT = unpackedPath(path.join(__dirname, 'media-keys.ps1'));
const VOLUME_SCRIPT = unpackedPath(path.join(__dirname, 'session-volume.ps1'));

const ACTIONS = new Set(['pause', 'play', 'next', 'previous', 'volumeUp', 'volumeDown', 'mute', 'unmute']);
const VOLUME_ACTIONS = new Set(['volumeUp', 'volumeDown', 'mute', 'unmute']);
const NO_PLAYER = 'No tienes un reproductor de música elegido. Elige uno en el menú, en MÚSICA.';
const NO_MUSIC_APP = 'No encuentro el reproductor de música sonando, choom. Abrilo y pedime de nuevo.';
const QUEUE_CAP = 80;

function createMusic({
  config, apps, sendKey, sendVolume, spotify, isRunning = () => false, spawnProcess = spawn,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  openExternal = null, findTrack = findNamidaTrack, listFiles = listNamidaFiles,
  writePlaylist = writeNamidaM3u, log = () => {},
} = {}) {
  const key = (action) => sendKey(action, KEY_SCRIPT);
  const volumeSession = (action, processNames) => {
    if (!sendVolume) return Promise.reject(new Error('session volume unavailable'));
    return sendVolume(action, processNames, VOLUME_SCRIPT);
  };
  const playerApp = () => apps?.().find((item) => item.name.toLowerCase() === 'namida');

  function volumeProcesses(preferred) {
    if (preferred === 'spotify') return ['Spotify', 'SpotifyEXE'];
    return ['namida', 'Namida'];
  }

  // Music only: Spotify Web API when connected, else that app's Windows audio session. Never master.
  async function adjustVolume(action) {
    const preferred = config.load().music?.player || 'namida';
    if (preferred === 'none') return { ok: false, error: NO_PLAYER };
    if (preferred === 'spotify' && spotify?.volume) {
      const api = await spotify.volume(action).catch(() => null);
      if (api?.ok) return { ...api, action };
    }
    const processes = volumeProcesses(preferred);
    try {
      await volumeSession(action, processes);
      return { ok: true, action, player: preferred, via: 'session' };
    } catch (err) {
      log(`session volume failed: ${err.message}`);
      return { ok: false, error: NO_MUSIC_APP };
    }
  }

  // Spotify through its own URI: the desktop app or the Store one answers it
  async function openSpotify() {
    if (typeof openExternal !== 'function') return { ok: false, error: 'No pude abrir Spotify.' };
    try {
      await openExternal('spotify:');
      return { ok: true, player: 'spotify' };
    } catch {
      return { ok: false, error: 'No pude abrir Spotify. ¿Está instalado?' };
    }
  }

  // "abre el reproductor de música": whichever one is chosen in Ajustes › MÚSICA
  async function openPlayer() {
    const preferred = config.load().music?.player || 'namida';
    if (preferred === 'none') return { ok: false, error: NO_PLAYER };
    if (preferred === 'spotify') return openSpotify();
    const app = playerApp();
    if (!app?.target) return { ok: false, error: 'No encuentro Namida en tus apps. Agrégala en el menú APPS.' };
    spawnProcess(app.target, [], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, player: 'namida' };
  }

  // "pon música": the chosen player, never the global key over whatever had media focus
  async function startPlayer() {
    const preferred = config.load().music?.player || 'namida';
    if (preferred === 'none') return { ok: false, error: NO_PLAYER };
    if (preferred !== 'spotify') return startNamida();
    const api = spotify?.resume ? await spotify.resume(openSpotify).catch(() => null) : null;
    // API play worked (Premium + active device)
    if (api?.ok && !api.opened && !api.fallback) {
      return { ok: true, action: 'start', player: 'spotify' };
    }
    // Free / no token / no device: media play (toggle). resume() may already have opened the app.
    if (!api?.opened) {
      const opened = await openSpotify();
      if (!opened.ok) return opened;
    }
    await wait(900);
    await key('play');
    return {
      ok: true, action: 'start', player: 'spotify', via: 'media-keys',
      freeHint: true,
    };
  }

  function namidaQueue(leadPath = null) {
    const files = listFiles();
    if (!files.length) return null;
    const rest = files.filter((p) => p !== leadPath);
    shuffleInPlace(rest);
    const ordered = leadPath ? [leadPath, ...rest] : shuffleInPlace(files.slice());
    return writePlaylist(ordered.slice(0, QUEUE_CAP));
  }

  async function startNamida() {
    const app = playerApp();
    if (!app?.target) {
      return { ok: false, error: 'No encuentro Namida en tus apps. Agrégala en el menú APPS.' };
    }
    // Hand Namida a shuffled .m3u so next/previous walk the library. Opening a bare exe + play
    // key toggles pause (VK_MEDIA_PLAY_PAUSE) and leaves a one-track queue.
    const playlist = namidaQueue();
    const running = await isRunning('namida');
    if (playlist) {
      spawnProcess(app.target, [playlist], { detached: true, stdio: 'ignore' }).unref();
      await wait(running ? 500 : 2500);
      // file/m3u handoff already starts playback — a play key would pause it
      return { ok: true, action: 'start', player: 'namida', queue: true };
    }
    spawnProcess(app.target, [], { detached: true, stdio: 'ignore' }).unref();
    if (!running) await wait(3000);
    await key('play');
    return { ok: true, action: 'start', player: 'namida', queue: false };
  }

  async function playNamidaQuery(query) {
    const hit = findTrack(query);
    if (!hit) return { ok: false };
    log(`namida match: ${hit.title} score=${hit.score}`);
    const app = playerApp();
    if (!app?.target) {
      return { ok: false, error: 'No encuentro Namida en tus apps. Agrégala en el menú APPS.' };
    }
    // Lead with the match inside a library queue when we can; bare file = one-track next/prev.
    const playlist = namidaQueue(hit.path) || hit.path;
    const running = await isRunning('namida');
    spawnProcess(app.target, [playlist], { detached: true, stdio: 'ignore' }).unref();
    await wait(running ? 400 : 2500);
    return {
      ok: true, action: 'query', player: 'namida',
      track: hit.title, artist: hit.artist || '', path: hit.path,
      queue: playlist !== hit.path,
    };
  }

  async function playSpotifyQuery(query) {
    if (spotify) {
      // search or play blowing up (free account, no device) still ends in the app, not an error
      const api = await spotify.playQuery(query, openExternal).catch(() => null);
      if (api?.ok) return { ...api, action: 'query', player: 'spotify' };
    }
    if (typeof openExternal !== 'function') {
      return { ok: false, error: 'No pude abrir Spotify.' };
    }
    const uri = `spotify:search:${query}`;
    await openExternal(uri);
    return {
      ok: true, action: 'query', player: 'spotify', searchOnly: true,
      query, track: query, artist: '',
    };
  }

  async function playQuery(query) {
    const cfg = config.load();
    const preferred = cfg.music?.player || 'namida';
    if (preferred === 'none') return { ok: false, error: NO_PLAYER };
    const order = preferred === 'spotify' ? ['spotify', 'namida'] : ['namida', 'spotify'];
    let lastMiss = null;
    for (const who of order) {
      const result = who === 'spotify'
        ? await playSpotifyQuery(query)
        : await playNamidaQuery(query);
      if (result?.ok) return result;
      if (result?.error) lastMiss = result;
    }
    if (lastMiss?.error && /apps|reproductor elegido/i.test(lastMiss.error)) return lastMiss;
    return { ok: false, error: `No encontré «${query}».` };
  }

  async function command(parsed) {
    const cfg = config.load();
    if (VOLUME_ACTIONS.has(parsed.action)) return adjustVolume(parsed.action);
    if (ACTIONS.has(parsed.action)) {
      if (parsed.action === 'previous') {
        await key(parsed.action);
        await wait(150);
        await key(parsed.action);
      } else {
        await key(parsed.action);
      }
      return { ok: true, action: parsed.action };
    }
    if (parsed.action === 'open') return openPlayer();
    if (parsed.action === 'start') return startPlayer();
    if (parsed.action === 'nowPlaying' && cfg.music?.spotify?.clientId) {
      const result = await spotify.nowPlaying();
      return result?.ok ? result : { ok: false, error: 'No pude leer qué está sonando en Spotify.' };
    }
    if (parsed.action === 'nowPlaying') return { ok: false, error: 'Solo sé qué está sonando con Spotify conectado.' };
    if (parsed.action === 'query') {
      if (parsed.player === 'spotify') return playSpotifyQuery(parsed.query);
      return playQuery(parsed.query);
    }
    return { ok: false, error: 'No entendí qué hacer con la música.' };
  }

  return { command, redactSpotifyConfig, playQuery };
}

module.exports = { createMusic, KEY_SCRIPT, VOLUME_SCRIPT, unpackedPath, NO_MUSIC_APP };
