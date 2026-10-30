'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

function createPkce(randomBytes = crypto.randomBytes) {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function redactSpotifyConfig(value) {
  return { connected: Boolean(value?.accessToken || value?.refreshToken) };
}

function createTokenStore({ file, safeStorage } = {}) {
  const fs = require('node:fs');
  function read() {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      return JSON.parse(safeStorage?.isEncryptionAvailable?.() ? safeStorage.decryptString(Buffer.from(raw, 'base64')) : raw);
    } catch { return null; }
  }
  function write(tokens) {
    const raw = JSON.stringify(tokens);
    const out = safeStorage?.isEncryptionAvailable?.()
      ? safeStorage.encryptString(raw).toString('base64')
      : raw;
    fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
    fs.writeFileSync(file, out, { mode: 0o600 });
  }
  function clear() { try { fs.rmSync(file, { force: true }); } catch { /* disconnected */ } }
  return { read, write, clear };
}

// 47824 is the voice sidecar's; this one has to be free for the OAuth callback.
const OAUTH_PORT = 47835;

function spotifyFailureLine(err) {
  return `No pude conectar Spotify: ${err?.message || err}`;
}

async function authorizeSpotify({ clientId, openExternal, tokenStore, port = OAUTH_PORT, fetcher = fetch }) {
  const { verifier, challenge } = createPkce();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = crypto.randomBytes(16).toString('hex');
  const auth = new URL('https://accounts.spotify.com/authorize');
  for (const [key, value] of Object.entries({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri,
    code_challenge_method: 'S256', code_challenge: challenge,
    state, scope: 'user-read-playback-state user-modify-playback-state',
  })) auth.searchParams.set(key, value);
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== '/callback') {
        res.writeHead(404); res.end('Not found'); return;
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400); res.end('Invalid state'); server.close(); reject(new Error('Spotify OAuth state mismatch')); return;
      }
      const value = url.searchParams.get('code');
      res.end('Capri connected. You can close this tab.');
      server.close();
      value ? resolve(value) : reject(new Error('Spotify authorization was denied'));
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => openExternal(auth.toString()));
  });
  const response = await fetcher('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, grant_type: 'authorization_code', code,
      redirect_uri: redirectUri, code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error(`Spotify token HTTP ${response.status}`);
  const tokens = await response.json();
  tokenStore.write({ ...tokens, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 });
  return tokens;
}

function createSpotify({ token, request = defaultRequest } = {}) {
  async function playQuery(query, openTrack) {
    const access = token?.();
    if (!access) return { ok: false, fallback: true };
    const result = await request('/v1/search', access, { q: query, type: 'track', limit: 1 });
    const track = result?.tracks?.items?.[0];
    if (!track) return { ok: false, error: 'No encontré esa canción.' };
    try {
      await request('/v1/me/player/play', access, { uris: [track.uri] }, 'PUT');
    } catch {
      // play needs Premium (403) and a live device: hand the track to the desktop app instead
      if (!openTrack) throw new Error('Spotify no pudo reproducir esa canción.');
      await openTrack(track.uri);
    }
    return { ok: true, track: track.name, artist: track.artists?.[0]?.name || '' };
  }

  // "pon música": resume in Spotify itself. No Premium (403) or no live device: the app is open,
  // not an error.
  async function resume(openApp) {
    const access = token?.();
    if (!access) return { ok: false, fallback: true };
    try {
      await request('/v1/me/player/play', access, undefined, 'PUT');
      return { ok: true };
    } catch {
      await openApp?.();
      return { ok: true, opened: true };
    }
  }

  async function nowPlaying() {
    const access = token?.();
    if (!access) return { ok: false, fallback: true };
    const item = await request('/v1/me/player', access);
    return item?.item ? { ok: true, track: item.item.name, artist: item.item.artists?.[0]?.name || '' } : { ok: false };
  }

  // Music volume only (Web API). Never the PC master volume.
  async function volume(action) {
    const access = token?.();
    if (!access) return { ok: false, fallback: true };
    let player;
    try {
      player = await request('/v1/me/player', access);
    } catch {
      return { ok: false, fallback: true };
    }
    if (!player?.device) return { ok: false, fallback: true };
    const cur = Number(player.device.volume_percent);
    const base = Number.isFinite(cur) ? cur : 50;
    let next = base;
    if (action === 'mute') next = 0;
    else if (action === 'unmute') next = base < 5 ? 50 : base;
    else if (action === 'volumeUp') next = Math.min(100, base + 10);
    else if (action === 'volumeDown') next = Math.max(0, base - 10);
    else return { ok: false, error: 'volume action desconocida' };
    try {
      await request(`/v1/me/player/volume?volume_percent=${next}`, access, undefined, 'PUT');
      return { ok: true, player: 'spotify', volume: next };
    } catch {
      return { ok: false, fallback: true };
    }
  }

  return { playQuery, resume, nowPlaying, volume };
}

function defaultRequest(endpoint, access, body, method = 'GET') {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.spotify.com${endpoint}`);
    if (method === 'GET' && body) for (const [key, value] of Object.entries(body)) url.searchParams.set(key, value);
    const req = https.request(url, {
      method,
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Spotify HTTP ${res.statusCode}`));
        resolve(raw ? JSON.parse(raw) : {});
      });
    });
    req.on('error', reject);
    if (method !== 'GET' && body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = {
  createPkce, createSpotify, redactSpotifyConfig, createTokenStore, authorizeSpotify, spotifyFailureLine,
};
