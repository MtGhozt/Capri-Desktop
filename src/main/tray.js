'use strict';

// Her tray icon and its menu: one row per menu action, rebuilt (debounced) when config changes.

const path = require('node:path');
const { Tray, Menu, nativeImage } = require('electron');

const config = require('./config');

function createTray(deps) {

  const {
    root,
    menuState,
    applyMenuAction,
    forceCloseMenu,
    sendCommand,
    getMenuCloseCombo,
    getTalkCombo,
    talkHotkey,
  } = deps;

  let tray = null;
  let trayMenu = null; // also what she opens when you right-click her

  let trayRebuildTimer = null;
  function rebuildTray(immediate = false) {
    if (!tray) return;
    if (!immediate) {
      if (trayRebuildTimer) clearTimeout(trayRebuildTimer);
      trayRebuildTimer = setTimeout(() => {
        trayRebuildTimer = null;
        rebuildTray(true);
      }, 300);
      return;
    }
    if (trayRebuildTimer) {
      clearTimeout(trayRebuildTimer);
      trayRebuildTimer = null;
    }
    const s = menuState();
    const t = s.labels;

    const menu = Menu.buildFromTemplate([
      { label: s.online, enabled: false },
      { type: 'separator' },
      // always there: her menu stuck open can't hold the screen
      { label: t.closeMenu, accelerator: getMenuCloseCombo() || undefined, click: () => forceCloseMenu('tray') },
      { label: t.teleport, click: () => applyMenuAction('teleport') },
      ...(!s.folded ? [
        { label: t.satellite, click: () => applyMenuAction('satellite') },
        { label: t.demo, click: () => applyMenuAction('demo') },
      ] : []),
      { label: t.help, click: () => applyMenuAction('help') },
      ...(!s.folded ? [{
        label: s.cfg.visible ? t.hide : t.show,
        accelerator: s.shortcuts.find((k) => k.id === 'toggle')?.accel || undefined,
        click: () => applyMenuAction('visible'),
      }] : []),
      s.folded
        ? { label: t.wake, click: () => applyMenuAction('wake') }
        : { label: t.sleep, click: () => applyMenuAction('sleep') },
      { type: 'separator' },
      {
        label: t.size,
        submenu: [[t.small, 0.45], [t.medium, 0.6], [t.large, 0.8]].map(([label, scale]) => ({
          label, type: 'radio', checked: Math.abs(s.cfg.scale - scale) < 0.01, click: () => applyMenuAction('scale', scale),
        })),
      },
      {
        label: t.sound,
        submenu: [
          { label: t.mute, type: 'checkbox', checked: s.cfg.muted, click: (item) => applyMenuAction('muted', item.checked) },
          { type: 'separator' },
          { label: t.reply, enabled: false },
          ...[['voice', t.replyVoice], ['blips', t.replyBlips], ['silent', t.replySilent]].map(([mode, label]) => ({
            label, type: 'radio', checked: s.cfg.replyMode === mode, click: () => applyMenuAction('reply-mode', mode),
          })),
          { type: 'separator' },
          { label: t.soundsDir, click: () => applyMenuAction('sounds-dir') },
        ],
      },
      {
        label: t.screen,
        enabled: s.displays.length > 1,
        submenu: s.displays.map((d) => ({
          label: d.label,
          type: 'radio',
          checked: d.current,
          click: () => applyMenuAction('display', d.id),
        })),
      },
      ...(!s.folded ? [{ label: t.wander, type: 'checkbox', checked: s.cfg.wander, click: (item) => applyMenuAction('wander', item.checked) }] : []),
      { label: t.possess, type: 'checkbox', checked: s.cfg.possess, click: (item) => applyMenuAction('possess', item.checked) },
      {
        label: s.cfg.mic ? t.micOn : t.micOff,
        type: 'checkbox',
        checked: s.cfg.mic,
        click: (item) => applyMenuAction('mic', item.checked),
      },
      {
        label: t.micDevice,
        submenu: [
          {
            label: t.micDefault,
            type: 'radio',
            checked: s.cfg.micDevice == null,
            click: () => applyMenuAction('mic-device', null),
          },
          ...(s.micDevices || []).map((d) => ({
            label: d.name,
            type: 'radio',
            checked: Number(s.cfg.micDevice) === Number(d.id),
            click: () => applyMenuAction('mic-device', d.id),
          })),
        ],
      },
      {
        label: t.lang,
        submenu: s.langs.map(([value, label]) => ({
          label, type: 'radio', checked: s.langSetting === value, click: () => applyMenuAction('lang', value),
        })),
      },
      {
        label: t.startup,
        type: 'checkbox',
        checked: s.login,
        click: (item) => applyMenuAction('startup', item.checked),
      },
      { type: 'separator' },
      { label: t.quit, click: () => applyMenuAction('quit') },
    ]);
    tray.setContextMenu(menu);
    trayMenu = menu;
  }

  function createTrayIcon() {
    const icon = nativeImage.createFromPath(path.join(root, 'assets', 'icons', 'tray.png'));
    tray = new Tray(icon);
    tray.setToolTip(`Capri — ${getTalkCombo() || talkHotkey(config.load())} escucha / detiene`);
    tray.on('click', () => sendCommand('status'));
    rebuildTray(true);
  }

  return {
    rebuildTray,
    createTray: createTrayIcon,
    getTray: () => tray,
    getTrayMenu: () => trayMenu,
  };
}

module.exports = { createTray };
