'use strict';

// Two voice UX fixes: a first-time model download says so instead of looking frozen, and the
// reply text is shown before the audio finishes generating.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('only a model missing from the HF cache announces a download', () => {
  const tts = read('voice', 'tts.py');
  assert.match(tts, /def model_cached\(cache_dir: Path, repo_id: str\)/);
  assert.match(tts, /models--/);
  assert.match(tts, /snapshots/);

  const server = read('voice', 'server.py');
  // OmniVoice and Whisper both gate the message on the cache check
  assert.match(server, /model_cached\(MODELS \/ "hf" \/ "hub", OMNI_MODEL\)/);
  assert.match(server, /model_cached\(root, WHISPER_REPOS\.get\(name/);
  assert.match(server, /def _set_download/);
  assert.match(server, /"state": "downloading"/);
});

test('the download message reaches the voice bar, cached loads keep saying Cargando voz', () => {
  const app = read('src', 'renderer', 'js', 'app.js');
  assert.match(app, /evt\.state === 'downloading'/);
  assert.match(app, /Descargando voz \(solo la primera vez, puede tardar varios minutos\)/);

  const bubble = read('src', 'renderer', 'js', 'bubble.js');
  assert.match(bubble, /setVoiceLoading\(on, progress = null, label = null\)/);
  assert.match(bubble, /label\s*\n?\s*\|\| \(hasProgress \? `Cargando voz/);
});

test('setup details are readable, selectable and copyable', () => {
  const menu = read('src', 'renderer', 'js', 'menu.js');
  assert.match(menu, /'Copiar detalles'/);
  assert.match(menu, /navigator\.clipboard\.writeText\(install\.lines\.join\('\\n'\)\)/);
  assert.match(menu, /copy\.textContent = 'Copiado'/);
  assert.match(menu, /copy\.textContent = 'Copiar detalles'; \}, 1600\)/);
  assert.match(menu, /clearTimeout\(copy\.resetTimer\)/);

  const css = read('src', 'renderer', 'styles', 'capri.css');
  const log = css.slice(css.indexOf('.appmenu__voice-log'), css.indexOf('.appmenu__voice-source'));
  assert.match(log, /user-select: text/);
  assert.match(log, /font-size: 12px/);
  assert.match(log, /max-height: 180px/);
});

test('the reply text is sent before TTS flush, and shown once', () => {
  const main = read('src', 'main', 'main.js');
  const chat = main.slice(main.indexOf("ipcMain.handle('chat:send'"), main.indexOf("ipcMain.on('chat:cancel'"));
  const onDone = chat.slice(chat.indexOf('onDone: (payload) => {'));
  const shown = onDone.indexOf("webContents.send('chat:done', payload)");
  const flush = onDone.indexOf('speakQueue?.flush(speakId)');
  assert.ok(shown > 0, 'chat:done is sent');
  assert.ok(flush > shown, 'audio flush comes after the text');

  const bubble = read('src', 'renderer', 'js', 'bubble.js');
  const done = bubble.slice(bubble.indexOf('onDone(text) {'), bubble.indexOf('onError(payload) {'));
  // empty string clears a streamed tool-call leak; don't fall back to replyText
  assert.match(done, /typeof text === 'string' \? text/);
  assert.doesNotMatch(done, /this\.replyText \+=/);
});
