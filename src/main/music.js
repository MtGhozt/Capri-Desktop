'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { redactSpotifyConfig } = require('./spotify');
const { findNamidaTrack } = require('./namida-search');

// PowerShell can't read inside app.asar: in the packaged app the script sits in app.asar.unpacked
const unpackedPath = (p) => p.split(`app.asar${path.sep}`).join(`app.asar.unpacked${path.sep}`);
const KEY_SCRIPT = unpackedPath(path.join(__dirname, 'media-keys.ps1'));

const ACTIONS = new Set(['pause', 'play', 'next', 'previous', 'volumeUp', 'volumeDown', 'mute']);

function createMusic({
  config, apps, sendKey, spotify, isRunning = () => false, spawnProcess = spawn,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  openExternal = null, findTrack = findNamidaTrack,
} = {}) {
  const key = (action) => sendKey(action, KEY_SCRIPT);
  const playerApp = () => apps?.().find((item) => item.name.toLowerCase() === 'namida');

  async function startNamida() {
    const app = playerApp();
    if (!app) return { ok: false, error: 'No encuentro Namida en tus apps. Agrégala en el menú APPS.' };
    if (!(await isRunning('namida'))) {
      spawnProcess(app.target, [], { detached: true, stdio: 'ignore' }).unref();
      await wait(3000); // Namida needs a moment before it listens to media keys
    }
    await key('play');
    return { ok: true, action: 'start' };
  }

  async function playNamidaQuery(query) {
    const hit = findTrack(query);
    if (!hit) return { ok: false };
    const app = playerApp();
    if (!app?.target) {
      return { ok: false, error: 'No encuentro Namida en tus apps. Agrégala en el menú APPS.' };
    }
    if (!(await isRunning('namida'))) {
      spawnProcess(app.target, [hit.path], { detached: true, stdio: 'ignore' }).unref();
      await wait(2500);
    } else {
      spawnProcess(app.target, [hit.path], { detached: true, stdio: 'ignore' }).unref();
      await wait(400);
      await key('play');
    }
    return {
      ok: true, action: 'query', player: 'namida',
      track: hit.title, artist: hit.artist || '', path: hit.path,
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
    if (preferred === 'none') {
      return { ok: false, error: 'No tienes un reproductor de música elegido en el menú.' };
    }
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
    if (ACTIONS.has(parsed.action)) {
      if (parsed.action === 'previous') {
        await key(parsed.action);
        await wait(150);
        await key(parsed.action);
      } else {
        const presses = parsed.action === 'volumeUp' || parsed.action === 'volumeDown' ? 5 : 1;
        for (let i = 0; i < presses; i += 1) await key(parsed.action);
      }
      return { ok: true, action: parsed.action };
    }
    if (parsed.action === 'start') {
      if (cfg.music?.player === 'none') return { ok: false, error: 'No tienes un reproductor de música elegido en el menú.' };
      return startNamida();
    }
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

module.exports = { createMusic, KEY_SCRIPT, unpackedPath };
