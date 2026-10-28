'use strict';

function createSettingsWindow({ BrowserWindow, existing, url, options = {} }) {
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }
  const win = new BrowserWindow({
    width: 760,
    height: 540,
    minWidth: 680,
    minHeight: 480,
    resizable: true,
    center: true,
    show: false,
    frame: false,
    title: 'Capri · Ajustes',
    backgroundColor: '#0b0712',
    autoHideMenuBar: true,
    ...options,
  });
  win.setMenu?.(null);
  win.removeMenu?.();
  win.loadURL(url);
  win.once?.('ready-to-show', () => win.show());
  return win;
}

module.exports = { createSettingsWindow };
