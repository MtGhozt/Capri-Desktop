'use strict';

// What the foreground window is for: music, a game, a video in a browser tab, or code.
// Only the exe and, for browsers, the foreground title are looked at.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { windowContext, exeName } = require('../src/main/context.js');

const win = (fgExe, fgTitle = '') => ({ fgExe, fgTitle });

test('music players are music', () => {
  assert.equal(windowContext(win('C:\\Software\\Namida\\namida\\namida.exe')), 'musica');
  assert.equal(windowContext(win('C:\\Users\\Matias\\AppData\\Roaming\\Spotify\\Spotify.exe')), 'musica');
});

test('a game wins over everything else', () => {
  const game = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\Hades.exe';
  assert.equal(windowContext(win(game, 'YouTube')), 'juego');
  assert.equal(windowContext(win(game), { apps: [] }), 'juego');
});

test('a browser is video only when its tab says so', () => {
  const opera = 'C:\\Users\\Matias\\AppData\\Local\\Programs\\Opera GX\\opera.exe';
  assert.equal(windowContext(win(opera, '(2) Tres lecciones - YouTube - Opera')), 'video');
  assert.equal(windowContext(win(opera, 'Netflix')), 'video');
  assert.equal(windowContext(win(opera, 'Twitch')), 'video');
  assert.equal(windowContext(win(opera, 'GitHub - Opera')), null);
  assert.equal(windowContext(win(opera)), null);
});

test('editors and terminals are code', () => {
  assert.equal(windowContext(win('C:\\Users\\Matias\\AppData\\Local\\Programs\\cursor\\Cursor.exe')), 'programando');
  assert.equal(windowContext(win('C:\\Program Files\\Microsoft VS Code\\Code.exe')), 'programando');
  assert.equal(windowContext(win('C:\\Users\\Matias\\AppData\\Local\\Programs\\Warp\\warp.exe')), 'programando');
  assert.equal(windowContext(win('C:\\Users\\Matias\\AppData\\Local\\opencode\\opencode.exe')), 'programando');
});

test('configured gaming apps count as a game', () => {
  assert.equal(windowContext(win('C:\\emu\\Dolphin.exe'), { apps: ['dolphin.exe'] }), 'juego');
  assert.equal(windowContext(win('C:\\emu\\Dolphin.exe')), null);
});

test('unknown, empty and foreground-less windows are nothing', () => {
  assert.equal(windowContext(win('C:\\Windows\\explorer.exe')), null);
  assert.equal(windowContext(win('')), null);
  assert.equal(windowContext(null), null);
  assert.equal(windowContext({}), null);
});

test('exeName reads the file name with either slash', () => {
  assert.equal(exeName('C:/Program Files/Opera GX/opera.exe'), 'opera.exe');
  assert.equal(exeName(''), '');
  assert.equal(exeName(undefined), '');
});
