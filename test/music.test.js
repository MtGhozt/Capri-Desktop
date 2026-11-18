'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { parseMusicCommand, DEFAULT_HER_SONG } = require('../src/main/music-command');
const { parseNowPlaying, readNowPlaying, createMusic } = require('../src/main/music');
const { createPkce } = require('../src/main/spotify');

test('parses media commands without matching ordinary phrases', () => {
  assert.deepEqual(parseMusicCommand('pausa la música'), { action: 'pause' });
  assert.deepEqual(parseMusicCommand('sigue'), { action: 'play' });
  assert.deepEqual(parseMusicCommand('la siguiente'), { action: 'next' });
  assert.deepEqual(parseMusicCommand('baja el volumen de la música'), { action: 'volumeDown' });
  assert.deepEqual(parseMusicCommand('silencia la música'), { action: 'mute' });
  assert.equal(parseMusicCommand('silencio'), null); // system mute → pc-actions
  assert.equal(parseMusicCommand('baja el volumen'), null); // system master → pc-actions
  assert.deepEqual(parseMusicCommand('qué está sonando'), { action: 'nowPlaying' });
  assert.equal(parseMusicCommand('la siguiente pregunta'), null);
});

test('plain mute/unmute/volume are not music; theme/volume set are not song searches', () => {
  for (const said of [
    'mute', 'silencio', 'silenciá', 'quitá el sonido', 'desmutea', 'activá el sonido',
    'subí el volumen', 'sube el volumen', 'bajá el volumen', 'más volumen', 'menos volumen',
  ]) {
    assert.equal(parseMusicCommand(said), null, said);
  }
  assert.deepEqual(parseMusicCommand('muteá la música'), { action: 'mute' });
  assert.deepEqual(parseMusicCommand('desmutea la música'), { action: 'unmute' });
  assert.deepEqual(parseMusicCommand('sube el volumen de la música'), { action: 'volumeUp' });
  assert.deepEqual(parseMusicCommand('sube la música'), { action: 'volumeUp' });
  for (const said of ['poné modo oscuro', 'pon tema claro', 'pon el volumen a 30', 'pon brillo']) {
    assert.equal(parseMusicCommand(said), null, said);
  }
});

test('pause intents win over pon/play search (not a song named pausa)', () => {
  for (const said of [
    'Pon pausa a la música',
    'pon la música en pausa',
    'pausa la música',
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

test('resume/unpause intents are play, never a song search', () => {
  for (const said of [
    'despausa',
    'despausa la música',
    'despauza la canción',
    'reanuda',
    'reanuda la música',
    'continúa la música',
    'continua la musica',
    'sigue la música',
    'dale play',
  ]) {
    assert.deepEqual(parseMusicCommand(said), { action: 'play' }, said);
  }
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

test('voseo and generic song requests reach playback, not a fake title', () => {
  for (const said of ['Ponés reproducir bohemian rhapsody', 'Reproducí neon genesis']) {
    assert.equal(parseMusicCommand(said)?.action, 'query', said);
  }
  assert.deepEqual(parseMusicCommand('Ponés reproducir bohemian rhapsody'), {
    action: 'query', query: 'bohemian rhapsody',
  });
  for (const said of [
    'Poné una canción',
    'poné música',
    'Ponés reproducir cualquier canción',
    'Poné cualquier tema',
    'Pon algo de música',
    'cualquier canción',
  ]) {
    assert.deepEqual(parseMusicCommand(said), { action: 'start' }, said);
  }
  assert.deepEqual(parseMusicCommand('Poné reproducir neon genesis en Spotify'), {
    action: 'query', query: 'neon genesis', player: 'spotify',
  });
});

test('now playing reads the Namida SMTC line, then its window title', () => {
  assert.deepEqual(parseNowPlaying('SMTC\tnamida.exe\tWorth It\tCorbin'), {
    ok: true, player: 'namida', track: 'Worth It', artist: 'Corbin',
  });
  assert.deepEqual(parseNowPlaying('WINDOW\tWorth It • Namida'), {
    ok: true, player: 'namida', via: 'window', artist: '', track: 'Worth It',
  });
  assert.deepEqual(parseNowPlaying('WINDOW\tCorbin - Worth It'), {
    ok: true, player: 'namida', via: 'window', artist: 'Corbin', track: 'Worth It',
  });
  // Another player's SMTC session is not Namida.
  assert.deepEqual(parseNowPlaying('SMTC\tSpotify.exe\tSong\tArtist'), { ok: false });
  assert.deepEqual(parseNowPlaying(''), { ok: false });
});

test('now playing reads the browser session as YouTube Music, never as Namida', () => {
  assert.deepEqual(parseNowPlaying('SMTC\tchrome.exe\tNeon\tJuno', 'youtube'), {
    ok: true, player: 'youtube', track: 'Neon', artist: 'Juno',
  });
  assert.deepEqual(parseNowPlaying('SMTC\tmsedge.exe\tNeon\tJuno', 'youtube').player, 'youtube');
  assert.deepEqual(parseNowPlaying('SMTC\tfirefox.exe\tNeon\tJuno', 'youtube').player, 'youtube');
  assert.deepEqual(parseNowPlaying('SMTC\tbrave.exe\tNeon\tJuno', 'youtube').player, 'youtube');
  // A browser tab is not music when Namida is the chosen player
  assert.deepEqual(parseNowPlaying('SMTC\tchrome.exe\tNeon\tJuno'), { ok: false });
  // Namida keeps working when it is the chosen player
  assert.deepEqual(parseNowPlaying('SMTC\tnamida.exe\tWorth It\tCorbin', 'namida'), {
    ok: true, player: 'namida', track: 'Worth It', artist: 'Corbin',
  });
});

test('pon <song> en YouTube Music routes to YouTube, whatever player is chosen', () => {
  assert.deepEqual(parseMusicCommand('Poné Neon Genesis en YouTube Music'), {
    action: 'query', query: 'neon genesis', player: 'youtube',
  });
  assert.deepEqual(parseMusicCommand('reproducí emo girl en youtube'), {
    action: 'query', query: 'emo girl', player: 'youtube',
  });
});

test('YouTube Music play opens the first search videoId', async () => {
  const opened = [];
  const fetched = [];
  const music = createMusic({
    config: { load: () => ({ music: { player: 'youtube' } }) },
    apps: () => [],
    sendKey: async () => {},
    openExternal: async (url) => { opened.push(url); },
    fetcher: async (url) => {
      fetched.push(url);
      return { text: async () => '<script>"videoId":"dQw4w9WgXcQ","videoId":"zzzzzzzzzzz"</script>' };
    },
  });
  const r = await music.command({ action: 'query', query: 'never gonna give you up' });
  assert.deepEqual(r, {
    ok: true, action: 'query', player: 'youtube', track: 'never gonna give you up', artist: '',
  });
  assert.deepEqual(fetched, ['https://www.youtube.com/results?search_query=never%20gonna%20give%20you%20up']);
  assert.deepEqual(opened, ['https://music.youtube.com/watch?v=dQw4w9WgXcQ']);
});

test('YouTube Music falls back to the search page when the fetch fails', async () => {
  const opened = [];
  const music = createMusic({
    config: { load: () => ({ music: { player: 'namida' } }) },
    apps: () => [],
    sendKey: async () => {},
    openExternal: async (url) => { opened.push(url); },
    fetcher: async () => { throw new Error('offline'); },
  });
  const r = await music.command({ action: 'query', query: 'neon genesis', player: 'youtube' });
  assert.equal(r.ok, true);
  assert.equal(r.searchOnly, true);
  assert.equal(r.query, 'neon genesis');
  assert.deepEqual(opened, ['https://music.youtube.com/search?q=neon%20genesis']);
});

test('pon música with YouTube Music chosen opens its home page', async () => {
  const opened = [];
  const music = createMusic({
    config: { load: () => ({ music: { player: 'youtube' } }) },
    apps: () => [],
    sendKey: async () => {},
    openExternal: async (url) => { opened.push(url); },
  });
  assert.deepEqual(await music.command({ action: 'start' }), {
    ok: true, player: 'youtube', action: 'start',
  });
  assert.deepEqual(await music.command({ action: 'open' }), { ok: true, player: 'youtube' });
  assert.deepEqual(opened, ['https://music.youtube.com/', 'https://music.youtube.com/']);
});

test('readNowPlaying returns the ps1 output or gives up after its timeout', async () => {
  let command = null;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  const found = readNowPlaying((cmd, args) => {
    command = [cmd, ...args];
    process.nextTick(() => {
      child.stdout.emit('data', 'SMTC\tnamida.exe\tWorth It\tCorbin\r\n');
      child.emit('close', 0);
    });
    return child;
  }, 'C:\\x\\now-playing.ps1');
  assert.match(await found, /Worth It/);
  assert.equal(command[0], 'powershell.exe');
  assert.ok(command.includes('-File'));

  let killed = false;
  const silent = new EventEmitter();
  silent.stdout = new EventEmitter();
  silent.kill = () => { killed = true; };
  assert.equal(await readNowPlaying(() => silent, 'C:\\x\\now-playing.ps1', 10), '');
  assert.equal(killed, true);
});

test('qué está sonando answers Namida first, then Spotify, then says it does not know', async () => {
  const make = ({ out = '', spotify = null, spotifyClient = false } = {}) => {
    const { createMusic } = require('../src/main/music');
    return createMusic({
      config: { load: () => ({ music: { player: 'namida', spotify: { clientId: spotifyClient ? 'id' : '' } } }) },
      apps: () => [],
      sendKey: async () => {},
      sendVolume: async () => {},
      spotify,
      readNowPlaying: async () => out,
    });
  };
  assert.deepEqual(
    await make({ out: 'SMTC\tnamida.exe\tWorth It\tCorbin' }).command({ action: 'nowPlaying' }),
    { ok: true, player: 'namida', track: 'Worth It', artist: 'Corbin' },
  );
  assert.deepEqual(
    await make({
      spotifyClient: true,
      spotify: { nowPlaying: async () => ({ ok: true, player: 'spotify', track: 'Neon', artist: 'Juno' }) },
    }).command({ action: 'nowPlaying' }),
    { ok: true, player: 'spotify', track: 'Neon', artist: 'Juno' },
  );
  const unknown = await make().command({ action: 'nowPlaying' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /No sé qué está sonando en Namida/);
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
  assert.deepEqual(result, { ok: true, track: 'Neon', artist: 'Juno', opened: true });
  assert.deepEqual(opened, ['spotify:track:abc']);
  assert.deepEqual(calls, ['GET /v1/search', 'PUT /v1/me/player/play']); // no devices round-trip
});

test('an expired Spotify token refreshes before the API call', async () => {
  const { createSpotify } = require('../src/main/spotify');
  const seen = [];
  let refreshed = 0;
  const spotify = createSpotify({
    token: () => 'old-token',
    expired: () => true,
    refresh: async () => { refreshed += 1; return 'new-token'; },
    wait: async () => {},
    request: async (endpoint, access) => {
      seen.push(`${endpoint} ${access}`);
      if (endpoint === '/v1/search') {
        return { tracks: { items: [{ uri: 'spotify:track:1', name: 'Neon', artists: [{ name: 'Juno' }] }] } };
      }
      if (endpoint === '/v1/me/player') {
        return { is_playing: true, item: { uri: 'spotify:track:1', name: 'Neon', artists: [{ name: 'Juno' }] } };
      }
      return {};
    },
  });
  assert.equal((await spotify.playQuery('neon')).ok, true);
  assert.equal(refreshed, 1);
  assert.deepEqual(seen, [
    '/v1/search new-token',
    '/v1/me/player/play new-token',
    '/v1/me/player new-token',
  ]);
});

test('a 401 refreshes the token once and retries the same request', async () => {
  const { createSpotify } = require('../src/main/spotify');
  const seen = [];
  let refreshed = 0;
  const spotify = createSpotify({
    token: () => 'old-token',
    refresh: async () => { refreshed += 1; return 'new-token'; },
    request: async (endpoint, access) => {
      seen.push(`${endpoint} ${access}`);
      if (access === 'old-token') throw new Error('Spotify HTTP 401');
      return { item: { name: 'Neon', artists: [{ name: 'Juno' }] } };
    },
  });
  assert.deepEqual(await spotify.nowPlaying(), { ok: true, track: 'Neon', artist: 'Juno' });
  assert.equal(refreshed, 1);
  assert.deepEqual(seen, ['/v1/me/player old-token', '/v1/me/player new-token']);
});

test('play with no active device opens Spotify, waits, and retries once', async () => {
  const { createSpotify } = require('../src/main/spotify');
  const calls = [];
  const opened = [];
  const waits = [];
  let playAttempts = 0;
  const spotify = createSpotify({
    token: () => 'token',
    wait: async (ms) => { waits.push(ms); },
    request: async (endpoint, access, body, method = 'GET') => {
      calls.push(`${method} ${endpoint}`);
      if (endpoint === '/v1/search') {
        return { tracks: { items: [{ uri: 'spotify:track:abc', name: 'Neon', artists: [{ name: 'Juno' }] }] } };
      }
      if (endpoint === '/v1/me/player') {
        return { is_playing: true, item: { uri: 'spotify:track:abc', name: 'Neon', artists: [{ name: 'Juno' }] } };
      }
      playAttempts += 1;
      if (playAttempts === 1) throw new Error('Spotify HTTP 404');
      return {};
    },
  });
  const result = await spotify.playQuery('neon', async (uri) => { opened.push(uri); });
  assert.deepEqual(result, { ok: true, track: 'Neon', artist: 'Juno', confirmed: true });
  assert.deepEqual(opened, ['spotify:']);
  assert.deepEqual(waits, [2000, 2500]);
  assert.deepEqual(calls, [
    'GET /v1/search', 'PUT /v1/me/player/play', 'PUT /v1/me/player/play', 'GET /v1/me/player',
  ]);
});

test('play that does not start reports No arrancó instead of success', async () => {
  const { createSpotify } = require('../src/main/spotify');
  const waits = [];
  const spotify = createSpotify({
    token: () => 'token',
    wait: async (ms) => { waits.push(ms); },
    request: async (endpoint) => {
      if (endpoint === '/v1/search') {
        return { tracks: { items: [{ uri: 'spotify:track:abc', name: 'Neon', artists: [{ name: 'Juno' }] }] } };
      }
      if (endpoint === '/v1/me/player/play') return {};
      // API accepted play, but nothing is actually playing
      return { is_playing: false, item: null };
    },
  });
  const result = await spotify.playQuery('neon');
  assert.equal(result.ok, false);
  assert.match(result.error, /No arrancó en Spotify/);
  assert.deepEqual(waits, [2500]);
});

test('a track opened in the app is marked opened, not played', async () => {
  const { createSpotify } = require('../src/main/spotify');
  const spotify = createSpotify({
    token: () => 'token',
    request: async (endpoint) => {
      if (endpoint === '/v1/search') {
        return { tracks: { items: [{ uri: 'spotify:track:abc', name: 'Neon', artists: [{ name: 'Juno' }] }] } };
      }
      throw new Error('Spotify HTTP 403');
    },
  });
  const result = await spotify.playQuery('neon', async () => {});
  assert.equal(result.opened, true);
  assert.equal(result.track, 'Neon');
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
