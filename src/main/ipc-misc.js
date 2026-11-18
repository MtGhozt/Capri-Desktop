'use strict';

// The leftover IPC that is not overlay, settings or voice: chat turn send/cancel, local LLM
// status, the system FX done ping, and the list of custom user sounds.

const fs = require('node:fs');

const config = require('./config');
const { isCloud } = require('./chat-providers');

function registerMiscIpc(ipcMain, deps) {
  const {
    turn,
    systemFxWaiters,
    userSoundsDir,
    SOUND_EXT,
    getLms,
  } = deps;

  ipcMain.handle('chat:send', async (_e, text, meta) => turn.send(text, meta));
  ipcMain.on('chat:cancel', () => turn.cancel());
  ipcMain.handle('llm:status', () => (
    isCloud(config.load().llm?.provider) ? 'ready' : getLms()?.status() || 'ready'
  ));
  ipcMain.on('systemfx:done', (_e, id) => systemFxWaiters.get(Number(id))?.());
  ipcMain.handle('sounds:list', () => {
    try {
      return fs.readdirSync(userSoundsDir())
        .filter((f) => SOUND_EXT.test(f))
        .map((f) => ({ name: f.replace(SOUND_EXT, '').toLowerCase(), url: `capri://usersounds/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });
}

module.exports = { registerMiscIpc };
