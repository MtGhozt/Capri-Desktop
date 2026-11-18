'use strict';

// One turn: what you typed or said, from the first direct-command check to her reply. Direct
// orders never reach the model; the rest goes to whatever brain is selected, with the screen
// look, the weather fallback and the speech queue wired in. Cancelling is a whole turn.

const config = require('./config');
const state = require('./state');
const { enterTurn } = require('./timing');
const { isLookCommand } = require('./screen-look');
const { planMultiCommand, coalesceWindowRuns } = require('./multi-command');
const { isDirectCommand } = require('./direct-match');
const { isSleepCommand } = require('./sleep-command');
const { isQuitCommand } = require('./quit-command');
const { isClipCommand } = require('./clip-command');
const { isMuteCommand, isUnmuteCommand } = require('./mic-command');
const { isForgetCommand } = require('./forget-command');
const { isStopTtsCommand } = require('./stop-tts-command');
const { parseNameCommand } = require('./name-command');
const { isWhatsNewCommand } = require('./whats-new');
const { isWakeCommand } = require('./wake-command');
const { parseMusicCommand } = require('./music-command');
const { parsePcCommand, filterReplySnip } = require('./pc-actions');
const { parseFixCommand } = require('./fix-command');
const { readsAsReminderRequest, promisesReminder, parseReminderCommand } = require('./reminders');
const { isWeatherOrHolidayQuestion } = require('./weather');
const { logEvent, voiceLogPath } = require('./log');
const pcActions = require('./pc-actions');
const { usesLms } = require('./chat-providers');

function createTurn(deps) {

  const {
    turns,
    quitFlow,
    announce,
    showLine,
    followUp,
    appReply,
    apps,
    allApps,
    answerQuit,
    askQuit,
    goFixReply,
    goNameReply,
    goWhatsNewReply,
    goReminderReply,
    goSleepReply,
    goWakeReply,
    goClipReply,
    goMicReply,
    goForgetReply,
    pcReply,
    musicReply,
    runReplyAction,
    sayWithoutLlm,
    snapScreenForLook,
    weatherFallbackLine,
    startSpeakTurn,
    resetOverlayInput,
    getSystemFlow,
    getSpeakQueue,
    getLlm,
    getLms,
    getOverlay,
  } = deps;

  // The direct-command ladder, from a chat/voice line to her reply: null when it's for the model.
  // Shared by chat:send and the splitter, so every part of "minimiza todo y ve a dormir" runs the
  // same detectors as when it is said alone.
  async function directCommand(line) {
    const fixOrder = parseFixCommand(line);
    if (fixOrder) {
      const done = goFixReply(fixOrder);
      if (done.line) return done; // a fix that can't be saved (too long) goes to the model
    }
    const newName = parseNameCommand(line);
    if (newName) return goNameReply(newName);
    if (isWhatsNewCommand(line)) return goWhatsNewReply();
    const powerOrder = await getSystemFlow().command(line);
    if (powerOrder) return { ok: true };
    const reminderOrder = parseReminderCommand(line, { timeZone: config.load().timeZone });
    if (reminderOrder) return goReminderReply(reminderOrder) || { ok: true };
    // stop speaking before system mute ("callate" ≠ silencio)
    if (isStopTtsCommand(line)) {
      getSpeakQueue()?.stop();
      followUp.cancel();
      return { ok: true, line: announce('Callada.', { chat: true, badge: 'CAPRI' }) };
    }
    // Weather/holiday questions go to the LLM with facts in temporalExtras; answerDirect is fallback only.
    // PC mute/theme/volume/snip/window before music so "silencio" / "poné modo oscuro" are not music.
    const pcOrder = parsePcCommand(line, { apps: allApps() });
    if (pcOrder) return pcReply(pcOrder);
    const musicOrder = parseMusicCommand(line, {
      herSong: config.load().music?.herSong,
      apps: allApps(),
    });
    if (musicOrder) return musicReply(musicOrder);
    if (isSleepCommand(line)) return goSleepReply();
    if (quitFlow.pending) return answerQuit(line);
    if (isQuitCommand(line)) return askQuit({ chat: true });
    if (isClipCommand(line)) return goClipReply();
    if (isMuteCommand(line)) return goMicReply(false);
    if (isUnmuteCommand(line)) return goMicReply(true);
    if (isForgetCommand(line)) return goForgetReply();
    // typing to her while she's DORMANT (or asking her to wake) brings her back, no model needed
    if (state.overlayFolded || isWakeCommand(line)) return goWakeReply();
    const appOrder = await apps().command(line); // "abre Discord", "cierra Spotify"
    if (appOrder) return appReply(appOrder);
    return null;
  }

  // Every part already checked as direct: run them in order, unless one asks first ("¿seguro?") —
  // then the rest waits for the answer instead of firing blind.
  // Consecutive window snaps merge into one snapWindows so TTS hears a single combined line.
  async function runDirectSegments(segments) {
    let last = { ok: true };
    const appsList = allApps();
    const runs = coalesceWindowRuns(segments, (part) => parsePcCommand(part, { apps: appsList }));
    for (const run of runs) {
      const result = run.kind === 'window'
        ? await pcReply({ kind: 'window', value: run.value, snaps: run.snaps })
        : await directCommand(run.text);
      if (!result) break;
      last = result;
      if (getSystemFlow().pending || getSystemFlow().running || quitFlow.pending || apps().confirm.pending) break;
    }
    return last;
  }

    async function send(text, meta) {
      const line = String(text || '').trim();
      if (!line || !getOverlay()) return { ok: false };
      const info = meta && typeof meta === 'object' ? meta : null;
      const turn = turns.begin(info?.src === 'voice' ? 'voice' : 'text', info?.turn, info?.stt);
      enterTurn(turn);
      const endDirect = (value) => {
        turns.noteNoLlm(turn);
        return value;
      };
      // her "¿seguro que apago la compu?" waiting for this answer (Paso 4G)
      const powerAnswer = await getSystemFlow().answer(line);
      if (powerAnswer) return endDirect({ ok: true });
      // her "¿quisiste decir…?" / "¿seguro?" waiting for this answer (Paso 4C)
      const answered = await apps().answer(line);
      if (answered) return endDirect(appReply(answered));
      // several orders in one breath: only when every part is already direct, and sleep last.
      // A mixed line ("saluda y duerme") goes to the model whole: no partial execution.
      // While she's DORMANT any message wakes her first, as it always did.
      const segments = quitFlow.pending || state.overlayFolded
        ? null
        : planMultiCommand(line, (part) => isDirectCommand(part, allApps()));
      if (segments) return endDirect(await runDirectSegments(segments));
      const direct = await directCommand(line);
      if (direct) return endDirect(direct);
      // Phase 6C: "mirá mi pantalla" → JPEG in memory when shareScreen is on and the brain can see.
      let lookImage = null;
      let didLook = false;
      try {
        if (isLookCommand(line)) {
          didLook = true;
          const cfgLook = config.load();
          if (!cfgLook.llm?.shareScreen) {
            sayWithoutLlm('Activá «Enviar mi pantalla cuando le pida mirar» en Cerebro y pedímelo de nuevo.');
            return endDirect({ ok: true });
          }
          lookImage = await snapScreenForLook();
          if (!lookImage) {
            sayWithoutLlm('No puedo ver juegos en pantalla completa, ponelo en modo ventana sin bordes.');
            return endDirect({ ok: true });
          }
        }
        // the local stack is only waited for when LM Studio is the one who answers: an agent CLI or
        // Ollama run on their own, and LM Studio may not even be installed
        if (usesLms(config.load().llm?.provider)) {
          const boot = await getLms().whenReady();
          if (boot === 'failed') {
            const weatherLine = await weatherFallbackLine(line);
            if (weatherLine) {
              return endDirect({ ok: true, line: announce(weatherLine, { chat: true, badge: 'CLIMA' }) });
            }
            getOverlay().webContents.send('chat:error', { kind: 'offline', text: 'No pude despertar LM Studio. Revisa que esté instalado y vuelve a intentarlo.' });
            return endDirect({ ok: false });
          }
        }
        const speakId = startSpeakTurn();
        if (!speakId) getSpeakQueue()?.stop();
        state.llmBusy = true;
        let said = '';
        let outcome = null;
        const reminderAsked = readsAsReminderRequest(line);
        const mayWeatherFallback = isWeatherOrHolidayQuestion(line);
        try {
          outcome = await getLlm().chat({
            user: line,
            image: lookImage,
            onTiming: (ev) => {
              if (ev?.phase === 'request') turns.noteSend(turn);
            },
            onMood: (name) => getSpeakQueue()?.setMood?.(name),
            onToken: (piece) => {
              said += typeof piece === 'string' ? piece : piece?.text || '';
              getOverlay()?.webContents.send('chat:token', piece);
              if (speakId) getSpeakQueue()?.feed(piece);
            },
            onDone: (payload) => {
              // the text first: on a weak GPU the voice can take many seconds, and the bubble is not
              // allowed to look ignored while the audio is generated.
              getOverlay()?.webContents.send('chat:done', payload);
              followUp.reply(payload?.text || said, { spoken: Boolean(speakId && !payload?.toolLeak) });
              if (payload?.toolLeakUnknown && payload.toolLeak) {
                // logEvent already runs redactSecrets
                logEvent(voiceLogPath(), `[capri] tool-call leak: ${payload.toolLeak}`);
              }
              if (payload?.action) {
                const action = filterReplySnip(payload.action, line);
                if (action) void runReplyAction(action);
                else if (payload.action.kind === 'snip') {
                  logEvent(voiceLogPath(), '[capri] snip dropped: user did not ask to snip');
                }
              } else if (reminderAsked && promisesReminder(payload?.text || said)) {
                // no [remind:...] tag means nothing was saved: say it instead of letting her promise stand
                showLine('No quedó agendado ningún recordatorio: repetímelo con la hora.', {
                  chat: true, badge: 'RECORDATORIO',
                });
              }
              if (speakId) {
                if (payload?.toolLeak) {
                  // drop any leaked JSON already fed; speak only the friendly unknown line
                  getSpeakQueue()?.stop(speakId);
                  if (payload.text) {
                    const id = startSpeakTurn();
                    if (id) {
                      getSpeakQueue().feed(payload.text);
                      getSpeakQueue().flush(id);
                    }
                  }
                } else {
                  if (payload?.mood) getSpeakQueue()?.setMood?.(payload.mood);
                  getSpeakQueue()?.flush(speakId);
                }
              }
            },
            onError: (payload) => {
              if (speakId) getSpeakQueue()?.stop(speakId);
              turns.settleAudio(turn);
              followUp.reply('', {});
              // Weather/holiday: suppress chat:error; fallback line is shown below instead.
              if (!mayWeatherFallback) getOverlay()?.webContents.send('chat:error', payload);
            },
          });
        } finally {
          const hadImage = Boolean(lookImage);
          state.llmBusy = false;
          lookImage = null; // drop the JPEG; never written to disk
          // who answered and how it went, with no key and no text of the answer (Paso 4K)
          if (outcome) logEvent(voiceLogPath(), `[capri] llm ${outcome.provider}/${outcome.model} ${outcome.outcome} image=${hadImage}: ${outcome.ms}ms`);
        }
        const finishLlm = (value) => {
          if (outcome) turns.noteLlm(turn, outcome);
          else turns.cancel(turn);
          return value;
        };
        if (outcome?.outcome === 'failed') {
          const weatherLine = await weatherFallbackLine(line);
          if (weatherLine) {
            return finishLlm({ ok: true, line: announce(weatherLine, { chat: true, badge: 'CLIMA' }) });
          }
          if (mayWeatherFallback) {
            getOverlay()?.webContents.send('chat:error', { kind: 'offline', text: 'No pude consultar el clima ahora.' });
          }
        }
        return finishLlm({ ok: true });
      } catch (err) {
        logEvent(voiceLogPath(), `[capri] chat failed: ${err?.message || err}`);
        const weatherLine = await weatherFallbackLine(line);
        if (weatherLine) {
          const value = { ok: true, line: announce(weatherLine, { chat: true, badge: 'CLIMA' }) };
          turns.noteNoLlm(turn);
          return value;
        }
        turns.cancel(turn);
        resetOverlayInput('chat-error');
        return { ok: false };
      } finally {
        if (didLook) resetOverlayInput('look-done');
      }
    }

  // chat:cancel: she stops talking and the turn is dropped
  function cancel() {
    getLlm()?.cancel();
    getSpeakQueue()?.stop();
    followUp.cancel();
    turns.cancelAll();
    resetOverlayInput('chat-cancel');
  }

  return { send, cancel };
}

module.exports = { createTurn };
