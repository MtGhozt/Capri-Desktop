'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  expandEnv, splitArgs, processName, linkOk, linkTarget, normalizeApp, cleanApps, seedApps, defaultCandidates,
  browserName, exeFromCommand,
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
  const none = defaultCandidates({ env, exists: () => false, found: {} }).map((a) => a.name);
  assert.deepEqual(none, ['YouTube', 'Google']);
  const files = new Set(['L\\Discord\\Update.exe', 'L\\Microsoft\\WindowsApps\\Spotify.exe', 'C:\\N\\namida.exe', 'c:/steam/steam.exe', 'C:\\O\\opera.exe']);
  const all = defaultCandidates({
    env,
    exists: (p) => files.has(p),
    found: { namidaExe: 'C:\\N\\namida.exe', steamExe: 'c:/steam/steam.exe', browser: { exe: 'C:\\O\\opera.exe', name: 'Opera GX', aliases: ['opera'] } },
  });
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
