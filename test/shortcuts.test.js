'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shortcutConflict } = require('../src/main/hearing');

const COMBOS = [
  ['toggle', 'Ctrl+Alt+C', 'mostrar / ocultar'],
  ['chat', 'Ctrl+Alt+T', 'abrir el chat'],
  ['talk', 'Ctrl+Alt+V', 'escuchar / detener'],
  ['clip', 'Alt+F10', 'guardar clip'],
  ['menu', 'Ctrl+Alt+M', 'cerrar el menú'],
  ['force', 'Ctrl+Alt+Shift+Q', 'salir de emergencia'],
];

test('a shortcut change is refused when another one already holds the combo', () => {
  assert.equal(shortcutConflict('ctrl + alt + t', COMBOS)[2], 'abrir el chat');
  assert.equal(shortcutConflict('Alt+F10', COMBOS)[2], 'guardar clip');
  assert.equal(shortcutConflict('Ctrl+Alt+M', COMBOS)[2], 'cerrar el menú');
  assert.equal(shortcutConflict('Ctrl+Alt+Shift+Q', COMBOS)[2], 'salir de emergencia');
  // The one being changed does not conflict with itself.
  assert.equal(shortcutConflict('Ctrl+Alt+C', COMBOS, 'toggle'), null);
  assert.equal(shortcutConflict('Ctrl+Alt+F8', COMBOS), null);
});

test('main.js routes both IPCs through setShortcut and checks every taken combo', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(source, /function setShortcut\(id, value\)/);
  assert.match(source, /shortcutConflict\(accel, combos, id\)/);
  assert.match(source, /\[['"]menu['"], menuCloseCombo, /);
  assert.match(source, /\[['"]force['"], FORCE_QUIT_ACCEL, /);
  assert.match(source, /case 'talk-hotkey': return setShortcut\('talk', value\)/);
  assert.match(source, /case 'shortcut-set': return setShortcut\(value\?\.id, value\)/);
  assert.match(source, /config\.save\(\{ shortcuts: \{ \[id\]: accel \} \}\)/);
  assert.match(source, /config\.save\(\{ hearing: \{ talkHotkey: accel \} \}\)/);
  // The tray row follows config.json instead of a hardcoded Ctrl+Alt+C.
  assert.match(source, /accelerator: s\.shortcuts\.find\(\(k\) => k\.id === 'toggle'\)\?\.accel/);
});

test('Ajustes › Atajos uses the same capture flow as Tecla para hablar', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /this\.capturingId = null/);
  assert.match(source, /shortcutRow\(s, build, kbd\)/);
  assert.match(source, /section\('ATAJOS', 'shortcuts'\)/);
  assert.match(source, /PULSA LA COMBINACIÓN…/);
  assert.match(source, /saveShortcut\(id, keys\)/);
  assert.match(source, /id: 'shortcut-set', value: \{ id, \.\.\.keys \}/);
  assert.match(source, /this\.capturingId === 'talk'/);
  assert.match(source, /this\.capturingId = capturing \? null : s\.id/);
});
