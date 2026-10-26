'use strict';

// What counts as a game: a fullscreen foreground window whose exe lives in a games folder,
// or one the user listed in gaming.apps. A maximized browser must never count.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isGameExe, gameOnScreen, normalizePath } = require('../src/main/game-detect.js');

test('exes under a games folder are games', () => {
  assert.equal(isGameExe('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe'), true);
  assert.equal(isGameExe('D:\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe'), true);
  assert.equal(isGameExe('C:\\XboxGames\\Halo\\Content\\halo.exe'), true);
  assert.equal(isGameExe('D:\\GOG Games\\Disco Elysium\\game.exe'), true);
});

test('a normal program is not a game', () => {
  assert.equal(isGameExe('C:\\Users\\Matias\\AppData\\Local\\Programs\\Opera GX\\opera.exe'), false);
  assert.equal(isGameExe('C:\\Program Files\\Microsoft VS Code\\Code.exe'), false);
  assert.equal(isGameExe(''), false);
  assert.equal(isGameExe(undefined), false);
});

test('gaming.apps matches by exe name or path fragment', () => {
  const apps = ['Dolphin.exe', 'D:\\Roms\\Emus'];
  assert.equal(isGameExe('C:\\emu\\Dolphin.exe', apps), true);
  assert.equal(isGameExe('C:\\emu\\dolphin.EXE', apps), true);
  assert.equal(isGameExe('D:\\Roms\\Emus\\PCSX2\\pcsx2-qt.exe', apps), true);
  assert.equal(isGameExe('C:\\Program Files\\Opera GX\\opera.exe', apps), false);
});

test('paths are compared with forward slashes and case folded', () => {
  assert.equal(normalizePath('  C:/Steam/steamapps/common/Game/  '), 'c:\\steam\\steamapps\\common\\game\\');
});

test('a game has to be fullscreen and in front', () => {
  const game = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\Hades.exe';
  assert.equal(gameOnScreen({ fgExe: game, fgFull: true }), true);
  assert.equal(gameOnScreen({ fgExe: game, fgFull: false }), false);
  assert.equal(gameOnScreen({ fgExe: 'C:\\Windows\\explorer.exe', fgFull: true }), false);
  assert.equal(gameOnScreen(null), false);
  assert.equal(gameOnScreen({}), false);
});

test('configured apps go through gameOnScreen too', () => {
  const windows = { fgExe: 'C:\\emu\\Dolphin.exe', fgFull: true };
  assert.equal(gameOnScreen(windows, ['dolphin.exe']), true);
});
