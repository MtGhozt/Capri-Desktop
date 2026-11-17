import { AppMenu, SETTINGS_TABS } from './menu.js';

const root = document.querySelector('#settings');
const close = () => window.host.closeSettings();
document.querySelector('#settings-close').addEventListener('click', close);
document.querySelector('#settings-close-bottom').addEventListener('click', close);
const nav = document.createElement('nav');
nav.className = 'settings__tabs';
const content = document.createElement('section');
content.className = 'settings__content';
const menuEl = document.createElement('div');
menuEl.className = 'appmenu appmenu--settings';
menuEl.hidden = false;
content.append(menuEl);
root.append(nav, content);

const menu = new AppMenu({ el: menuEl, host: window.host, folded: () => false });
menu.settingsMode = true;
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    menu.onEscape();
  }
});
for (const tab of SETTINGS_TABS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = tab.label;
  button.addEventListener('click', () => {
    menu.settingsSection = tab.id;
    menu.view = tab.id === 'apps' ? 'apps' : 'main';
    nav.querySelector('.is-active')?.classList.remove('is-active');
    button.classList.add('is-active');
    menu.render(menu.lastState);
  });
  nav.append(button);
}
nav.firstElementChild.classList.add('is-active');

menu.open = true;
// Until getMenu lands: never leave the panel blank (reuse appmenu body/hint styles).
const loadingPlate = document.createElement('div');
loadingPlate.className = 'appmenu__plate';
const loadingBody = document.createElement('div');
loadingBody.className = 'appmenu__body';
const loading = document.createElement('div');
loading.className = 'appmenu__hint';
loading.textContent = 'Cargando…';
loadingBody.append(loading);
loadingPlate.append(loadingBody);
menuEl.append(loadingPlate);

let pendingHint = '';
window.addEventListener('capri-settings-tab', (event) => {
  const tab = SETTINGS_TABS.find((item) => item.id === event.detail);
  if (!tab) return;
  const button = [...nav.children].find((item) => item.textContent === tab.label);
  button?.click();
});
window.addEventListener('capri-setup-hint', (event) => {
  pendingHint = String(event.detail || '');
  menu.modelNote = pendingHint;
  menu.expanded = 'model';
  menu.settingsSection = 'model';
  if (menu.lastState) menu.render(menu.lastState);
});

function applyState(state) {
  document.documentElement.dataset.theme = state.cfg.theme;
  // Same about.version as Acerca de (menu:get → app.getVersion())
  const ver = String(state?.about?.version || '').replace(/^v/i, '').trim();
  const verEl = document.querySelector('.settings__ver');
  if (verEl && ver) {
    verEl.textContent = `v${ver}`;
    verEl.hidden = false;
  }
  if (pendingHint) {
    menu.modelNote = pendingHint;
    menu.expanded = 'model';
    menu.settingsSection = 'model';
    nav.querySelector('.is-active')?.classList.remove('is-active');
    [...nav.children].find((item) => item.textContent === 'Cerebro')?.classList.add('is-active');
  }
  menu.render(state);
}

console.time('settings:load');
// Fast paint (light): skip PATH agent scans / apps / found. Then full getMenu fills Oído devices.
Promise.all([
  document.fonts.load('500 14px Rajdhani'),
  document.fonts.load('600 14px Rajdhani'),
  document.fonts.load('400 11px JetBrains'),
  window.host.getMenu({ folded: false, light: true }),
]).then(async ([, , , light]) => {
  console.timeEnd('settings:load');
  applyState(light);
  try {
    const full = await window.host.getMenu({ folded: false, light: false });
    applyState(full);
  } catch (err) {
    console.error('[capri] settings full refresh failed', err);
  }
}).catch((err) => {
  console.error('[capri] settings load failed', err);
  loading.textContent = 'No pude cargar los ajustes.';
});
