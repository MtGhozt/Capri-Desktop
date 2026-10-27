'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  expandEnv, splitArgs, processName, linkOk, linkTarget, normalizeApp, cleanApps, seedApps, defaultCandidates,
  browserName, exeFromCommand, newCandidates,
} = require('../src/main/apps-config');

test('environment variables expand, case-insensitive, unknown ones stay', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\M\\AppData\\Local', 'ProgramFiles(x86)': 'C:\\PF86' };
  assert.equal(expandEnv('%localappdata%\\Discord\\Update.exe', env), 'C:\\Users\\M\\AppData\\Local\\Discord\\Update.exe');
  assert.equal(expandEnv('%ProgramFiles(x86)%\\Steam', env), 'C:\\PF86\\Steam');
  assert.equal(expandEnv('%NOPE%\\x', env), '%NOPE%\\x');
});

test('arguments, process names and links', () => {
  assert.deepEqual(splitArgs('--processStart Discord.exe "--a b"'), ['--processStart', 'Discord.exe', '--a b']);
  assert.equal(processName('C:\\x\\Discord.exe'), 'Discord');
  assert.ok(linkOk('https://www.youtube.com'));
  assert.ok(linkOk('spotify:'));
  for (const bad of ['javascript:alert(1)', 'file:///c:/x', 'C:\\x.exe', 'https://localhost', 'ms-msdt:x']) assert.ok(!linkOk(bad), bad);
  assert.equal(linkTarget('twitch.tv'), 'https://twitch.tv');
});

test('entries are cleaned up', () => {
  const app = normalizeApp({ name: '  Discord ', target: 'C:\\D\\Discord.exe', aliases: ['disc', 'Disc', ''] });
  assert.equal(app.name, 'Discord');
  assert.equal(app.type, 'program');
  assert.deepEqual(app.aliases, ['disc']);
  assert.deepEqual(app.processes, ['Discord']);
  assert.equal(app.close, 'graceful');
  assert.equal(normalizeApp({ name: '', target: 'x' }), null);
  assert.equal(normalizeApp({ name: 'X', type: 'link', target: 'javascript:alert(1)' }), null);
  assert.equal(cleanApps([{ name: 'A', target: 'a.exe' }, { name: 'a', target: 'b.exe' }]).length, 1);
});

test('seeding never overwrites or duplicates what you already have', () => {
  const mine = [{ name: 'Discord', aliases: ['mi discord'], type: 'program', target: 'D:\\Discord.exe', close: 'force' }];
  const candidates = [
    { name: 'Discord', aliases: ['discor'], type: 'program', target: 'C:\\other.exe' },
    { name: 'YouTube', aliases: ['yutub', 'mi discord'], type: 'link', target: 'https://www.youtube.com' },
  ];
  const { list, added } = seedApps(mine, candidates);
  assert.deepEqual(added, ['YouTube']);
  const discord = list.find((a) => a.name === 'Discord');
  assert.equal(discord.target, 'D:\\Discord.exe');
  assert.equal(discord.close, 'force');
  assert.deepEqual(list.find((a) => a.name === 'YouTube').aliases, ['yutub']);
  assert.deepEqual(seedApps(list, candidates).added, []);
});

test('only what this PC has is seeded', () => {
  const env = { LOCALAPPDATA: 'L', APPDATA: 'R', 'ProgramFiles(x86)': 'P86', ProgramFiles: 'P' };
  const none = defaultCandidates({ env, exists: () => false, found: {} }).filter((a) => !a.since).map((a) => a.name);
  assert.deepEqual(none, ['YouTube', 'Google']);
  const files = new Set(['L\\Discord\\Update.exe', 'L\\Microsoft\\WindowsApps\\Spotify.exe', 'C:\\N\\namida.exe', 'c:/steam/steam.exe', 'C:\\O\\opera.exe']);
  const all = defaultCandidates({
    env,
    exists: (p) => files.has(p),
    found: { namidaExe: 'C:\\N\\namida.exe', steamExe: 'c:/steam/steam.exe', browser: { exe: 'C:\\O\\opera.exe', name: 'Opera GX', aliases: ['opera'] } },
  }).filter((a) => !a.since);
  assert.deepEqual(all.map((a) => a.name), ['Discord', 'Spotify', 'Namida', 'Steam', 'Opera GX', 'YouTube', 'Google']);
  const spotify = all.find((a) => a.name === 'Spotify');
  assert.equal(spotify.type, 'link');
  assert.equal(spotify.target, 'spotify:');
  assert.equal(all.find((a) => a.name === 'Opera GX').close, 'ask');
});

test('the default browser from its open command', () => {
  const exe = exeFromCommand('"C:\\Users\\M\\AppData\\Local\\Programs\\Opera GX\\opera.exe" -noautoupdate -- "%1"');
  assert.equal(exe, 'C:\\Users\\M\\AppData\\Local\\Programs\\Opera GX\\opera.exe');
  assert.equal(browserName(exe).name, 'Opera GX');
  assert.equal(browserName('C:\\x\\chrome.exe').name, 'Chrome');
});

test('seed versions: an older table only gets the newer candidates', () => {
  const { seededVersion, newCandidates, SEED_VERSION } = require('../src/main/apps-config');
  assert.equal(seededVersion(true), 1);
  assert.equal(seededVersion(false), 0);
  assert.equal(seededVersion(undefined), 0);
  assert.equal(seededVersion(2), 2);
  assert.equal(SEED_VERSION, 2);
  const all = defaultCandidates({ env: { WINDIR: 'C:\\Windows' }, exists: () => false });
  assert.deepEqual(newCandidates(all, 1).map((a) => a.name), ['Grok', 'Explorador de archivos']);
  assert.deepEqual(newCandidates(all, 2), []);
  assert.equal(all.find((a) => a.name === 'Grok').target, 'https://grok.com'); // no desktop app: the site
});

test('seed 2 finds Grok, Cursor, Warp, Notion and Epic from their Start menu shortcuts', () => {
  const targets = {
    'Grok Bot': 'C:\\Software\\Grok\\Grok Bot\\Grok Bot.exe',
    Cursor: 'C:\\Software\\Cursor\\cursor\\Cursor.exe',
    Warp: 'C:\\Software\\Warp\\Warp\\warp.exe',
    Notion: 'C:\\U\\Notion\\Notion.exe',
    'Epic Games Launcher': 'C:\\PF86\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe',
  };
  const files = new Set(Object.values(targets));
  const found = newCandidates(defaultCandidates({ env: {}, exists: (p) => files.has(p), found: { shortcuts: targets } }), 1)
    .map((raw) => normalizeApp(raw));
  assert.deepEqual(found.map((a) => a.name), ['Grok', 'Cursor', 'Warp', 'Explorador de archivos', 'Notion', 'Epic Games']);
  const by = Object.fromEntries(found.map((a) => [a.name, a]));
  assert.equal(by.Grok.close, 'ask');
  assert.deepEqual(by.Grok.processes, ['Grok Bot']);
  assert.deepEqual(by['Epic Games'].processes, ['EpicGamesLauncher']);
  const explorer = by['Explorador de archivos'];
  assert.equal(explorer.windows, 'explorer');
  assert.deepEqual(explorer.processes, []); // never explorer.exe
  for (const alias of ['explorador', 'archivos', 'el explorador']) assert.ok(explorer.aliases.includes(alias), alias);
});
