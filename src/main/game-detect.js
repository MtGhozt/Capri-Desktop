'use strict';

// What counts as "a game took the screen": a fullscreen foreground window whose exe lives
// where games are installed, or an app the user listed in config.json -> gaming.apps.

const GAME_DIRS = [
  '\\steamapps\\common\\',
  '\\epic games\\',
  '\\gog games\\',
  '\\gog galaxy\\games\\',
  '\\xboxgames\\',
  '\\ea games\\',
  '\\riot games\\',
  '\\ubisoft game launcher\\games\\',
  '\\itch.io\\',
];

function normalizePath(value) {
  return String(value ?? '').trim().replace(/\//g, '\\').toLowerCase();
}

function isGameExe(exePath, apps = []) {
  const exe = normalizePath(exePath);
  if (!exe) return false;
  if (GAME_DIRS.some((dir) => exe.includes(dir))) return true;
  const name = exe.split('\\').pop();
  return (Array.isArray(apps) ? apps : []).some((app) => {
    const entry = normalizePath(app);
    if (!entry) return false;
    return name === entry || exe.endsWith(entry) || exe.includes(entry);
  });
}

/** The window watcher says whether the foreground window covers its monitor. */
function gameOnScreen(windows, apps = []) {
  return Boolean(windows?.fgFull) && isGameExe(windows?.fgExe, apps);
}

module.exports = { GAME_DIRS, isGameExe, gameOnScreen, normalizePath };
