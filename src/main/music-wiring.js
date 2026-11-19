'use strict';

// Her music, wired: Spotify's OAuth and encrypted tokens on one side, the local player (Namida)
// and the Windows media keys on the other. main.js only keeps the entry points (menu, replies).

const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, safeStorage, shell } = require('electron');

const config = require('./config');
const {
  createSpotify, createTokenStore, authorizeSpotify, spotifyFailureLine, refreshSpotifyToken,
} = require('./spotify');
const { createMusic, readNowPlaying, NOW_PLAYING_SCRIPT } = require('./music');
const { logEvent, voiceLogPath } = require('./log');

function createMusicWiring({ allApps, rebuildTray, showLine }) {

  // is that program up? (tasklist, so no extra script)
  function processRunning(name) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve(false);
      const child = spawn('tasklist', ['/FI', `IMAGENAME eq ${name}.exe`, '/NH'], { windowsHide: true });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.once('error', () => resolve(false));
      child.once('close', () => resolve(out.toLowerCase().includes(`${name}.exe`)));
    });
  }

  let spotifyAccessToken = null;
  const spotifyTokens = () => createTokenStore({
    file: path.join(app.getPath('userData'), 'spotify-token'),
    safeStorage,
  });
  function restoreSpotifyToken() {
    const saved = spotifyTokens().read();
    if (saved?.access_token) spotifyAccessToken = saved.access_token;
  }
  // Reuse the saved refresh token; one in-flight refresh shared by every caller.
  let spotifyRefreshing = null;
  function refreshSpotifyAccess() {
    if (spotifyRefreshing) return spotifyRefreshing;
    spotifyRefreshing = (async () => {
      const saved = spotifyTokens().read();
      const clientId = String(config.load().music?.spotify?.clientId || '').trim();
      if (!saved?.refresh_token || !clientId) return null;
      try {
        const tokens = await refreshSpotifyToken({ clientId, refreshToken: saved.refresh_token });
        spotifyAccessToken = tokens.access_token;
        spotifyTokens().write({
          ...saved,
          ...tokens,
          refresh_token: tokens.refresh_token || saved.refresh_token,
          expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
        });
        return spotifyAccessToken;
      } catch (err) {
        console.error('[capri] Spotify token refresh failed:', err.message);
        return null;
      } finally {
        spotifyRefreshing = null;
      }
    })();
    return spotifyRefreshing;
  }
  async function connectSpotify(clientId) {
    const id = String(clientId || '').trim();
    if (!id) return { ok: false, message: 'Falta el Client ID.' };
    try {
      const tokens = await authorizeSpotify({
        clientId: id,
        openExternal: (url) => shell.openExternal(url),
        tokenStore: spotifyTokens(),
      });
      spotifyAccessToken = tokens.access_token;
      rebuildTray();
      return { ok: true };
    } catch (err) {
      console.error('[capri] Spotify connection failed:', err.message);
      const message = spotifyFailureLine(err);
      showLine(message, { badge: 'SPOTIFY' }); // the menu used to drop this on the floor
      return { ok: false, message };
    }
  }
  function disconnectSpotify() {
    spotifyAccessToken = null;
    spotifyTokens().clear();
  }
  const spotify = createSpotify({
    token: () => spotifyAccessToken,
    refresh: () => refreshSpotifyAccess(),
    expired: () => {
      const saved = spotifyTokens().read();
      const at = Number(saved?.expiresAt || 0);
      return at > 0 && at <= Date.now();
    },
  });

  const music = createMusic({
    config,
    apps: allApps,
    spotify,
    openExternal: (url) => shell.openExternal(url),
    log: (text) => logEvent(voiceLogPath(), `[capri] ${text}`),
    isRunning: (name) => processRunning(name),
    readNowPlaying: () => readNowPlaying(spawn, NOW_PLAYING_SCRIPT),
    sendKey: (action, script) => new Promise((resolve, reject) => {
      if (process.platform !== 'win32') return reject(new Error('media keys require Windows'));
      const child = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action,
      ], { windowsHide: true });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`media key exited ${code}`)));
    }),
    sendVolume: (action, processNames, script) => new Promise((resolve, reject) => {
      if (process.platform !== 'win32') return reject(new Error('session volume requires Windows'));
      const child = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
        '-Action', action, '-ProcessNames', (processNames || []).join(','),
      ], { windowsHide: true });
      let out = '';
      child.stdout?.on('data', (chunk) => { out += String(chunk); });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) return resolve({ ok: true, out });
        reject(new Error(/NONE/i.test(out) ? 'no music session' : `session volume exited ${code}`));
      });
    }),
  });

  return {
    music,
    connectSpotify,
    disconnectSpotify,
    restoreSpotifyToken,
    hasToken: () => Boolean(spotifyAccessToken),
  };
}

module.exports = { createMusicWiring };
