'use strict';

// What the foreground window is for, so she can say something that fits: the music player,
// a game, a video in a browser tab, or code. Only the exe and the foreground title are read.

const { isGameExe } = require('./game-detect');

const MUSIC_EXES = ['namida.exe', 'spotify.exe'];
const BROWSER_EXES = [
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'opera_gx.exe',
  'brave.exe', 'vivaldi.exe', 'librewolf.exe', 'zen.exe',
];
const CODE_EXES = ['opencode.exe', 'cursor.exe', 'code.exe', 'code - insiders.exe', 'warp.exe'];
const VIDEO_TITLE = /\b(youtube|netflix|twitch)\b/i;

function exeName(raw) {
  const value = String(raw ?? '').trim().replace(/\//g, '\\').toLowerCase();
  return value.split('\\').pop() || '';
}

/** 'musica' | 'juego' | 'video' | 'programando' | null */
function windowContext(windows, { apps = [] } = {}) {
  const exe = String(windows?.fgExe ?? '');
  const name = exeName(exe);
  if (!name) return null;
  if (isGameExe(exe, apps)) return 'juego';
  if (MUSIC_EXES.includes(name)) return 'musica';
  if (BROWSER_EXES.includes(name) && VIDEO_TITLE.test(String(windows?.fgTitle ?? ''))) return 'video';
  if (CODE_EXES.includes(name)) return 'programando';
  return null;
}

module.exports = { MUSIC_EXES, BROWSER_EXES, CODE_EXES, VIDEO_TITLE, exeName, windowContext };
