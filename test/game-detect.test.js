'use strict';

// What counts as a game: a fullscreen foreground window whose exe lives in a games folder,
// or one the user listed in gaming.apps. A maximized browser must never count.
// Ignored entries in gaming.apps never trigger game mode.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isGameExe, gameOnScreen, windowedGameInFront, normalizePath, patchGamingApps, isIgnoredExe, GAME_DIRS,
} = require('../src/main/game-detect.js');
const fs = require('node:fs');
const path = require('node:path');

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

test('game mode takes any fullscreen window that is not a known non-game', () => {
  // javaw runs the game from wherever the launcher put it: no games folder needed
  assert.equal(gameOnScreen({ fgExe: 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe', fgFull: true }), true);
  assert.equal(gameOnScreen({ fgExe: 'C:\\Users\\Matias\\Downloads\\SomeGame\\game.exe', fgFull: true }), true);
  // ...but the shell, browsers, terminals and overlays never do
  for (const exe of [
    'C:\\Windows\\explorer.exe',
    'C:\\Windows\\System32\\taskmgr.exe',
    'C:\\Program Files\\Windows Terminal\\WindowsTerminal.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\brave.exe',
  ]) {
    assert.equal(gameOnScreen({ fgExe: exe, fgFull: true }), false, exe);
  }
  // her comments stay strict: an unconfigured emu or a stray javaw in front is nothing
  assert.equal(isGameExe('C:\\emu\\Dolphin.exe'), false);
  assert.equal(isGameExe('C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe'), false);
});

test('windowed known game (steamapps) pins only — not gameOnScreen', () => {
  const isaac = {
    fgExe: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\The Binding of Isaac Rebirth\\isaac-ng.exe',
    fgFull: false,
  };
  assert.equal(isGameExe(isaac.fgExe), true);
  assert.equal(gameOnScreen(isaac), false);
  assert.equal(windowedGameInFront(isaac), true);
  assert.equal(windowedGameInFront({ ...isaac, fgFull: true }), false);
  // Denylist stays out even when windowed.
  assert.equal(windowedGameInFront({
    fgExe: 'C:\\Users\\Matias\\AppData\\Local\\Discord\\Discord.exe', fgFull: false,
  }), false);
  assert.equal(windowedGameInFront({
    fgExe: 'C:\\Users\\Matias\\AppData\\Roaming\\Spotify\\Spotify.exe', fgFull: false,
  }), false);
  const main = require('./main-source');
  assert.match(main, /windowedGameInFront/);
  assert.match(main, /gameQuiet\.pin\(overlay\)/);
});

test('Discord/Spotify maximized or fullscreen are never games; javaw fullscreen is', () => {
  for (const exe of [
    'C:\\Users\\Matias\\AppData\\Local\\Discord\\app-1.0\\Discord.exe',
    'C:\\Users\\Matias\\AppData\\Roaming\\Spotify\\Spotify.exe',
    'C:\\Program Files (x86)\\Steam\\steam.exe',
    'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe',
    'C:\\Users\\Matias\\AppData\\Local\\WhatsApp\\WhatsApp.exe',
    'C:\\Users\\Matias\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe',
    'C:\\Users\\Matias\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    'C:\\Users\\Matias\\AppData\\Local\\Programs\\cursor\\Cursor.exe',
  ]) {
    assert.equal(gameOnScreen({ fgExe: exe, fgFull: true }), false, exe);
    assert.equal(gameOnScreen({ fgExe: exe, fgFull: false }), false, exe);
  }
  assert.equal(gameOnScreen({
    fgExe: 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe', fgFull: true,
  }), true);
  assert.equal(gameOnScreen({
    fgExe: 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe', fgFull: false,
  }), false);
});
