'use strict';

// Her apps table and the scan of what is installed: "abre Discord", "cierra Spotify", the APPS
// menu and scan.json. main.js keeps the wire-up (app-fx, announce) and calls into this.

const path = require('node:path');
const fs = require('node:fs');
const { app, dialog, shell } = require('electron');

const config = require('./config');
const { createAppFlow } = require('./app-flow');
const { createAppActions, isProtected } = require('./app-actions');
const { pickLine, fillLine } = require('./lines-es');
const appScan = require('./app-scan');
const appHost = require('./app-host');
const {
  TYPE_LABEL, CLOSE_LABEL, CLOSE_MODES, plainKey, cleanApps, normalizeApp, seedApps, defaultCandidates,
  browserName, exeFromCommand, processName, linkTarget, linkOk, SEED_VERSION, seededVersion, newCandidates,
} = require('./apps-config');

function createAppsWiring({ log, announce, sendCommand, zap, spark, getOverlay }) {

  // "abre Discord", "cierra Spotify": straight from her table (config apps.list), no model.
  const appList = () => cleanApps(config.load().apps?.list);
  // your table first, then what her scan found on this PC (Paso 4D)
  const allApps = () => appScan.mergeApps(appList(), scanned().items);

  let appFlow = null;

  function apps() {
    if (!appFlow) {
      appFlow = createAppFlow({
        apps: allApps,
        actions: createAppActions({
          ...appHost.realDeps({ shell, skipPids: () => [process.pid, process.ppid] }),
          zap: (rect) => zap(rect),
          spark: (app) => spark(app),
        }),
        line: (kind, values) => fillLine(pickLine(kind), values),
        log,
        event: (kind, text) => sendCommand('box-log', { kind, text }),
      });
    }
    return appFlow;
  }

  function appReply(result, { chat = true } = {}) {
    announce(result.line, { chat, badge: 'APPS' });
    return { ok: true };
  }

  // First run: what this PC has (Discord, Spotify, Namida, Steam, the browser, Grok, Cursor, Warp,
  // Notion, Epic…) plus YouTube, Google and the File Explorer, added next to whatever is already in
  // the table, never over it. A table seeded by an older version only gets the newer candidates.
  async function seedAppTable() {
    const version = seededVersion(config.load().apps?.seeded);
    if (version >= SEED_VERSION) return;
    const found = await appHost.lookups(shell).catch(() => ({}));
    const exe = exeFromCommand(found.browserCommand);
    const browser = exe ? { exe, ...browserName(exe) } : null;
    const candidates = newCandidates(defaultCandidates({ exists: appHost.exists, found: { ...found, browser } }), version);
    const { list, added } = seedApps(config.load().apps?.list, candidates);
    config.save({ apps: { list, seeded: SEED_VERSION } });
    log(`apps seeded v${SEED_VERSION}: ${added.length ? added.join(', ') : 'nothing new'}`);
  }

  // -- what is installed (Paso 4D) ------------------------------------------------------------
  // Steam, Epic and GOG games and the Start menu, cached in scan.json; scanned again at start when
  // a day old, and from her menu (APPS, Volver a escanear).

  const scanPath = () => path.join(app.getPath('userData'), 'scan.json');
  let scanCache;
  let scanRunning = null;

  function scanned() {
    if (scanCache === undefined) {
      try {
        scanCache = JSON.parse(fs.readFileSync(scanPath(), 'utf8'));
      } catch {
        scanCache = null;
      }
    }
    return scanCache && Array.isArray(scanCache.items) ? scanCache : { items: [] };
  }

  function runScan(reason) {
    if (scanRunning) return scanRunning;
    scanRunning = (async () => {
      const places = await appScan.scanPlaces({ env: process.env, regValue: appHost.regValue });
      const result = await appScan.scanAll({
        places,
        regQuery: appHost.regQuery,
        readShortcut: (file) => appHost.readShortcut(shell, file),
        isProtected,
      });
      const tmp = `${scanPath()}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(result, null, 2), 'utf8');
      await fs.promises.rename(tmp, scanPath());
      scanCache = result;
      const c = result.counts;
      log(`apps scan (${reason}): steam=${c.steam} epic=${c.epic} gog=${c.gog} start=${c.start} in ${result.ms}ms`);
      return result;
    })().finally(() => {
      scanRunning = null;
    });
    return scanRunning;
  }

  function scanIfStale() {
    scanned();
    if (!appScan.isStale(scanCache)) return;
    runScan(scanCache ? 'stale' : 'first').catch((err) => log(`apps scan failed: ${err.message}`));
  }

  // What the scan found that isn't in your table: { name, source, … } as shown in her menu.
  function foundApps() {
    const table = appList();
    return appScan.mergeApps(table, scanned().items).slice(table.length);
  }

  function promoteApp(name) {
    const found = foundApps().find((a) => sameName(a.name, name));
    if (!found) return { ok: false, message: 'Ya no está en lo encontrado. Vuelve a escanear.' };
    const { source, ...entry } = found;
    return addApp(entry);
  }

  async function rescanApps() {
    try {
      const result = await runScan('menu');
      return { ok: true, counts: result.counts };
    } catch (err) {
      log(`apps scan failed: ${err.message}`);
      return { ok: false, message: `No se pudo escanear: ${err.message}` };
    }
  }

  function saveApps(list) {
    config.save({ apps: { list: cleanApps(list) } });
  }

  function sameName(a, b) {
    return plainKey(a) === plainKey(b);
  }

  // A new entry from her menu: { ok, name } or { ok: false, message } in Spanish.
  function addApp(raw) {
    const entry = normalizeApp(raw);
    if (!entry) return { ok: false, message: 'Eso no sirve como app.' };
    const list = appList();
    const clash = list.find((a) => [a.name, ...a.aliases].some((n) => sameName(n, entry.name)));
    if (clash) return { ok: false, message: `Ya tienes «${clash.name}». Cámbiale los alias en vez de repetirla.` };
    saveApps([...list, entry]);
    log(`app added ${entry.name} type=${entry.type}`);
    return { ok: true, name: entry.name };
  }

  async function pickProgram() {
    const res = await dialog.showOpenDialog(getOverlay(), {
      title: 'Buscar programa',
      properties: ['openFile'],
      filters: [{ name: 'Programas y accesos directos', extensions: ['exe', 'lnk'] }],
    });
    const file = !res.canceled && res.filePaths?.[0];
    if (!file) return { ok: false, message: '' };
    let target = file;
    let args = '';
    if (/\.lnk$/i.test(file)) {
      const link = appHost.readShortcut(shell, file);
      if (link) ({ target, args } = link);
    }
    const name = path.basename(file).replace(/\.(exe|lnk)$/i, '');
    return addApp({
      name, aliases: [], type: 'program', target, args,
      processes: /\.exe$/i.test(target) ? [processName(target)] : [], close: 'graceful',
    });
  }

  // "abrí Descargas": a folder or any file, opened through the shell like a .lnk.
  async function pickFolderOrFile() {
    const res = await dialog.showOpenDialog(getOverlay(), {
      title: 'Buscar carpeta o archivo',
      properties: ['openFile', 'openDirectory'],
    });
    const file = !res.canceled && res.filePaths?.[0];
    if (!file) return { ok: false, message: '' };
    return addApp({
      name: path.basename(file),
      aliases: [],
      type: 'program',
      target: file,
      args: '',
      processes: /\.exe$/i.test(file) ? [processName(file)] : [],
      close: 'graceful',
    });
  }

  function addLink(value = {}) {
    const name = String(value.name || '').trim();
    if (!name) return { ok: false, message: 'Ponle un nombre.' };
    const target = linkTarget(value.url);
    if (!linkOk(target)) return { ok: false, message: 'Ese enlace no sirve: usa https://… o un URI como spotify:' };
    return addApp({ name, type: 'link', target, aliases: [] });
  }

  function updateApp(value = {}) {
    const list = appList();
    const index = list.findIndex((a) => sameName(a.name, value.name));
    if (index < 0) return { ok: false, message: 'Esa app ya no está.' };
    const next = { ...list[index] };
    if (value.aliases != null) next.aliases = value.aliases;
    if (CLOSE_MODES.includes(value.close)) next.close = value.close;
    const entry = normalizeApp(next);
    if (!entry) return { ok: false, message: 'No se pudo guardar.' };
    list[index] = entry;
    saveApps(list);
    log(`app updated ${entry.name} aliases=${entry.aliases.join('|') || '-'} close=${entry.close}`);
    return { ok: true, name: entry.name };
  }

  function removeApp(name) {
    const list = appList();
    const next = list.filter((a) => !sameName(a.name, name));
    if (next.length === list.length) return { ok: false, message: 'Esa app ya no está.' };
    saveApps(next);
    log(`app removed ${name}`);
    return { ok: true };
  }

  function appsMenuState() {
    return appList().map((a) => ({
      name: a.name,
      type: a.type,
      typeLabel: TYPE_LABEL[a.type] || a.type,
      aliases: a.aliases,
      close: a.close,
      closeLabel: CLOSE_LABEL[a.close] || a.close,
      target: a.type === 'steam' ? `steam ${a.target}` : a.target,
      processes: a.processes,
      windows: a.windows || null,
      dir: a.dir || null,
      title: a.title || null,
    }));
  }

  return {
    apps,
    appReply,
    allApps,
    appList,
    seedAppTable,
    scanned,
    scanIfStale,
    foundApps,
    promoteApp,
    rescanApps,
    addApp,
    updateApp,
    removeApp,
    addLink,
    pickProgram,
    pickFolderOrFile,
    appsMenuState,
    getScanRunning: () => scanRunning,
  };
}

module.exports = { createAppsWiring };
