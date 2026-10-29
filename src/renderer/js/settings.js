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
window.host.getMenu({ folded: false }).then((state) => {
  document.documentElement.dataset.theme = state.cfg.theme;
  if (pendingHint) {
    menu.modelNote = pendingHint;
    menu.expanded = 'model';
    menu.settingsSection = 'model';
    nav.querySelector('.is-active')?.classList.remove('is-active');
    [...nav.children].find((item) => item.textContent === 'Modelo y clave')?.classList.add('is-active');
  }
  menu.render(state);
}).catch((err) => {
  console.error('[capri] settings load failed', err);
});
