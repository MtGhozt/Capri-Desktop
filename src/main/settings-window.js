'use strict';

// One Ajustes BrowserWindow: create/focus, hide on close, destroy after 1 min idle to free RAM.

const IDLE_DESTROY_MS = 60_000;

function cancelIdleDestroy(win) {
  const state = win?.__capriIdle;
  if (!state?.timer) return;
  state.clearTimeoutFn(state.timer);
  state.timer = null;
}

function scheduleIdleDestroy(win) {
  const state = win?.__capriIdle;
  if (!state || win.isDestroyed?.()) return;
  cancelIdleDestroy(win);
  state.timer = state.setTimeoutFn(() => {
    state.timer = null;
    const finish = (unsaved) => {
      if (unsaved) return;
      if (!win || win.isDestroyed?.()) return;
      if (typeof win.isVisible === 'function' && win.isVisible()) return;
      try { win.destroy(); } catch { /* already gone */ }
    };
    let result;
    try { result = state.hasUnsaved(win); } catch { result = false; }
    if (result && typeof result.then === 'function') {
      result.then((value) => finish(value)).catch(() => finish(false));
    } else {
      finish(result);
    }
  }, state.idleMs);
}

function wireIdleDestroy(win, {
  hasUnsaved = () => false,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  idleMs = IDLE_DESTROY_MS,
} = {}) {
  win.__capriIdle = {
    timer: null,
    hasUnsaved,
    setTimeoutFn,
    clearTimeoutFn,
    idleMs,
  };
  win.on?.('show', () => cancelIdleDestroy(win));
  win.on?.('hide', () => scheduleIdleDestroy(win));
  win.on?.('closed', () => cancelIdleDestroy(win));
}

function hideSettingsWindow(win) {
  if (!win || win.isDestroyed?.()) return;
  win.hide();
}

function createSettingsWindow({
  BrowserWindow,
  existing,
  url,
  options = {},
  hasUnsaved = settingsHasUnsaved,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  idleMs = IDLE_DESTROY_MS,
} = {}) {
  if (existing && !existing.isDestroyed()) {
    cancelIdleDestroy(existing);
    existing.show?.();
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
  wireIdleDestroy(win, { hasUnsaved, setTimeoutFn, clearTimeoutFn, idleMs });
  win.loadURL(url);
  win.once?.('ready-to-show', () => win.show());
  return win;
}

async function settingsHasUnsaved(win) {
  if (!win || win.isDestroyed?.()) return false;
  try {
    return Boolean(await win.webContents.executeJavaScript(
      'typeof window.capriSettingsHasUnsaved === "function" && !!window.capriSettingsHasUnsaved()',
    ));
  } catch {
    return false;
  }
}

module.exports = {
  createSettingsWindow,
  hideSettingsWindow,
  cancelIdleDestroy,
  scheduleIdleDestroy,
  wireIdleDestroy,
  settingsHasUnsaved,
  IDLE_DESTROY_MS,
};
