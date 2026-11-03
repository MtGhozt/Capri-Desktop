'use strict';

// What counts as a game: a fullscreen foreground window whose exe lives in a games folder,
// or one the user listed in gaming.apps. A maximized browser must never count.
// Ignored entries in gaming.apps never trigger game mode.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isGameExe, gameOnScreen, normalizePath, patchGamingApps, isIgnoredExe, GAME_DIRS,
} = require('../src/main/game-detect.js');

test('exes under a games folder are games', () => {
  assert.equal(isGameExe('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe'), true);
  assert.equal(isGameExe('D:\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe'), true);
  assert.equal(isGameExe('C:\\XboxGames\\Halo\\Content\\halo.exe'), true);
  assert.equal(isGameExe('D:\\GOG Games\\Disco Elysium\\game.exe'), true);
});

test('launcher-path detection covers Steam, Epic, GOG, Xbox/WindowsApps, EA, Riot, Ubisoft, itch', () => {
  const samples = [
    'C:\\Steam\\steamapps\\common\\Game\\game.exe',
    'D:\\Epic Games\\Game\\game.exe',
    'D:\\GOG Galaxy\\Games\\Game\\game.exe',
    'C:\\XboxGames\\Game\\Content\\game.exe',
    'C:\\Program Files\\WindowsApps\\Something.Game_1.0\\game.exe',
    'C:\\Program Files\\EA Games\\FIFA\\fifa.exe',
    'C:\\Program Files\\Electronic Arts\\Apex\\r5apex.exe',
    'C:\\Riot Games\\VALORANT\\live\\VALORANT.exe',
    'C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games\\AC\\ac.exe',
    'C:\\Users\\Matias\\AppData\\Roaming\\itch\\apps\\celeste\\Celeste.exe',
  ];
  for (const exe of samples) {
    assert.equal(isGameExe(exe), true, exe);
  }
  assert.ok(GAME_DIRS.some((d) => d.includes('windowsapps')));
  assert.ok(GAME_DIRS.some((d) => d.includes('electronic arts')));
});

test('a normal program is not a game', () => {
  assert.equal(isGameExe('C:\\Users\\Matias\\AppData\\Local\\Programs\\Opera GX\\opera.exe'), false);
  assert.equal(isGameExe('C:\\Program Files\\Microsoft VS Code\\Code.exe'), false);
  assert.equal(isGameExe(''), false);
  assert.equal(isGameExe(undefined), false);
});

test('Capri, Electron and recorders are never games', () => {
  for (const exe of ['Capri.exe', 'electron.exe', 'Recordly.exe']) {
    assert.equal(isGameExe(`C:\\Games\\${exe}`, [`${exe}`]), false, exe);
  }
});

test('Microsoft system apps and common desktop tools are never games', () => {
  for (const exe of [
    'C:\\Program Files\\WindowsApps\\Microsoft.ScreenSketch_1.0\\SnippingTool.exe',
    'C:\\Program Files\\WindowsApps\\Microsoft.WindowsCalculator_1.0\\CalculatorApp.exe',
    'C:\\Program Files\\WindowsApps\\Microsoft.Windows.Photos_1.0\\Photos.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\OBS Studio\\bin\\64bit\\obs64.exe',
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
  ]) {
    assert.equal(isGameExe(exe), false, exe);
  }
  assert.equal(isGameExe(
    'C:\\Program Files\\WindowsApps\\Microsoft.SomeGame_1.0\\game.exe',
    ['Microsoft.SomeGame_1.0'],
  ), true);
});

test('gaming.apps matches by exe name or path fragment', () => {
  const apps = ['Dolphin.exe', 'D:\\Roms\\Emus'];
  assert.equal(isGameExe('C:\\emu\\Dolphin.exe', apps), true);
  assert.equal(isGameExe('C:\\emu\\dolphin.EXE', apps), true);
  assert.equal(isGameExe('D:\\Roms\\Emus\\PCSX2\\pcsx2-qt.exe', apps), true);
  assert.equal(isGameExe('C:\\Program Files\\Opera GX\\opera.exe', apps), false);
});

test('ignored exe never triggers game mode', () => {
  const steam = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\Hades.exe';
  const apps = [{ match: 'Hades.exe', ignore: true }];
  assert.equal(isIgnoredExe(steam, apps), true);
  assert.equal(isGameExe(steam, apps), false);
  assert.equal(gameOnScreen({ fgExe: steam, fgFull: true }, apps), false);
  assert.equal(isGameExe(steam, ['!Hades.exe']), false);
  // allow after ignore patch helpers
  const ignored = patchGamingApps([], steam, 'ignore');
  assert.equal(isGameExe(steam, ignored), false);
  const allowed = patchGamingApps(ignored, steam, 'allow');
  assert.equal(isGameExe('C:\\emu\\Hades.exe', allowed), true);
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
