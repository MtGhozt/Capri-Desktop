'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { QUICK_MENU_ITEMS, SETTINGS_TABS, unionRects, placeHelpPanel } = require('../src/renderer/js/menu.js');

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

test('help panel stays inside the settings host (no clip under the tabs)', () => {
  const main = { left: 205, top: 38, right: 900, bottom: 700 };
  // "?" on the left of a row: prefer the right side, still inside main.
  const beside = placeHelpPanel({
    main,
    anchor: { left: 230, top: 520, right: 248, bottom: 538 },
    width: 360,
    height: 280,
  });
  assert.ok(beside.left >= 0);
  assert.ok(beside.left + 360 <= main.right - main.left);
  assert.ok(beside.top >= 0);
  assert.ok(beside.top + 280 <= main.bottom - main.top);

  // Narrow host: clamp instead of parking at viewport x=8 (which was negative vs main).
  const tight = placeHelpPanel({
    main: { left: 205, top: 38, right: 500, bottom: 400 },
    anchor: { left: 220, top: 200, right: 238, bottom: 218 },
    width: 360,
    height: 280,
  });
  assert.equal(tight.left, 8);
  assert.ok(tight.top >= 0);
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
  assert.match(source, /await capri\.intro\(entrance\(\)\)/);
  assert.doesNotMatch(source, /if \(config\.visible === false\) capri\.stowNow\(\)/);
  const capri = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'capri.js'), 'utf8');
  assert.match(capri, /finally \{\s*p\.alpha = 1;/);
});

test('overlay is shown when the renderer finishes loading, not only ready-to-show', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(source, /did-finish-load[\s\S]{0,300}overlay\.showInactive\(\)/);
  assert.match(source, /overlay\.loadURL\('capri:\/\/app\/src\/renderer\/index\.html'\);\s*overlay\.showInactive\(\)/);
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

test('render selector explains and marks the active mode', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /Automático \(recomendado\)/);
  assert.match(source, /OpenGL/);
  assert.match(source, /Sin GPU \(lento\)/);
  assert.match(source, /appmenu__radio/);
});

test('brain UI uses provider cards, priority controls, and per-card probe status', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /Orden en que Capri prueba los cerebros/);
  assert.match(source, /model-reorder/);
  assert.match(source, /Listo, \$\{labelOf\(id\)\} contesta/);
});

test('brain cards expose pricing groups and stable action states', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /Gratis con límite/);
  assert.match(source, /\['Gratis con límite', \['gemini', 'groq'\]\]/);
  assert.match(source, /\['De pago', \['openai', 'anthropic', 'deepseek', 'mistral', 'nvidia', 'xai'\]\]/);
  assert.match(source, /De pago/);
  assert.match(source, /appmenu__fix-save is-active.*Probar/);
  assert.match(source, /appmenu__danger.*Quitar key/);
  assert.match(source, /appmenu__card-actions/);
});

test('brain priority uses fixed right-aligned square controls', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles', 'capri.css'), 'utf8');
  assert.match(css, /\.appmenu__priority-actions/);
  assert.match(css, /\.appmenu__arrow\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;/s);
});

test('provider and agent controls keep state in their headers and hide installed commands', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  const agents = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'agent-brain.js'), 'utf8');
  assert.match(source, /appmenu__brain-card-header/);
  assert.match(source, /toggle\.disabled = needsKey && !hasKey/);
  assert.match(source, /row\.append\(toggle\);\s*if \(!item\.installed\)/);
  assert.match(agents, /Cursor Agent \(CLI\)/);
});

test('agent install rows keep the command inside the panel and expose Copiar', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles', 'capri.css'), 'utf8');
  assert.match(source, /appmenu__agent-cmd/);
  assert.match(source, /build\('button', 'appmenu__toggle-btn', 'Copiar'\)/);
  assert.match(source, /navigator\.clipboard\.writeText\(command\.value\)/);
  assert.match(source, /copy\.textContent = 'Copiado'/);
  assert.match(css, /\.appmenu__body\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(css, /\.appmenu__agent-row \.appmenu__input\s*\{[^}]*min-width:\s*0;/s);
});

test('agent rows show a name, state, and actionable hint', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /build\('span', 'appmenu__agent-name', item\.label\)/);
  assert.match(source, /Instalado · clic para activar\/apagar/);
  assert.match(source, /No instalado · copiá el comando/);
  assert.match(source, /activado/);
});

test('startup logs window, renderer, intro, and opacity state', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');
  const capri = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'capri.js'), 'utf8');
  assert.match(main, /startup window show/);
  assert.match(app, /startup renderer first render/);
  assert.match(app, /startup intro start/);
  assert.match(capri, /startup intro end/);
  assert.match(capri, /p\.alpha = 1;\s*this\.onStartupLog/);
});

test('dev startup does not force the broken OpenGL angle backend', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(source, /if \(software\) app\.disableHardwareAcceleration/);
  const render = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'render-mode.js'), 'utf8');
  assert.doesNotMatch(render, /use-angle/);
});

test('brain settings render keeps old-format configs visible', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /body\.append\(this\.brainPanel\(model, \{ build \}\)\)/);
  assert.match(source, /const model = state\.model \|\| \{/);
  assert.match(source, /No se pudo dibujar esta sección/);
});

test('renderer forwards console and window errors to the main log', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(preload, /rendererLog/);
  assert.match(source, /rendererError\('console\.error'/);
  assert.match(source, /rendererError\('window\.error'/);
  assert.match(source, /rendererError\('unhandledrejection'/);
  assert.match(main, /renderer:log/);
});

test('render mode is presented as visible radio options without duplicate active hint', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(source, /appmenu__radio/);
  assert.doesNotMatch(source, /Pantalla activa:/);
});

test('voice loading stays visible until a ready state', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');
  assert.match(source, /evt\.state === 'loading'/);
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
