'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripReplyTags, ACTION_KINDS, ACTION_TAG_HELP } = require('../src/main/mood-tag');
const {
  SETTINGS, SETTINGS_PAGES, FILE_EXTS, allowed, run, detectInfoKinds, contextSnippet,
  parsePcCommand, parseWindowValue, parseWindowPosition, sanitizeProcess, buildSnapCommand,
  resolveAppProcess, combineWindowResults,
  parseFileKind, parseFilesValue, sanitizeWords, nameMatchesWords, buildFindCommand,
  validateUserFilePath, setLastFileHits, getLastFileHits,
  NO_BATTERY, info,
} = require('../src/main/pc-actions');

const APPS = [
  { name: 'Discord', aliases: ['discor'], type: 'program', target: 'C:\\Discord\\Discord.exe', processes: ['Discord'] },
  { name: 'Chrome', aliases: [], type: 'program', target: 'C:\\Chrome\\chrome.exe', processes: ['chrome'] },
];

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
    '[window:Discord|diagonal] Nada.',
  ]) {
    assert.deepEqual(stripReplyTags(text), { text, mood: null, action: null }, text);
    const m = /^\[(\w+):([^\]]*)\]/.exec(text);
    if (m && ['volume', 'settings', 'theme', 'info', 'window'].includes(m[1])) {
      assert.equal(allowed(m[1], m[2]), false, text);
    }
  }
  assert.equal(allowed('shell', 'Get-Process'), false);
  assert.equal(allowed('settings', 'foobar'), false);
});

test('snip and window reply tags parse', () => {
  assert.deepEqual(stripReplyTags('[pc:snip] Recortá.').action, { kind: 'snip', value: '' });
  assert.deepEqual(stripReplyTags('[snip] Listo.').action, { kind: 'snip', value: '' });
  assert.deepEqual(stripReplyTags('[window:Discord|left] Hecho.').action, {
    kind: 'window', value: 'Discord|left', app: 'Discord', position: 'left',
  });
  assert.deepEqual(stripReplyTags('[window:Chrome|max] Ya.').action, {
    kind: 'window', value: 'Chrome|max', app: 'Chrome', position: 'max',
  });
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
  assert.ok(ACTION_KINDS.includes('snip'));
  assert.ok(ACTION_KINDS.includes('window'));
  assert.ok(ACTION_KINDS.includes('files'));
  assert.match(ACTION_TAG_HELP, /\[pc:snip\]/);
  assert.match(ACTION_TAG_HELP, /\[window:/);
  assert.match(ACTION_TAG_HELP, /\[files:/);
  assert.match(ACTION_TAG_HELP, /dígitos/i);
});

test('parseWindowValue and sanitizeProcess are allowlisted', () => {
  assert.deepEqual(parseWindowValue('Discord|left'), {
    app: 'Discord', position: 'left', value: 'Discord|left',
  });
  assert.equal(parseWindowPosition('derecha'), 'right');
  assert.equal(parseWindowValue('Discord|diagonal'), null);
  assert.equal(parseWindowValue('Capri|left'), null);
  assert.equal(sanitizeProcess('Discord'), 'Discord');
  assert.equal(sanitizeProcess('chrome.exe'), 'chrome');
  assert.equal(sanitizeProcess('Grok Bot'), 'Grok Bot');
  assert.equal(sanitizeProcess('Grok\' ; x'), null);
  assert.equal(sanitizeProcess('a$b'), null);
  assert.equal(sanitizeProcess('a`b'), null);
  assert.equal(sanitizeProcess('Grok  Bot'), null); // double space
  assert.equal(sanitizeProcess(' Grok'), null); // leading space
  assert.equal(sanitizeProcess('Discord;rm'), null);
  assert.equal(sanitizeProcess('../evil'), null);
  assert.equal(sanitizeProcess('electron'), null);
});

test('resolveAppProcess keeps spaced process names (Grok Bot)', () => {
  const apps = [{
    name: 'Grok',
    aliases: [],
    type: 'program',
    target: 'C:\\Grok\\Grok.exe',
    processes: ['Grok Bot'],
  }];
  assert.deepEqual(resolveAppProcess('Grok', apps), { app: 'Grok', process: 'Grok Bot' });
  // rejected process entry must not fall back to truncated app name
  assert.equal(resolveAppProcess('Grok', [{
    name: 'Grok', aliases: [], type: 'program', target: 'C:\\Grok\\Grok.exe', processes: ['Grok\'x'],
  }]), null);
});

test('combineWindowResults speaks once for ok+ok and ok+fail', () => {
  assert.equal(
    combineWindowResults([
      { ok: true, app: 'Discord', position: 'left' },
      { ok: true, app: 'Grok', position: 'right' },
    ]),
    'Discord a la izquierda y Grok a la derecha.',
  );
  assert.equal(
    combineWindowResults([
      { ok: true, app: 'Discord', position: 'left' },
      { ok: false, app: 'Grok', position: 'right', line: 'No veo Grok abierta' },
    ]),
    'Discord a la izquierda, pero no veo Grok abierta.',
  );
});

test('buildSnapCommand only interpolates validated process + position', () => {
  assert.equal(buildSnapCommand('Discord; rm', 'left'), null);
  assert.equal(buildSnapCommand('Discord', 'diagonal'), null);
  const cmd = buildSnapCommand('Discord', 'left');
  assert.ok(cmd);
  assert.match(cmd, /-Name 'Discord'/);
  assert.match(cmd, /Place\(\$p\.MainWindowHandle, 'left'\)/);
  assert.doesNotMatch(cmd, /Discord;/);
  const max = buildSnapCommand('chrome', 'max');
  assert.match(max, /-Name 'chrome'/);
  assert.match(max, /ShowWindow\(\$p\.MainWindowHandle, 3\)/);
});

test('parsePcCommand snip and window arrange', () => {
  assert.deepEqual(parsePcCommand('recortá la pantalla'), { kind: 'snip', value: '' });
  assert.deepEqual(parsePcCommand('sacá un recorte'), { kind: 'snip', value: '' });
  const left = parsePcCommand('poné Discord a la izquierda', { apps: APPS });
  assert.equal(left?.kind, 'window');
  assert.equal(left.process, 'Discord');
  assert.equal(left.position, 'left');
  const max = parsePcCommand('maximizá Chrome', { apps: APPS });
  assert.equal(max?.kind, 'window');
  assert.equal(max.process, 'chrome');
  assert.equal(max.position, 'max');
  assert.equal(parsePcCommand('poné Discord', { apps: APPS }), null);
  assert.equal(parsePcCommand('poné música a la derecha', { apps: APPS }), null);
  assert.equal(parsePcCommand('la izquierda de la foto está mal', { apps: APPS }), null);
});

test('run snip opens ms-screenclip', async () => {
  const opened = [];
  const ok = await run(
    { kind: 'snip', value: '' },
    { platform: 'win32', openExternal: async (url) => { opened.push(url); } },
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(opened, ['ms-screenclip:']);
});

test('run window snap uses allowlisted PowerShell (mocked)', async () => {
  const cmds = [];
  const ok = await run(
    { kind: 'window', value: 'Discord|left', app: 'Discord', process: 'Discord', position: 'left' },
    {
      platform: 'win32',
      powershell: async (cmd) => { cmds.push(cmd); return 'OK'; },
    },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.line, 'Discord a la izquierda.');
  assert.match(cmds[0], /-Name 'Discord'/);
  assert.match(cmds[0], /CapriWin/);
  const miss = await run(
    { kind: 'window', value: 'Discord|left', app: 'Discord', process: 'Discord', position: 'left' },
    { platform: 'win32', powershell: async () => 'MISSING' },
  );
  assert.equal(miss.ok, false);
  assert.match(miss.line, /No veo Discord abierta/);

  const dual = await run(
    {
      kind: 'window',
      value: 'Discord|left+Grok|right',
      snaps: [
        { kind: 'window', value: 'Discord|left', app: 'Discord', process: 'Discord', position: 'left' },
        { kind: 'window', value: 'Grok|right', app: 'Grok', process: 'Grok Bot', position: 'right' },
      ],
    },
    {
      platform: 'win32',
      powershell: async (cmd) => {
        cmds.push(cmd);
        if (cmd.includes("-Name 'Grok Bot'")) return 'MISSING';
        return 'OK';
      },
    },
  );
  assert.equal(dual.ok, false);
  assert.equal(dual.results?.length, 2);
  assert.equal(dual.line, 'Discord a la izquierda, pero no veo Grok abierta.');
  assert.ok(cmds.some((c) => c.includes("-Name 'Grok Bot'")));
});

test('file kind mapping and accent-insensitive word match', () => {
  assert.equal(parseFileKind('PDF'), 'pdf');
  assert.equal(parseFileKind('foto'), 'image');
  assert.equal(parseFileKind('excel'), 'excel');
  assert.equal(parseFileKind('cancion'), null);
  assert.ok(FILE_EXTS.pdf.includes('.pdf'));
  assert.ok(FILE_EXTS.image.includes('.png'));
  assert.deepEqual(parseFilesValue('pdf|calculo'), {
    kind: 'pdf', words: ['calculo'], value: 'pdf|calculo',
  });
  assert.equal(parseFilesValue('pdf|'), null);
  assert.equal(parseFilesValue('hack|x'), null);
  assert.deepEqual(sanitizeWords(['cálculo']), ['cálculo']);
  assert.deepEqual(sanitizeWords(['calculo']), ['calculo']);
  assert.equal(sanitizeWords(['bad;rm']), null);
  assert.ok(nameMatchesWords('Informe-Cálculo-2024.pdf', ['calculo']));
  assert.ok(nameMatchesWords('foto del perro.jpg', ['perro']));
  assert.equal(nameMatchesWords('gato.jpg', ['perro', 'gato']), false);
});

test('buildFindCommand only embeds base64 allowlisted config', () => {
  const cmd = buildFindCommand(FILE_EXTS.pdf);
  assert.ok(cmd);
  assert.match(cmd, /FromBase64String\('[A-Za-z0-9+/=]+'\)/);
  assert.doesNotMatch(cmd, /calculo|perro|; rm /i);
  assert.match(cmd, /GetFolderPath/);
  assert.match(cmd, /Downloads/);
  assert.equal(validateUserFilePath('C:\\Users\\x\\Documents\\a.pdf'), 'C:\\Users\\x\\Documents\\a.pdf');
  assert.equal(validateUserFilePath('C:\\Users\\x\\..\\Windows\\a.pdf'), null);
  assert.equal(validateUserFilePath('/etc/passwd'), null);
});

test('parsePcCommand find files and pick', () => {
  const pdf = parsePcCommand('buscame el PDF de cálculo');
  assert.equal(pdf?.kind, 'files');
  assert.equal(pdf.fileKind, 'pdf');
  assert.deepEqual(pdf.words, ['calculo']);
  const foto = parsePcCommand('dónde está la foto del perro');
  assert.equal(foto?.kind, 'files');
  assert.equal(foto.fileKind, 'image');
  assert.deepEqual(foto.words, ['perro']);
  assert.equal(parsePcCommand('buscá la canción Bohemian'), null);
  assert.equal(parsePcCommand('buscá en Google recetas'), null);
  assert.equal(parsePcCommand('buscame una excusa para mañana'), null);
  assert.equal(parsePcCommand('dónde está Discord'), null);
  assert.deepEqual(parsePcCommand('abrí el segundo'), { kind: 'files', value: 'pick|2', pick: 2 });
});

test('findFiles 1/many/0 replies and abrí el segundo', async () => {
  setLastFileHits([]);
  const selected = [];
  const rows = [
    { name: 'gastos.xlsx', path: 'C:\\Users\\x\\Documents\\gastos.xlsx', dir: 'C:\\Users\\x\\Documents', mtime: '2024-06-01T00:00:00.000Z' },
    { name: 'gastos-old.xlsx', path: 'C:\\Users\\x\\Downloads\\gastos-old.xlsx', dir: 'C:\\Users\\x\\Downloads', mtime: '2023-01-01T00:00:00.000Z' },
    { name: 'otro.xlsx', path: 'C:\\Users\\x\\Documents\\otro.xlsx', dir: 'C:\\Users\\x\\Documents', mtime: '2024-05-01T00:00:00.000Z' },
  ];
  const many = await run(
    { kind: 'files', value: 'excel|gastos', fileKind: 'excel', words: ['gastos'] },
    {
      platform: 'win32',
      powershell: async (cmd) => {
        assert.match(cmd, /FromBase64String/);
        assert.doesNotMatch(cmd, /gastos/);
        return JSON.stringify(rows);
      },
      execFile: (_f, args, _o, cb) => { selected.push(args); cb(null); },
    },
  );
  assert.equal(many.ok, true);
  assert.match(many.line, /Encontré 2/);
  assert.match(many.line, /gastos\.xlsx/);
  assert.equal(selected.length, 0);
  assert.equal(getLastFileHits().length, 2);

  const pick = await run(
    { kind: 'files', value: 'pick|2', pick: 2 },
    {
      platform: 'win32',
      execFile: (_f, args, _o, cb) => { selected.push(args); cb(null); },
    },
  );
  assert.equal(pick.ok, true);
  assert.match(pick.line, /Ahí está: gastos-old\.xlsx/);
  assert.equal(selected.length, 1);
  assert.match(selected[0][0], /\/select,/);
  assert.match(selected[0][0], /gastos-old\.xlsx/);

  selected.length = 0;
  const one = await run(
    { kind: 'files', value: 'pdf|unico', fileKind: 'pdf', words: ['unico'] },
    {
      platform: 'win32',
      powershell: async () => JSON.stringify([
        { name: 'unico.pdf', path: 'C:\\Users\\x\\Desktop\\unico.pdf', dir: 'C:\\Users\\x\\Desktop', mtime: '2024-01-01T00:00:00.000Z' },
      ]),
      execFile: (_f, args, _o, cb) => { selected.push(args); cb(null); },
    },
  );
  assert.equal(one.ok, true);
  assert.equal(one.line, 'Ahí está: unico.pdf');
  assert.equal(selected.length, 1);

  const none = await run(
    { kind: 'files', value: 'pdf|nada', fileKind: 'pdf', words: ['nada'] },
    { platform: 'win32', powershell: async () => '[]' },
  );
  assert.equal(none.ok, true);
  assert.equal(none.line, 'No encontré nada con eso en tus carpetas.');
});
