'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { redactSpotifyConfig } = require('./spotify');

// PowerShell can't read inside app.asar: in the packaged app the script sits in app.asar.unpacked
const unpackedPath = (p) => p.split(`app.asar${path.sep}`).join(`app.asar.unpacked${path.sep}`);
const KEY_SCRIPT = unpackedPath(path.join(__dirname, 'media-keys.ps1'));

const ACTIONS = new Set(['pause', 'play', 'next', 'previous', 'volumeUp', 'volumeDown', 'mute']);

function createMusic({
  config, apps, sendKey, spotify, isRunning = () => false, spawnProcess = spawn,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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

  async function command(parsed) {
    const cfg = config.load();
    if (ACTIONS.has(parsed.action)) {
      const presses = parsed.action === 'volumeUp' || parsed.action === 'volumeDown' ? 5 : 1;
      for (let i = 0; i < presses; i += 1) await key(parsed.action);
      return { ok: true, action: parsed.action };
    }
    if (parsed.action === 'start') {
      if (cfg.music?.player === 'none') return { ok: false, error: 'No tienes un reproductor de música elegido en el menú.' };
      return startNamida();
    }
    if (parsed.action === 'query' && parsed.player === 'spotify' && cfg.music?.spotify?.clientId) {
      const result = await spotify.playQuery(parsed.query);
      return result?.ok ? result : { ok: false, error: 'No pude poner eso en Spotify. Revisa que esté conectado en el menú.' };
    }
    if (parsed.action === 'nowPlaying' && cfg.music?.spotify?.clientId) {
      const result = await spotify.nowPlaying();
      return result?.ok ? result : { ok: false, error: 'No pude leer qué está sonando en Spotify.' };
    }
    if (parsed.action === 'nowPlaying') return { ok: false, error: 'Solo sé qué está sonando con Spotify conectado.' };
    if (parsed.action === 'query') {
      return { ok: false, error: 'Todavía no sé buscar canciones en Namida. Ponla tú y dime "sigue" o "siguiente".' };
    }
    return { ok: false, error: 'No entendí qué hacer con la música.' };
  }

  return { command, redactSpotifyConfig };
}

module.exports = { createMusic, KEY_SCRIPT, unpackedPath };
