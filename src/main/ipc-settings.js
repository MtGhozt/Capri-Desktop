'use strict';

// Her menus and settings: the config the renderer reads and writes, the tray menu (also the
// right-click one), her guide to the tray and Claude Code's folder, the settings window and the
// artist stills.

const path = require('node:path');
const fs = require('node:fs');
const { app, shell } = require('electron');

function registerSettingsIpc(ipcMain, deps) {

  const {
    rendererConfig,
    updateConfig,
    demoWindow,
    runHooks,
    hooks,
    rebuildTray,
    menuState,
    applyMenuAction,
    openSettingsTab,
    targetDisplay,
    userSoundsDir,
    SOUND_EXT,
    CLAUDE_CODE_HELP,
    getOverlay,
    getVoice,
    getTray,
    getTrayMenu,
    getSettingsWindow,
  } = deps;

    ipcMain.handle('config:get', () => rendererConfig());
    ipcMain.handle('hooks:status', () => hooks.status());
    ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
    ipcMain.handle('demo:window', (_e, open) => demoWindow(open));
    // right-clicking her: the same menu as the tray icon (which Windows often hides behind the ^ by the clock)
    ipcMain.on('menu:open', () => {
      if (!getTrayMenu()) rebuildTray(true);
      try {
        getTrayMenu()?.popup({ window: getOverlay() });
      } catch (err) {
        console.error('[capri] tray menu:', err.message);
      }
    });
    // her welcome panel's buttons
    ipcMain.handle('hooks:install', () => runHooks('install', { quiet: true }));
    ipcMain.handle('claude:found', () => fs.existsSync(path.dirname(hooks.status().file))); // Claude Code keeps its settings there
    ipcMain.on('claude:help', () => shell.openExternal(CLAUDE_CODE_HELP));

    // her guide: where her tray icon is (it lives in the taskbar, off the overlay, hence overlay
    // coordinates past its edge), and the corner by the clock in case Windows hid it behind the ^
    ipcMain.handle('guide:tray', () => {
      const o = getOverlay().getBounds();
      const d = targetDisplay().bounds;
      const b = getTray()?.getBounds();
      const icon = b && b.width > 0 ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : null;
      const corner = { x: d.x + d.width - 150 - o.x, y: d.y + d.height - 44 - o.y, w: 140, h: 40 };
      return { icon, corner };
    });
    // her guide: Claude Code's folder (~/.claude) in Explorer, its settings file selected
    ipcMain.handle('guide:claudeFolder', () => {
      const file = hooks.status().file;
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) return { found: false, dir };
      if (fs.existsSync(file)) shell.showItemInFolder(file);
      else shell.openPath(dir);
      return { found: true, dir, file: fs.existsSync(file) };
    });
    ipcMain.handle('menu:get', (_e, extra = {}) => {
      // Mic enumeration is async via the sidecar; never hold menu:get on it (Oído used to freeze).
      if (!extra.light) {
        setImmediate(() => { try { getVoice()?.listDevices(); } catch { /* sidecar down */ } });
      }
      const state = menuState(extra);
      structuredClone(state);
      return state;
    });
    ipcMain.handle('menu:action', async (_e, payload = {}) => {
      const result = await applyMenuAction(payload.id, payload.value);
      return result && typeof result === 'object' ? result : { ok: true };
    });
    ipcMain.on('settings:close', () => {
      if (getSettingsWindow() && !getSettingsWindow().isDestroyed()) getSettingsWindow().close();
    });
    ipcMain.handle('settings:open', (_e, tab = null) => openSettingsTab(tab || null));
    // artist handoff stills → %USERPROFILE%\Desktop\capri-art-kit\shots\
    ipcMain.handle('art:capture', async (_e, payload = {}) => {
      if (!getOverlay() || getOverlay().isDestroyed()) return { ok: false, error: 'no overlay' };
      const dir = path.join(process.env.USERPROFILE || app.getPath('home'), 'Desktop', 'capri-art-kit', 'shots');
      fs.mkdirSync(dir, { recursive: true });
      const name = String(payload.name || 'frame').replace(/[^\w.-]+/g, '_');
      const image = await getOverlay().webContents.capturePage();
      const file = path.join(dir, `${name}.png`);
      fs.writeFileSync(file, image.toPNG());
      return { ok: true, file };
    });

}

module.exports = { registerSettingsIpc };
