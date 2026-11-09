'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { SETTINGS_TABS } = require('../src/renderer/js/menu.js');
const { formatDateTimeLocal, parseDateTimeLocal } = require('../src/main/reminders');
const { createWeather } = require('../src/main/weather');
const { hasNvidiaGpu } = require('../src/main/voice-install');

const menuPath = path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js');
const mainPath = path.join(__dirname, '..', 'src', 'main', 'main.js');
const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'styles', 'capri.css');
const helpPath = path.join(__dirname, '..', 'src', 'renderer', 'js', 'help-steps.js');

test('Iniciar con Windows is back in Comportamiento and reads state.login', () => {
  const menu = fs.readFileSync(menuPath, 'utf8');
  assert.match(menu, /toggle\('Iniciar con Windows'/);
  assert.match(menu, /on:\s*Boolean\(state\.login\)/);
  assert.match(menu, /this\.act\('startup'/);
  const main = fs.readFileSync(mainPath, 'utf8');
  assert.match(main, /case 'startup':/);
  assert.match(main, /getLoginItemSettings\(loginItemOptions\(\)\)\.openAtLogin/);
});

test('settings tabs rename Memoria/Oído and add Recordatorios', () => {
  assert.deepEqual(SETTINGS_TABS.map((tab) => tab.id), [
    'model', 'agents', 'memory', 'hearing', 'apps', 'bubble', 'music', 'shortcuts',
    'behavior', 'reminders', 'about',
  ]);
  assert.equal(SETTINGS_TABS.find((t) => t.id === 'memory').label, 'Memoria y personalidad');
  assert.equal(SETTINGS_TABS.find((t) => t.id === 'hearing').label, 'Oído y voz');
  assert.equal(SETTINGS_TABS.find((t) => t.id === 'reminders').label, 'Recordatorios');
  const menu = fs.readFileSync(menuPath, 'utf8');
  assert.match(menu, /reminders:\s*\['reminders'\]/);
  assert.match(menu, /section\('RECORDATORIOS', 'reminders'\)/);
  const help = fs.readFileSync(helpPath, 'utf8');
  assert.match(help, /Oído y voz/);
  assert.match(help, /Memoria y personalidad/);
});

test('Atajos rows use a consistent label/chip/action grid', () => {
  const menu = fs.readFileSync(menuPath, 'utf8');
  assert.match(menu, /appmenu__shortcut-row/);
  assert.match(menu, /appmenu__shortcut-action/);
  assert.match(menu, /appmenu__kbd--empty/);
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /\.appmenu__shortcut-row\s*\{[^}]*grid-template-columns/s);
});

test('overlay Proveedor lists active brains with reorder and Más proveedores', () => {
  const menu = fs.readFileSync(menuPath, 'utf8');
  assert.match(menu, /Más proveedores/);
  assert.match(menu, /model-reorder/);
  assert.match(menu, /brainChain/);
  assert.match(menu, /PRIORIDAD/);
  assert.match(menu, /openSettings\('model'\)/);
  assert.doesNotMatch(
    menu.slice(menu.indexOf("row('Proveedor'"), menu.indexOf("row('Corregir")),
    /model\.providers\s*\|\|\s*\[\]/,
  );
  const main = fs.readFileSync(mainPath, 'utf8');
  assert.match(main, /case 'model-reorder': return reorderBrains/);
});

test('Guardar clip shows NVIDIA-only note when hasNvidiaGpu is false', () => {
  assert.equal(typeof hasNvidiaGpu, 'function');
  const menu = fs.readFileSync(menuPath, 'utf8');
  assert.match(menu, /Solo con NVIDIA \(ShadowPlay\)/);
  assert.match(menu, /Solo NVIDIA/);
  assert.match(menu, /clips\?\.nvidia/);
  const main = fs.readFileSync(mainPath, 'utf8');
  assert.match(main, /nvidia:\s*hasNvidiaGpu\(\)/);
  const help = fs.readFileSync(helpPath, 'utf8');
  assert.match(help, /clip:\s*\{/);
  assert.match(help, /ShadowPlay/);
});

test('hasNvidiaGpu caches the default probe once per session', () => {
  const src = fs.readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'main', 'voice-install.js'),
    'utf8',
  );
  assert.match(src, /nvidiaGpuCached/);
  assert.match(src, /if \(nvidiaGpuCached !== undefined\) return nvidiaGpuCached/);
  assert.equal(hasNvidiaGpu({ readVramImpl: () => null }), false);
  assert.equal(hasNvidiaGpu({ readVramImpl: () => ({ usedMiB: 1, totalMiB: 8 }) }), true);
});

test('rebuildTray is debounced on config bursts', () => {
  const main = fs.readFileSync(mainPath, 'utf8');
  assert.match(main, /trayRebuildTimer/);
  assert.match(main, /setTimeout\(\(\) => \{[\s\S]*?rebuildTray\(true\);[\s\S]*?\}, 300\)/);
  assert.match(main, /rebuildTray\(true\)/);
});

test('resolvePlace reports label, notFound, or offline without inventing', async () => {
  const ok = createWeather({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        results: [{
          name: 'San José', country: 'Costa Rica', country_code: 'CR',
          latitude: 9.93, longitude: -84.08, timezone: 'America/Costa_Rica',
        }],
      }),
    }),
  });
  assert.deepEqual(await ok.resolvePlace('San Jose'), {
    ok: true,
    label: 'San José, Costa Rica',
    loc: {
      name: 'San José', country: 'Costa Rica', countryCode: 'CR',
      latitude: 9.93, longitude: -84.08, timezone: 'America/Costa_Rica',
    },
  });

  const missing = createWeather({
    fetchImpl: async () => ({ ok: true, json: async () => ({ results: [] }) }),
  });
  assert.deepEqual(await missing.resolvePlace('zzzz-no-city'), { notFound: true });

  const offline = createWeather({
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(await offline.resolvePlace('San José'), { offline: true });
  assert.deepEqual(await offline.resolvePlace(''), { ok: true, label: '' });
});

test('reminder datetime-local uses cfg.timeZone, not the PC clock', () => {
  const at = Date.parse('2026-11-08T15:00:00.000Z'); // 16:00 Madrid / 09:00 Costa Rica
  assert.equal(formatDateTimeLocal(at, 'Europe/Madrid'), '2026-11-08T16:00');
  assert.equal(formatDateTimeLocal(at, 'America/Costa_Rica'), '2026-11-08T09:00');
  const back = parseDateTimeLocal('2026-11-08T16:00', 'Europe/Madrid');
  assert.equal(formatDateTimeLocal(back, 'Europe/Madrid'), '2026-11-08T16:00');
  assert.equal(formatDateTimeLocal(back, 'America/Costa_Rica'), '2026-11-08T09:00');
  const menu = fs.readFileSync(menuPath, 'utf8');
  assert.match(menu, /reminderInputValue\(editAt,\s*cfg\.timeZone\)/);
  assert.match(menu, /item\.eventAt\s*\|\|\s*item\.at/);
  assert.match(menu, /reminderInputToIso\(whenInput\.value,\s*cfg\.timeZone\)/);
});
