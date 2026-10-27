'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('host', {
  onClaudeEvent: on('claude:event'),
  onCommand: on('capri:command'),
  onConfig: on('capri:config'),
  onResize: on('overlay:resize'),
  onWindows: on('windows:update'),
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', Boolean(on)),
  rearm: () => ipcRenderer.send('overlay:rearm'),
  appFxHit: (id) => ipcRenderer.send('appfx:hit', Number(id)),
  cursor: () => ipcRenderer.invoke('overlay:cursor'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  hooksStatus: () => ipcRenderer.invoke('hooks:status'),
  demoWindow: (open) => ipcRenderer.invoke('demo:window', Boolean(open)),
  openMenu: () => ipcRenderer.send('menu:open'),
  installHooks: () => ipcRenderer.invoke('hooks:install'),
  claudeFound: () => ipcRenderer.invoke('claude:found'),
  openClaudeHelp: () => ipcRenderer.send('claude:help'),
  windowsNow: () => ipcRenderer.invoke('windows:get'),
  trayPlace: () => ipcRenderer.invoke('guide:tray'),
  openClaudeFolder: () => ipcRenderer.invoke('guide:claudeFolder'),
  sendChat: (text) => ipcRenderer.invoke('chat:send', text),
  cancelChat: () => ipcRenderer.send('chat:cancel'),
  closeChat: () => ipcRenderer.send('chat:close'),
  onChatToken: on('chat:token'),
  onChatDone: on('chat:done'),
  onChatError: on('chat:error'),
  onLlmBoot: on('llm:boot'),
  onVoice: on('voice:event'),
  interruptVoice: () => ipcRenderer.send('voice:interrupt'),
  llmStatus: () => ipcRenderer.invoke('llm:status'),
  getMenu: (opts) => ipcRenderer.invoke('menu:get', opts || {}),
  setFolded: (on) => ipcRenderer.send('overlay:folded', Boolean(on)),
  menuAction: (payload) => ipcRenderer.invoke('menu:action', payload),
  greet: () => ipcRenderer.invoke('greet'),
});
