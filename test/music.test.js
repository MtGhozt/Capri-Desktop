'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMusicCommand } = require('../src/main/music-command');
const { createPkce } = require('../src/main/spotify');

test('parses media commands without matching ordinary phrases', () => {
  assert.deepEqual(parseMusicCommand('pausa la música'), { action: 'pause' });
  assert.deepEqual(parseMusicCommand('sigue'), { action: 'play' });
  assert.deepEqual(parseMusicCommand('la siguiente'), { action: 'next' });
  assert.deepEqual(parseMusicCommand('baja el volumen'), { action: 'volumeDown' });
  assert.deepEqual(parseMusicCommand('silencio'), { action: 'mute' });
  assert.equal(parseMusicCommand('la siguiente pregunta'), null);
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
