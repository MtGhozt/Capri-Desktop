'use strict';

// What counts as "a game took the screen". Two rules: game mode (gameOnScreen) takes any
// fullscreen window that isn't a known non-game — so a game outside the usual folders (javaw
// from a launcher) still enters — while her comments (isGameExe) stay strict: a games folder
// or an app the user listed in config.json -> gaming.apps.
// Entries may be strings (allow) or { match, ignore: true } / "!exe" (never treat as a game).

const GAME_DIRS = [
  '\\steamapps\\common\\',
  '\\epic games\\',
  '\\gog games\\',
  '\\gog galaxy\\games\\',
  '\\xboxgames\\',
  '\\windowsapps\\',
  '\\ea games\\',
  '\\electronic arts\\',
  '\\riot games\\',
  '\\ubisoft game launcher\\games\\',
  '\\ubisoft\\games\\',
  '\\itch.io\\',
  '\\itch\\apps\\',
];

const NEVER_GAME_EXES = new Set([
  // her own stack and the recorders
  'capri.exe', 'electron.exe', 'recordly.exe',
  'snippingtool.exe', 'obs.exe', 'obs64.exe',
  // shell and system: fullscreen one and no game took the screen
  'explorer.exe', 'searchhost.exe', 'startmenuexperiencehost.exe', 'taskmgr.exe',
  'windowsterminal.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe',
  // overlays that sit on top of a game
  'gamebar.exe', 'nvidia share.exe', 'nvidia overlay.exe',
  // browsers: maximized or fullscreen, never a game
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'opera_gx.exe',
  'brave.exe', 'vivaldi.exe', 'librewolf.exe', 'zen.exe',
  // editors / agents / terminals
  'code.exe', 'code - insiders.exe', 'cursor.exe', 'devenv.exe', 'antigravity.exe',
  'notepad.exe', 'notepad++.exe', 'sublime_text.exe', 'opencode.exe', 'warp.exe',
  // chat, music, launchers: F11/borderless must not look like a game
  'discord.exe', 'discordptb.exe', 'discordcanary.exe',
  'spotify.exe',
  'steam.exe', 'steamwebhelper.exe',
  'epicgameslauncher.exe', 'epicwebhelper.exe',
  'whatsapp.exe', 'telegram.exe',
  // calls / media / office / design: fullscreen is not a game
  'zoom.exe', 'teams.exe', 'ms-teams.exe', 'slack.exe', 'notion.exe', 'figma.exe',
  'vlc.exe', 'mpv.exe', 'grok bot.exe', 'powerpnt.exe', 'winword.exe', 'excel.exe',
  'acrobat.exe', 'stremio.exe', 'plex.exe',
]);

function normalizePath(value) {
  return String(value ?? '').trim().replace(/\//g, '\\').toLowerCase();
}

function normalizeAppEntry(app) {
  if (app == null) return null;
  if (typeof app === 'string') {
    const raw = String(app).trim();
    if (!raw) return null;
    if (raw.startsWith('!')) {
      const match = raw.slice(1).trim();
      return match ? { match, ignore: true } : null;
    }
    return { match: raw, ignore: false };
  }
  const match = String(app.match || app.path || app.exe || '').trim();
  if (!match) return null;
  return { match, ignore: Boolean(app.ignore) };
}

function entryMatches(entry, exePath) {
  const parsed = normalizeAppEntry(entry);
  if (!parsed) return false;
  const exe = normalizePath(exePath);
  const needle = normalizePath(parsed.match);
  if (!exe || !needle) return false;
  const name = exe.split('\\').pop();
  return name === needle || exe.endsWith(needle) || exe.includes(needle);
}

function isIgnoredExe(exePath, apps = []) {
  return (Array.isArray(apps) ? apps : []).some((app) => {
    const parsed = normalizeAppEntry(app);
    return parsed?.ignore && entryMatches(parsed, exePath);
  });
}

function isAllowlistedExe(exePath, apps = []) {
  return (Array.isArray(apps) ? apps : []).some((app) => {
    const parsed = normalizeAppEntry(app);
    return parsed && !parsed.ignore && entryMatches(parsed, exePath);
  });
}

// Game mode's rule (via gameOnScreen): anything that isn't a known non-game counts, so a game
// enters even outside the folders below — javaw from a launcher, an itch zip anywhere on disk.
function isAnyGameExe(exePath, apps = []) {
  const exe = normalizePath(exePath);
  if (!exe) return false;
  if (isIgnoredExe(exe, apps)) return false;
  if (NEVER_GAME_EXES.has(exe.split('\\').pop())) return false;
  if (isAllowlistedExe(exe, apps)) return true;
  return !exe.includes('\\windowsapps\\microsoft.');
}

// Her comments' rule: only a games folder or a configured app is "a game".
function isGameExe(exePath, apps = []) {
  const exe = normalizePath(exePath);
  if (!isAnyGameExe(exe, apps)) return false;
  return isAllowlistedExe(exe, apps) || GAME_DIRS.some((dir) => exe.includes(dir));
}

/** The window watcher says whether the foreground window covers its monitor. */
function gameOnScreen(windows, apps = []) {
  return Boolean(windows?.fgFull) && isAnyGameExe(windows?.fgExe, apps);
}

/** Known game (steamapps/common, other GAME_DIRS, or gaming.apps) but windowed — pin Capri only. */
function windowedGameInFront(windows, apps = []) {
  if (!windows?.fgExe || windows.fgFull) return false;
  return isGameExe(windows.fgExe, apps);
}

/** Exe basename suitable for gaming.apps (allow or ignore). */
function gameAppKey(exePath) {
  const exe = normalizePath(exePath);
  if (!exe) return '';
  return exe.split('\\').pop() || '';
}

/**
 * Editable allow/ignore list stored in gaming.apps.
 * action: 'allow' | 'ignore' | 'remove'
 */
function patchGamingApps(apps, exePath, action = 'allow') {
  const key = gameAppKey(exePath);
  if (!key) return Array.isArray(apps) ? [...apps] : [];
  const list = (Array.isArray(apps) ? apps : []).filter((app) => !entryMatches(app, exePath));
  if (action === 'remove') return list;
  if (action === 'ignore') {
    list.push({ match: key, ignore: true });
    return list;
  }
  list.push(key);
  return list;
}

module.exports = {
  GAME_DIRS,
  isGameExe,
  gameOnScreen,
  windowedGameInFront,
  normalizePath,
  normalizeAppEntry,
  isIgnoredExe,
  gameAppKey,
  patchGamingApps,
};
