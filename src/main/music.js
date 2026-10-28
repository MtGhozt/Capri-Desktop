'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { createSpotify, redactSpotifyConfig } = require('./spotify');

const ACTIONS = new Set(['pause', 'play', 'next', 'previous', 'volumeUp', 'volumeDown', 'mute']);

function createMusic({ config, apps, sendKey, spawnProcess = spawn, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), spotify } = {}) {
  const keyScript = path.join(__dirname, 'media-keys.ps1');
  const key = (action) => sendKey(action, keyScript);
  const playerApp = () => apps?.().find((item) => item.name.toLowerCase() === 'namida');

  async function startNamida() {
    const app = playerApp();
    if (app) spawnProcess(app.target, [], { detached: true, stdio: 'ignore' }).unref();
    for (let elapsed = 0; elapsed < 5000; elapsed += 250) {
      await wait(250);
      if (elapsed >= 250) break;
    }
    return key('play');
  }

  async function command(parsed) {
    const cfg = config.load();
    if (ACTIONS.has(parsed.action)) {
      const presses = parsed.action === 'volumeUp' || parsed.action === 'volumeDown' ? 5 : 1;
      for (let i = 0; i < presses; i += 1) await key(parsed.action);
      return { ok: true, action: parsed.action };
    }
    if (parsed.action === 'start') {
      if (cfg.music?.player === 'none') return { ok: false, fallback: true };
      return startNamida();
    }
    if (parsed.action === 'query' && parsed.player === 'spotify' && cfg.music?.spotify?.clientId) {
      return spotify.playQuery(parsed.query);
    }
    if (parsed.action === 'query') {
      await key('play');
      return { ok: true, fallback: true };
    }
    return { ok: false };
  }

  return { command, redactSpotifyConfig };
}

module.exports = { createMusic };
