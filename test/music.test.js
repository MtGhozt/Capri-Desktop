'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { parseMusicCommand, DEFAULT_HER_SONG } = require('../src/main/music-command');
const { createPkce } = require('../src/main/spotify');

test('parses media commands without matching ordinary phrases', () => {
  assert.deepEqual(parseMusicCommand('pausa la música'), { action: 'pause' });
  assert.deepEqual(parseMusicCommand('sigue'), { action: 'play' });
  assert.deepEqual(parseMusicCommand('la siguiente'), { action: 'next' });
  assert.deepEqual(parseMusicCommand('baja el volumen'), { action: 'volumeDown' });
  assert.deepEqual(parseMusicCommand('silencio'), { action: 'mute' });
  assert.deepEqual(parseMusicCommand('qué está sonando'), { action: 'nowPlaying' });
  assert.equal(parseMusicCommand('la siguiente pregunta'), null);
});

test('pause intents win over pon/play search (not a song named pausa)', () => {
  for (const said of [
    'Pon pausa a la música',
    'pon la música en pausa',
    'ponme en pausa',
    'pausa',
    'pausá la música',
    'detené la canción',
    'stop',
  ]) {
    assert.deepEqual(parseMusicCommand(said), { action: 'pause' }, said);
  }
  // real searches still go through
  assert.deepEqual(parseMusicCommand('pon never gonna give you up'), {
    action: 'query', query: 'never gonna give you up',
  });
  assert.deepEqual(parseMusicCommand('pon bohemian rhapsody'), {
    action: 'query', query: 'bohemian rhapsody',
  });
});

test('her song phrases map to music.herSong (default)', () => {
  assert.equal(DEFAULT_HER_SONG, "I'm in love with myself");
  for (const said of ['pon tu canción', 'pon tu canción favorita', 'tu canción', 'play your song']) {
    assert.deepEqual(parseMusicCommand(said), {
      action: 'query', query: DEFAULT_HER_SONG, herSong: true,
    }, said);
  }
  assert.deepEqual(parseMusicCommand('pon tu canción', { herSong: 'Custom Hit' }), {
    action: 'query', query: 'Custom Hit', herSong: true,
  });
});

test('creates a valid PKCE verifier and S256 challenge', () => {
  const { verifier, challenge } = createPkce(() => Buffer.from('test verifier'));
  assert.equal(verifier, 'dGVzdCB2ZXJpZmllcg');
  assert.equal(challenge, 'yLtFkGlKJDXhx7d1SrDiLDUKT_Hx0sHo3tbzHhGlUHw');
});

test('spotify playback falls back when no token is available', async () => {
  const { createSpotify } = require('../src/main/spotify');
  const spotify = createSpotify({ token: () => null });
  assert.deepEqual(await spotify.playQuery('neon genesis'), { ok: false, fallback: true });
});

test('spotify credentials are not persisted by config or logs', () => {
  const { redactSpotifyConfig } = require('../src/main/spotify');
  const safe = redactSpotifyConfig({ clientId: 'client-secret', accessToken: 'access-secret', refreshToken: 'refresh-secret' });
  assert.deepEqual(safe, { connected: true });
  assert.equal(JSON.stringify(safe).includes('secret'), false);
});

test('resuming with a free account opens the app instead of erroring', async () => {
  const { createSpotify } = require('../src/main/spotify');
  const calls = [];
  const opened = [];
  const spotify = createSpotify({
    token: () => 'token',
    request: async (endpoint, access, body, method = 'GET') => {
      calls.push(`${method} ${endpoint}`);
      throw new Error('Spotify HTTP 403');
    },
  });
  assert.deepEqual(await spotify.resume(async () => { opened.push('app'); }), { ok: true, opened: true });
  assert.deepEqual(calls, ['PUT /v1/me/player/play']);
  assert.deepEqual(opened, ['app']);
  assert.deepEqual(await createSpotify({ token: () => null }).resume(), { ok: false, fallback: true });
});

test('a free account opens the track in the app instead of failing on 403', async () => {
  const { createSpotify } = require('../src/main/spotify');
  const calls = [];
  const opened = [];
  const spotify = createSpotify({
    token: () => 'token',
    request: async (endpoint, access, body, method = 'GET') => {
      calls.push(`${method} ${endpoint}`);
      if (endpoint === '/v1/search') {
        return { tracks: { items: [{ uri: 'spotify:track:abc', name: 'Neon', artists: [{ name: 'Juno' }] }] } };
      }
      throw new Error('Spotify HTTP 403'); // play needs Premium
    },
  });
  const result = await spotify.playQuery('neon', async (uri) => { opened.push(uri); });
  assert.deepEqual(result, { ok: true, track: 'Neon', artist: 'Juno' });
  assert.deepEqual(opened, ['spotify:track:abc']);
  assert.deepEqual(calls, ['GET /v1/search', 'PUT /v1/me/player/play']); // no devices round-trip
});

test('spotify oauth listens on 47835, 404s anything but /callback and exchanges the code', async () => {
  const { authorizeSpotify } = require('../src/main/spotify');
  let stray = null;
  const store = { write() {} };
  const result = await authorizeSpotify({
    clientId: 'client-id',
    tokenStore: store,
    openExternal: async (authUrl) => {
      const { searchParams } = new URL(authUrl);
      assert.equal(searchParams.get('redirect_uri'), 'http://127.0.0.1:47835/callback');
      stray = await fetch('http://127.0.0.1:47835/not-the-callback');
      await fetch(`http://127.0.0.1:47835/callback?state=${searchParams.get('state')}&code=the-code`);
    },
    fetcher: async (url, options) => {
      assert.equal(options.body.get('redirect_uri'), 'http://127.0.0.1:47835/callback');
      assert.equal(options.body.get('code'), 'the-code');
      return { ok: true, json: async () => ({ access_token: 'a', expires_in: 3600 }) };
    },
  });
  assert.equal(stray.status, 404);
  assert.equal(result.access_token, 'a');
});

test('a taken oauth port is reported with its cause instead of swallowed', async () => {
  const { authorizeSpotify, spotifyFailureLine } = require('../src/main/spotify');
  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(47835, '127.0.0.1', resolve));
  const err = await authorizeSpotify({
    clientId: 'client-id',
    openExternal: async () => {},
    tokenStore: { write() {} },
  }).then(() => null, (e) => e);
  blocker.close();
  assert.equal(err.code, 'EADDRINUSE');
  assert.match(spotifyFailureLine(err), /EADDRINUSE/);
});
