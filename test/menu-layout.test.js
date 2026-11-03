'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { QUICK_MENU_ITEMS, SETTINGS_TABS, unionRects } = require('../src/renderer/js/menu.js');

test('quick menu contains only compact controls and settings entry', () => {
  assert.deepEqual(QUICK_MENU_ITEMS.map((item) => item.id), [
    'mic', 'mic-device', 'reply-mode', 'model-provider', 'fixes', 'clip-save', 'do-something', 'behavior', 'drone-mode', 'theme', 'settings', 'quit',
  ]);
});

test('settings tabs cover every non-quick configuration area', () => {
  assert.deepEqual(SETTINGS_TABS.map((tab) => tab.id), [
    'model', 'agents', 'memory', 'hearing', 'apps', 'bubble', 'music', 'shortcuts', 'behavior', 'about',
  ]);
});

test('menu hit rect includes an open floating submenu', () => {
  assert.deepEqual(unionRects(
    { left: 100, top: 100, right: 400, bottom: 500 },
    { left: 410, top: 140, right: 630, bottom: 300 },
  ), { left: 100, top: 100, right: 630, bottom: 500 });
});

test('Capri sits above the message box without blocking its input', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles', 'capri.css'), 'utf8');
  assert.match(css, /\.capri\.is-on-box\s*\{[^}]*z-index:\s*5;[^}]*pointer-events:\s*none;/s);
});

test('Hacer algo is a direct quick-menu action, not a submenu', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /includes\(id\)\s*\?\s*''\s*:\s*'›'/);
  assert.match(source, /row\('Hacer algo', '', 'do-something', \(\) => this\.act\('do-something'\)\)/);
});

test('game submenu refreshes without closing the menu', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /id === 'game-list'/);
});

test('voice picker supports wav and transcript multi-selection', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(source, /properties:\s*\['openFile',\s*'multiSelections'\]/);
});

test('startup keeps the intro animation enabled by default', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');
  assert.match(source, /else if \(config\.fx\?\.intro !== false\) await capri\.intro/);
});

test('overlay is shown when the renderer finishes loading, not only ready-to-show', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(source, /did-finish-load[\s\S]{0,300}overlay\.showInactive\(\)/);
});

test('render changes do not relaunch the development process', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(source, /if \(DEV\)[\s\S]{0,160}doQuit\(\)/);
  assert.match(source, /app\.relaunch\(\)/);
});

test('game removal returns visible feedback', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(source, /message: .*quitado de la lista/);
});

test('agent rows include install guidance for every supported CLI', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /for \(const id of agentIds\.filter/);
  assert.match(source, /PowerShell/);
});

test('screen context includes visible windows for desktop screenshots', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(source, /Apps\/ventanas abiertas/);
});

test('Acerca de lives only in Ajustes, not the overlay quick menu', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.doesNotMatch(source, /row\('Acerca de/);
  assert.match(source, /\{ id: 'about', label: 'Acerca de' \}/);
  assert.match(source, /light:\s*true/);
});

test('settings tabs have isolated sections and behavior uses nested config', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /bubble:\s*\['bubble'\]/);
  assert.match(source, /\{ id: 'bubble', label: 'Apariencia' \}/);
  assert.match(source, /shortcuts:\s*\['shortcuts'\]/);
  assert.match(source, /behavior:\s*\['behavior'\]/);
  assert.match(source, /about:\s*\['about'\]/);
  assert.match(source, /cfg\.behavior\?\.greetings/);
  assert.match(source, /cfg\.comments\?\.\[[^\]]+\]/);
  assert.match(source, /toggle\('Saludos'/);
  assert.doesNotMatch(source, /Modo compacto|compact-mode/);
  const behavior = source.match(/section\('COMPORTAMIENTO', 'behavior'\)([\s\S]*?)section\('APARIENCIA'/);
  assert.ok(behavior, 'behavior section must end before Apariencia');
  assert.doesNotMatch(behavior[1], /Tema|Atajos|Pantalla|Animaciones|Arrastrar|Iniciar con Windows/);
});
