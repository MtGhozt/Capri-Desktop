'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripReplyTags, ACTION_KINDS, ACTION_TAG_HELP } = require('../src/main/mood-tag');
const {
  SETTINGS, SETTINGS_PAGES, allowed, run, detectInfoKinds, contextSnippet,
  parsePcCommand, NO_BATTERY, info,
} = require('../src/main/pc-actions');

test('stripReplyTags parses volume / settings / theme / info tags', () => {
  assert.deepEqual(stripReplyTags('[volume:30] Listo.').action, { kind: 'volume', value: '30' });
  assert.deepEqual(stripReplyTags('[volume:up] Subo.').action, { kind: 'volume', value: 'up' });
  assert.deepEqual(stripReplyTags('[volume:mute] Silencio.').action, { kind: 'volume', value: 'mute' });
  assert.deepEqual(stripReplyTags('[settings:bluetooth] Ahí va.').action, {
    kind: 'settings', value: 'bluetooth',
  });
  assert.deepEqual(stripReplyTags('[theme:dark] Modo noche.').action, { kind: 'theme', value: 'dark' });
  assert.deepEqual(stripReplyTags('[info:battery] Te cuento.').action, {
    kind: 'info', value: 'battery',
  });
  assert.deepEqual(stripReplyTags('[emocion] [settings:wifi] Wi‑Fi.').action, {
    kind: 'settings', value: 'wifi',
  });
});

test('unknown PC tags / values stay as text (allowlist)', () => {
  for (const text of [
    '[volume:loud] Nada.',
    '[volume:101] Nada.',
    '[settings:registry] Nada.',
    '[theme:neon] Nada.',
    '[info:cpu] Nada.',
    '[pc:hack] Nada.',
  ]) {
    assert.deepEqual(stripReplyTags(text), { text, mood: null, action: null }, text);
    const m = /^\[(\w+):([^\]]*)\]/.exec(text);
    if (m && ['volume', 'settings', 'theme', 'info'].includes(m[1])) {
      assert.equal(allowed(m[1], m[2]), false, text);
    }
  }
  assert.equal(allowed('shell', 'Get-Process'), false);
  assert.equal(allowed('settings', 'foobar'), false);
});

test('ms-settings mapping covers the closed page list', () => {
  assert.deepEqual(SETTINGS, {
    bluetooth: 'bluetooth',
    sound: 'sound',
    display: 'display',
    wifi: 'network-wifi',
    network: 'network-status',
    notifications: 'notifications',
    apps: 'appsfeatures',
    update: 'windowsupdate',
  });
  assert.deepEqual(SETTINGS_PAGES.slice().sort(), Object.keys(SETTINGS).sort());
  for (const page of SETTINGS_PAGES) {
    assert.ok(ACTION_TAG_HELP.includes(page), `prompt missing settings page ${page}`);
  }
});

test('run rejects unknown actions and non-Windows without crashing', async () => {
  const bad = await run({ kind: 'settings', value: 'registry' }, { platform: 'win32' });
  assert.equal(bad.ok, false);
  assert.match(bad.line, /lista|permitida|Configuración/i);

  const unix = await run({ kind: 'volume', value: '30' }, { platform: 'linux' });
  assert.equal(unix.ok, false);
  assert.match(unix.line, /Windows/i);
});

test('run opens allowlisted settings via openExternal', async () => {
  const opened = [];
  const ok = await run(
    { kind: 'settings', value: 'sound' },
    { platform: 'win32', openExternal: async (url) => { opened.push(url); } },
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(opened, ['ms-settings:sound']);
});

test('run volume uses PowerShell helper (mocked)', async () => {
  const cmds = [];
  const ok = await run(
    { kind: 'volume', value: '40' },
    {
      platform: 'win32',
      powershell: async (cmd) => { cmds.push(cmd); return '40'; },
    },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.level, 40);
  assert.ok(cmds[0].includes('CapriAudio'));
  assert.ok(cmds[0].includes('Set(40)'));
});

test('detectInfoKinds and contextSnippet feed facts like weather extras', async () => {
  assert.deepEqual(detectInfoKinds('cuánta batería tengo?'), ['battery']);
  assert.deepEqual(detectInfoKinds('cuánto espacio en disco queda'), ['disk']);
  assert.deepEqual(detectInfoKinds('hola qué tal'), []);

  const snip = await contextSnippet('cuál es mi ip local', {
    powershell: async () => { throw new Error('unused'); },
  });
  // IP uses os.networkInterfaces — either a real address or the friendly miss line
  assert.match(snip, /IP local|No encontré una IP/i);
  assert.match(snip, /Usá solo estos datos de la PC/);
  assert.match(snip, /dígitos/i);
  assert.equal(await contextSnippet('pon música'), '');
});

test('parsePcCommand takes system mute/theme/volume before music', () => {
  assert.deepEqual(parsePcCommand('silencio'), { kind: 'volume', value: 'mute' });
  assert.deepEqual(parsePcCommand('mute'), { kind: 'volume', value: 'mute' });
  assert.deepEqual(parsePcCommand('desmutea'), { kind: 'volume', value: 'unmute' });
  assert.deepEqual(parsePcCommand('activá el sonido'), { kind: 'volume', value: 'unmute' });
  assert.deepEqual(parsePcCommand('poné modo oscuro'), { kind: 'theme', value: 'dark' });
  assert.deepEqual(parsePcCommand('pon tema claro'), { kind: 'theme', value: 'light' });
  assert.deepEqual(parsePcCommand('volumen a 30'), { kind: 'volume', value: '30' });
  assert.deepEqual(parsePcCommand('pon el volumen al 50%'), { kind: 'volume', value: '50' });
  assert.deepEqual(parsePcCommand('subí el volumen'), { kind: 'volume', value: 'up' });
  assert.deepEqual(parsePcCommand('sube el volumen'), { kind: 'volume', value: 'up' });
  assert.deepEqual(parsePcCommand('más volumen'), { kind: 'volume', value: 'up' });
  assert.deepEqual(parsePcCommand('más fuerte'), { kind: 'volume', value: 'up' });
  assert.deepEqual(parsePcCommand('bajá el volumen'), { kind: 'volume', value: 'down' });
  assert.deepEqual(parsePcCommand('menos volumen'), { kind: 'volume', value: 'down' });
  assert.deepEqual(parsePcCommand('más bajo'), { kind: 'volume', value: 'down' });
  assert.deepEqual(parsePcCommand('cambialo a modo oscuro'), { kind: 'theme', value: 'dark' });
  assert.equal(parsePcCommand('subí'), null);
  assert.equal(parsePcCommand('bajá'), null);
  assert.equal(parsePcCommand('bajale'), null);
  assert.equal(parsePcCommand('silencia la música'), null); // music owns that phrase
  assert.equal(parsePcCommand('sube el volumen de la música'), null);
  assert.equal(parsePcCommand('pon never gonna give you up'), null);
});

test('system volume up/down runs CapriAudio ±10', async () => {
  const cmds = [];
  const up = await run(
    { kind: 'volume', value: 'up' },
    { platform: 'win32', powershell: async (cmd) => { cmds.push(cmd); return '55'; } },
  );
  assert.equal(up.ok, true);
  assert.equal(up.level, 55);
  assert.ok(cmds[0].includes('Level + 10'));
  cmds.length = 0;
  const down = await run(
    { kind: 'volume', value: 'down' },
    { platform: 'win32', powershell: async (cmd) => { cmds.push(cmd); return '45'; } },
  );
  assert.equal(down.ok, true);
  assert.ok(cmds[0].includes('Level - 10'));
});

test('desktop with no Win32_Battery gets an explicit no-battery fact', async () => {
  for (const out of ['', 'null', '[]']) {
    const got = await info('battery', { powershell: async () => out });
    assert.equal(got.line, NO_BATTERY, out || '(empty)');
  }
});

test('setTheme runs the Personalize registry script', async () => {
  const cmds = [];
  const ok = await run(
    { kind: 'theme', value: 'dark' },
    { platform: 'win32', powershell: async (cmd) => { cmds.push(cmd); return ''; } },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.theme, 'dark');
  assert.ok(cmds[0].includes('AppsUseLightTheme'));
  assert.ok(cmds[0].includes('SystemUsesLightTheme'));
  assert.match(cmds[0], /Value 0/);
});

test('system prompt lists the new PC action kinds', () => {
  for (const kind of ['volume', 'settings', 'theme', 'info']) {
    assert.ok(ACTION_KINDS.includes(kind));
    assert.ok(
      ACTION_TAG_HELP.includes(`[${kind}:`) || ACTION_TAG_HELP.includes(`[${kind}]`),
      `missing from the prompt: ${kind}`,
    );
  }
  assert.match(ACTION_TAG_HELP, /dígitos/i);
});
