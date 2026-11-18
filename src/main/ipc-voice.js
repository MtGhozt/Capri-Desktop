'use strict';

// Her voice side of IPC: the boot greeting (also the one after an unlock), saying a line on
// demand, push-to-talk, and the interrupt that cuts her off. The greeting keeps its own
// cooldown so a boot plus an unlock cannot say hello twice.

const config = require('./config');
const { logEvent, voiceLogPath } = require('./log');

function registerVoiceIpc(ipcMain, deps) {
  let lastGreetingAt = 0;
  let bootGreetingDone = false;

  const GREETING_COOLDOWN_MS = 10 * 60_000;

  const {
    pickGreeting,
    speakLine,
    voiceReplyOn,
    sendCommand,
    followUp,
    turns,
    getReminders,
    getLlm,
    getVoice,
    getSpeakQueue,
  } = deps;

    // her hello at boot: the overlay shows it, and it plays from the cached wav if there is one
    async function greeting({ unlock = false } = {}) {
      // A missed reminder is this launch's greeting: never replace it with a hello.
      if (!unlock && (getReminders()?.missedCount?.() || 0) > 0) {
        logEvent(voiceLogPath(), `[capri] greeting skipped: ${getReminders().missedCount()} missed reminder(s)`);
        return { skipped: 'missed-reminders' };
      }
      const cfg = config.load();
      if (cfg.behavior?.greetings === false || (unlock && cfg.behavior?.unlockGreeting === false)) return null;
      const now = Date.now();
      if (now - lastGreetingAt < GREETING_COOLDOWN_MS) {
        logEvent(voiceLogPath(), `[capri] greeting skipped cooldown reason=${unlock ? 'unlock' : 'boot'}`);
        return null;
      }
      const picked = pickGreeting({ last: config.load().greeting?.last || null });
      config.save({ greeting: { last: picked.id } });
      lastGreetingAt = now;
      logEvent(voiceLogPath(), `[capri] greeting ${unlock ? 'unlock' : 'start'} id=${picked.id}`);
      let text = picked.text;
      if (getLlm()) {
        let generated = null;
        await new Promise((resolve) => {
          getLlm().chat({
            user: unlock ? 'Salúdame brevemente porque acabo de desbloquear la computadora.' : 'Salúdame brevemente al iniciar.',
            onToken: () => {},
            onDone: ({ text: value }) => { generated = String(value || '').trim(); resolve(); },
            onError: () => resolve(),
          });
        });
        if (generated && generated.length <= 180) text = generated;
        else logEvent(voiceLogPath(), '[capri] greeting fallback local');
      }
      if (voiceReplyOn()) speakLine(text);
      if (unlock) sendCommand('line', { badge: 'ONLINE', text });
      return { ...picked, text };
    }
    ipcMain.handle('capri:speak', (_e, text) => {
      speakLine(String(text || ''));
      return { ok: true };
    });
    ipcMain.handle('greet', async () => {
      if (bootGreetingDone) return null;
      bootGreetingDone = true;
      return greeting();
    });

    ipcMain.on('voice:interrupt', () => {
      getLlm()?.cancel();
      getSpeakQueue()?.stop();
      followUp.cancel();
      turns.cancelAll();
      getVoice()?.pttStart();
    });
    ipcMain.on('voice:ptt-start', () => { getVoice()?.pttStart(); });
    ipcMain.on('voice:ptt-stop', () => { getVoice()?.pttStop(); });

  return { greeting };
}

module.exports = { registerVoiceIpc };
