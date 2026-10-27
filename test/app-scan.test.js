'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scan = require('../src/main/app-scan');
const { cleanApps } = require('../src/main/apps-config');

const FIX = path.join(__dirname, 'fixtures', 'scan');
const fixture = (name, swaps = {}) => Object.entries(swaps)
  .reduce((text, [k, v]) => text.split(k).join(v), fs.readFileSync(path.join(FIX, name), 'utf8'));
// paths inside the vdf/reg files are escaped the way Windows writes them
const vdfPath = (p) => p.replace(/\\/g, '\\\\');

const made = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-scan-'));
  made.push(dir);
  return dir;
}
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});
function put(file, text = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('vdf: nested blocks, escaped paths', () => {
  const data = scan.parseVdf('"a"\n{\n\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t"b" { "c" "1" }\n}');
  assert.deepEqual(data, { a: { path: 'C:\\Program Files (x86)\\Steam', b: { c: '1' } } });
  assert.deepEqual(scan.steamGame(fixture('appmanifest_3678970.acf')), { appid: '3678970', name: 'TBH: Task Bar Hero', installdir: 'TaskbarHero', installed: true });
  assert.equal(scan.steamGame(fixture('appmanifest_999.acf')).installed, false);
});

test('Steam: installed games from every library, no tools or half downloads', async () => {
  const root = tmp();
  const lib2 = tmp();
  put(path.join(root, 'steamapps', 'libraryfolders.vdf'), fixture('libraryfolders.vdf', { __ROOT__: vdfPath(root), __LIB2__: vdfPath(lib2) }));
  for (const f of ['appmanifest_105600.acf', 'appmanifest_228980.acf', 'appmanifest_999.acf', 'appmanifest_1493710.acf']) {
    put(path.join(root, 'steamapps', f), fixture(f));
  }
  put(path.join(lib2, 'steamapps', 'appmanifest_3678970.acf'), fixture('appmanifest_3678970.acf'));
  for (const d of ['Terraria', 'Steamworks Shared', 'Half', 'Proton - Experimental']) fs.mkdirSync(path.join(root, 'steamapps', 'common', d), { recursive: true });
  // TBH's manifest says installed, but its folder is gone: left out
  const items = await scan.scanSteam(root);
  assert.deepEqual(items.map((i) => [i.name, i.target]), [['Terraria', '105600']]);
  assert.equal(items[0].type, 'steam');
  assert.equal(items[0].dir, path.join(root, 'steamapps', 'common', 'Terraria'));
  fs.mkdirSync(path.join(lib2, 'steamapps', 'common', 'TaskbarHero'), { recursive: true });
  assert.deepEqual((await scan.scanSteam(root)).map((i) => i.name), ['Terraria', 'TBH: Task Bar Hero']);
  assert.deepEqual(await scan.scanSteam(null), []);
});

test('Epic: launchable installs only, opened through the launcher', async () => {
  const dir = tmp();
  const fn = tmp();
  const swaps = { __FN__: vdfPath(fn), __NOPE__: vdfPath(path.join(fn, 'nope')) };
  for (const f of ['fortnite.item', 'lego.item', 'gone.item']) put(path.join(dir, f), fixture(f, swaps));
  put(path.join(dir, 'broken.item'), '{ not json');
  const items = await scan.scanEpic(dir);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Fortnite');
  assert.equal(items[0].type, 'link');
  assert.equal(items[0].target, 'com.epicgames.launcher://apps/fn%3A4fe75bbc5a674f4f9b356b5c90567da5%3AFortnite?action=launch&silent=true');
  assert.equal(items[0].dir, fn);
});

test('GOG: registry games whose exe is there', async () => {
  const dir = tmp();
  const exe = path.join(dir, 'witcher.exe');
  put(exe, 'x');
  const text = fixture('gog.reg.txt', { __WITCHER__: exe, __WITCHER_DIR__: dir });
  assert.equal(scan.parseRegQuery(text).length, 2);
  const items = await scan.scanGog(text);
  assert.deepEqual(items.map((i) => [i.name, i.target, i.args, i.dir]), [['The Witcher', exe, '-fast', dir]]);
  assert.deepEqual(await scan.scanGog(''), []);
});

test('Start menu: programs, not uninstallers, help, readmes or game shortcuts already covered', async () => {
  const menu = tmp();
  const lnk = (rel, target) => {
    put(path.join(menu, rel), 'lnk');
    return [path.join(menu, rel), target];
  };
  const targets = new Map([
    lnk('Notion.lnk', 'C:\\U\\Notion\\Notion.exe'),
    lnk('OBS Studio\\OBS Studio (64bit).lnk'.replace(/\\/g, path.sep), 'C:\\OBS\\obs64.exe'),
    lnk(path.join('OBS Studio', 'Uninstall.lnk'), 'C:\\OBS\\uninstall.exe'),
    lnk(path.join('Python 3.14', 'Python 3.14 Manuals (64-bit).lnk'), 'C:\\Py\\doc.chm'),
    lnk(path.join('7-Zip', '7-Zip Help.lnk'), 'C:\\7z\\7-zip.chm'),
    lnk(path.join('Unity', 'Unity Release Notes.lnk'), ''),
    lnk(path.join('Startup', 'Enviar a OneNote.lnk'), 'C:\\x\\onenote.exe'),
    lnk('File Explorer.lnk', ''),
    lnk('Capri.lnk', 'C:\\Capri\\Capri.exe'),
    lnk('Postman.lnk', 'C:\\U\\Postman\\Update.exe'),
    lnk('Windows PowerShell.lnk', 'C:\\Windows\\powershell.exe'),
    lnk('Zoom Uninstaller.lnk', 'C:\\Zoom\\unins000.exe'),
  ]);
  put(path.join(menu, 'Steam', 'Terraria.url'), '[InternetShortcut]\nURL=steam://rungameid/105600\n');
  put(path.join(menu, 'Node.js', 'Node.js website.url'), '[InternetShortcut]\nURL=https://nodejs.org/\n');
  put(path.join(menu, 'Spotify.url'), '[InternetShortcut]\r\nURL=spotify:\r\n');
  const items = await scan.scanStartMenu([menu], {
    readShortcut: (file) => (targets.get(file) ? { target: targets.get(file), args: '' } : null),
    isProtected: (n) => /powershell/i.test(n),
  });
  const by = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.deepEqual(Object.keys(by).sort(), ['File Explorer', 'Notion', 'OBS Studio (64bit)', 'Postman', 'Spotify', 'Windows PowerShell']);
  assert.deepEqual(by.Notion.processes, ['Notion']);
  assert.equal(by.Notion.target, path.join(menu, 'Notion.lnk')); // opened through the shortcut
  assert.deepEqual(by['OBS Studio (64bit)'].processes, ['obs64']);
  // no process of its own to tell: closed by window title
  assert.deepEqual(by.Postman.processes, []);
  assert.equal(by.Postman.title, 'Postman');
  assert.deepEqual(by['Windows PowerShell'].processes, []);
  assert.equal(by.Spotify.type, 'link');
});

test('everything at once: games first, one item per name, counts per source', async () => {
  const root = tmp();
  const menu = tmp();
  put(path.join(root, 'steamapps', 'libraryfolders.vdf'), fixture('libraryfolders.vdf', { __ROOT__: vdfPath(root), __LIB2__: vdfPath(root) }));
  put(path.join(root, 'steamapps', 'appmanifest_105600.acf'), fixture('appmanifest_105600.acf'));
  fs.mkdirSync(path.join(root, 'steamapps', 'common', 'Terraria'), { recursive: true });
  put(path.join(menu, 'Terraria.lnk'), 'lnk');
  put(path.join(menu, 'Notion.lnk'), 'lnk');
  let t = 1000;
  const result = await scan.scanAll({
    places: { steamRoot: root, epicManifests: path.join(menu, 'none'), startMenus: [menu] },
    regQuery: async () => { throw new Error('no reg here'); },
    readShortcut: () => ({ target: 'C:\\x\\app.exe' }),
    now: () => (t += 5),
  });
  assert.deepEqual(result.items.map((i) => [i.name, i.source]), [['Terraria', 'steam'], ['Notion', 'start']]);
  assert.deepEqual(result.counts, { steam: 1, epic: 0, gog: 0, start: 1 });
  assert.equal(result.version, scan.SCAN_VERSION);
  assert.ok(result.at > 1000);
});

test('the cache is scanned again after a day, or when it makes no sense', () => {
  const now = 10 * scan.MAX_AGE_MS;
  const fresh = { version: scan.SCAN_VERSION, at: now - 1000, items: [] };
  assert.equal(scan.isStale(fresh, now), false);
  assert.equal(scan.isStale({ ...fresh, at: now - scan.MAX_AGE_MS - 1 }, now), true);
  assert.equal(scan.isStale(null, now), true);
  assert.equal(scan.isStale({ ...fresh, version: 0 }, now), true);
  assert.equal(scan.isStale({ ...fresh, items: null }, now), true);
  assert.equal(scan.isStale({ ...fresh, at: now + 2 * 60 * 60 * 1000 }, now), true); // from the future
  assert.equal(scan.isStale({ ...fresh, at: 'x' }, now), true);
});

test('merge: your table first, found items only when they are new, and they ask before closing', () => {
  const table = cleanApps([
    { name: 'Discord', target: 'C:\\D\\Update.exe', processes: ['Discord'] },
    { name: 'Opera GX', aliases: ['navegador'], target: 'C:\\O\\opera.exe' },
    { name: 'Hollow', type: 'steam', target: '367520' },
  ]);
  const found = [
    { name: 'discord', source: 'start', type: 'program', target: 'C:\\m\\Discord.lnk' }, // same name
    { name: 'Navegador', source: 'start', type: 'program', target: 'C:\\m\\Nav.lnk' }, // an alias of yours
    { name: 'Hollow Knight', source: 'steam', type: 'steam', target: '367520' }, // same Steam id
    { name: 'Opera Browser', source: 'start', type: 'program', target: 'C:\\m\\Opera.lnk', exe: 'C:\\O\\opera.exe' }, // same exe
    { name: 'Terraria', source: 'steam', type: 'steam', target: '105600', dir: 'C:\\S\\common\\Terraria' },
    { name: 'Notion', source: 'start', type: 'program', target: 'C:\\m\\Notion.lnk', processes: ['Notion'] },
    { name: '', source: 'start', type: 'program', target: 'x' },
  ];
  const merged = scan.mergeApps(table, found);
  assert.deepEqual(merged.map((a) => a.name), ['Discord', 'Opera GX', 'Hollow', 'Terraria', 'Notion']);
  const terraria = merged[3];
  assert.equal(terraria.source, 'steam');
  assert.equal(terraria.close, 'ask');
  assert.equal(terraria.dir, 'C:\\S\\common\\Terraria');
  assert.deepEqual(merged[4].processes, ['Notion']);
  assert.equal(merged[0].source, undefined);
});

test('commands reach found games, but your table wins a tie', () => {
  const { parseAppCommand, planAppCommand } = require('../src/main/app-command');
  const table = cleanApps([{ name: 'Terraria', type: 'program', target: 'C:\\T\\Terraria.exe' }]);
  const apps = scan.mergeApps(table, [
    { name: 'Terraria', source: 'steam', type: 'steam', target: '105600' },
    { name: 'Hollow Knight', source: 'steam', type: 'steam', target: '367520' },
  ]);
  const plan = (text) => planAppCommand(parseAppCommand(text, apps));
  assert.equal(plan('abre Terraria').apps[0].type, 'program');
  assert.equal(plan('abre hollow knight').apps[0].target, '367520');
  assert.equal(plan('cierra Hollow Knight').apps[0].close, 'ask');
});
