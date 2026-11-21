'use strict';

// What she answers when an order is recognized: PC and music lines, sleep/wake, her name, the
// clip, her hearing fixes, and timers. No model here: every function takes the parsed order and
// says the line itself. The turn pipeline and the IPC handlers call into this.

const { app, shell } = require('electron');

const config = require('./config');
const state = require('./state');
const pcActions = require('./pc-actions');
const { pickLine, fillLine } = require('./lines-es');
const { notesFor } = require('./whats-new');
const { parseMusicCommand } = require('./music-command');
const { logEvent, voiceLogPath } = require('./log');
const { saveClip } = require('./clips');
const { hasNvidiaGpu } = require('./voice-install');
const { addFix, removeFix, cleanFixes } = require('./fixes');
const {
  formatWhen, normalizeTimeFormat, resolveFireAt, durationText, parseMoveTarget, findMatches, calendarUrl,
} = require('./reminders');
const { isWeatherOrHolidayQuestion } = require('./weather');

function createReplies(deps) {

  const {
    announce,
    showLine,
    commandReply,
    speakLine,
    followUp,
    goodnight,
    sendCommand,
    updateConfig,
    apps,
    allApps,
    askQuit,
    saveFix,
    dropFix,
    getMusic,
    getSystemFlow,
    getReminders,
    getWeather,
    getSettingsWindow,
    getLlm,
  } = deps;

  const MUSIC_LINE = {
    pause: 'musicaPausa',
    play: 'musicaPlay',
    next: 'musicaSiguiente',
    previous: 'musicaAnterior',
    volumeUp: 'musicaVolumen',
    volumeDown: 'musicaVolumen',
    mute: 'musicaMute',
    unmute: 'musicaMute',
    start: 'musicaInicio',
    query: 'musicaPlay',
  };

  async function pcReply(action, { chat = true } = {}) {
    try {
      const result = await pcActions.run(action, {
        openExternal: (url) => shell.openExternal(url),
        apps: allApps(),
      });
      const tag = `${action.kind}:${action.value || ''}`;
      logEvent(voiceLogPath(), `[capri] pc ${tag} ${result?.ok ? 'ok' : `failed: ${result?.line || '?'}`}`);
      // window: always one combined line after every snap (partial fail still spoken)
      if (action.kind === 'window') {
        const line = result?.line || 'No pude mover la ventana.';
        announce(line, { chat, badge: 'PC' });
        return { ok: !!result?.ok };
      }
      if (!result?.ok) {
        showLine(result?.line || 'No pude hacer eso en la PC.', { chat, badge: 'PC' });
        return { ok: false };
      }
      let line = 'Listo.';
      if (action.kind === 'snip') line = 'Listo, recortá lo que quieras.';
      else if (action.kind === 'files' && result.line) line = result.line;
      else if (action.kind === 'theme') line = action.value === 'dark' ? 'Modo oscuro.' : 'Modo claro.';
      else if (action.kind === 'volume' && (action.value === 'mute' || action.value === 'unmute')) {
        line = pickLine('musicaMute');
      } else if (action.kind === 'volume') {
        line = pickLine('musicaVolumen');
      }
      announce(line, { chat, badge: 'PC' });
      return { ok: true };
    } catch (err) {
      logEvent(voiceLogPath(), `[capri] pc ${action.kind} failed: ${err.message}`);
      showLine('No pude hacer eso en la PC.', { chat, badge: 'PC' });
      return { ok: false };
    }
  }

  async function musicReply(parsed, { chat = true } = {}) {
    try {
      const result = await getMusic().command(parsed);
      logEvent(voiceLogPath(), `[capri] music ${parsed.action} ${result?.ok ? 'ok' : `failed: ${result?.error || '?'}`}`);
      if (!result?.ok) {
        const miss = parsed.action === 'query' && parsed.query
          ? `No encontré «${parsed.query}».`
          : (result?.error || 'No pude hacer eso con la música.');
        showLine(miss, { chat, badge: 'MUSIC' });
        return { ok: false };
      }
      let line;
      if (parsed.action === 'open') {
        line = `Abro ${result.player === 'spotify' ? 'Spotify' : result.player === 'youtube' ? 'YouTube Music' : 'Namida'}.`;
      } else if (parsed.herSong) {
        line = pickLine('musicaSuCancion');
      } else if (result.searchOnly) {
        line = result.player === 'youtube'
          ? `Abrí la búsqueda de «${result.query}» en YouTube Music — dale play al primero, choom.`
          : `Abrí la búsqueda de «${result.query}» en Spotify — dale play al primero, choom.`
            + (result.notConnected ? ' Conectá Spotify en MÚSICA para que le dé play.' : '');
      } else if (result.opened) {
        line = result.artist
          ? `Abrí «${result.track}» de ${result.artist} en Spotify — dale play.`
          : `Abrí «${result.track}» en Spotify — dale play.`;
      } else if (result.freeHint || result.via === 'media-keys') {
        line = 'Spotify free no me deja el play por API, choom — te mandé la tecla de medios. Si sigue quieto, dale play tú.'
          + (result.notConnected ? ' Conectá Spotify en MÚSICA para que le dé play.' : '');
      } else if (parsed.action === 'query' && result.track) {
        line = result.artist
          ? `Va, pongo «${result.track}» de ${result.artist}.`
          : `Va, pongo «${result.track}».`;
      } else if (result?.track) {
        line = `Está sonando «${result.track}» de ${result.artist}.`;
      } else {
        line = pickLine(MUSIC_LINE[parsed.action] || 'musicaPlay');
      }
      sendCommand('box-log', { kind: 'musica', text: parsed.action });
      sendCommand('music-state', { playing: !['pause', 'mute', 'volumeDown', 'volumeUp', 'open'].includes(parsed.action) });
      announce(line, { chat, badge: 'MUSIC' });
      return { ok: true };
    } catch (err) {
      console.error('[capri] music command failed:', err.message);
      logEvent(voiceLogPath(), `[capri] music ${parsed.action} failed: ${err.message}`);
      showLine('No pude controlar la música.', { chat, badge: 'MUSIC' });
      return { ok: false };
    }
  }

  // Hidden [open:<app>] / [play:<query>] tag on her reply: the same paths a typed order takes,
  // without her generic "opening X" line (she already answered in her own words). The closed list
  // of every other action lives in mood-tag.js; nothing here runs anything else.
  const REPLY_MUSIC = {
    pause: 'pause',
    play: 'play',
    next: 'next',
    previous: 'previous',
    up: 'volumeUp',
    down: 'volumeDown',
    mute: 'mute',
    unmute: 'unmute',
    nowplaying: 'nowPlaying',
    open: 'open',
    start: 'start',
  };

  async function runReplyAction(action) {
    const value = String(action?.value || '').trim();
    const kind = String(action?.kind || '').toLowerCase();
    try {
      if (kind === 'open') {
        if (!value) return;
        const result = await apps().command(`abre ${value}`);
        if (result && result.ok === false) showLine(result.line, { chat: true, badge: 'APPS' });
        return;
      }
      if (kind === 'play') {
        if (!value) return;
        const parsed = parseMusicCommand(action.herSong ? 'tu canción' : `pon ${value}`, {
          herSong: config.load().music?.herSong,
        });
        if (!parsed) return;
        const result = await getMusic().command(parsed);
        if (!result?.ok) showLine(result?.error || 'No pude poner esa música.', { chat: true, badge: 'MUSIC' });
        return;
      }
      if (kind === 'remind') {
        const at = Date.parse(String(action?.at || ''));
        if (!Number.isFinite(at)) return;
        // she already answered in her own words: the resolved time is shown, not spoken over her
        goReminderCreate({
          at,
          text: value,
          noticeMin: Number(action?.noticeMin) || 0,
        }, { chat: true, say: false });
        return;
      }
      if (kind === 'sleep') return goSleepReply({ chat: false });
      if (kind === 'wake') return goWakeReply({ chat: false });
      if (kind === 'minimize') return await getSystemFlow().command('minimiza todo');
      if (kind === 'lock') return await getSystemFlow().command('bloquea la pc');
      if (kind === 'mic') return goMicReply(value === 'on', { chat: false });
      if (kind === 'forget') return goForgetReply({ chat: false });
      if (kind === 'clip') return goClipReply({ chat: false });
      if (kind === 'quit') return askQuit({ chat: true });
      if (kind === 'music') {
        const parsed = REPLY_MUSIC[value];
        if (!parsed) return;
        const result = await getMusic().command({ action: parsed });
        if (!result?.ok) showLine(result?.error || 'No pude hacer eso con la música.', { chat: true, badge: 'MUSIC' });
        return;
      }
      if (kind === 'volume' || kind === 'settings' || kind === 'theme' || kind === 'snip' || kind === 'window' || kind === 'files') {
        const result = await pcActions.run(
          (kind === 'window' || kind === 'files') ? action : { kind, value },
          { openExternal: (url) => shell.openExternal(url), apps: allApps() },
        );
        logEvent(
          voiceLogPath(),
          `[capri] pc ${kind}:${value || ''} ${result?.ok ? 'ok' : `failed: ${result?.line || '?'}`}`,
        );
        // she already answered in character; only a friendly line when the PC action failed
        // (files list is spoken by her tag reply; show the list if she omitted details)
        if (result?.ok === false && result.line) {
          showLine(result.line, { chat: true, badge: 'PC' });
        } else if (kind === 'files' && result?.ok && result.hits?.length > 1 && result.line) {
          showLine(result.line, { chat: true, badge: 'PC' });
        }
      }
      // [info:…] is allowlisted for the prompt/parser; facts for answers come via turnExtras.contextSnippet
    } catch (err) {
      logEvent(voiceLogPath(), `[capri] reply action ${kind} failed: ${err.message}`);
    }
  }

  function goSleepReply({ chat = true } = {}) {
    const line = pickLine('dormir');
    const spoken = Boolean(speakLine(line));
    followUp.reply('', {}); // off to sleep: no listening for an answer
    showLine(line, { chat, badge: 'SLEEP' });
    goodnight.start({ spoken, line }); // folds once she has said it
    return { ok: true };
  }

  function goWakeReply({ chat = true } = {}) {
    goodnight.cancel();
    commandReply('despertar', { chat, badge: 'WAKE' });
    sendCommand('wake');
    return { ok: true };
  }

  function goForgetReply({ chat = true } = {}) {
    getLlm().reset();
    commandReply('olvidar', { chat, badge: 'MEM' });
    return { ok: true };
  }

  // "llamame Mati" / the name field in Ajustes › Comportamiento
  function goNameReply(name, { chat = true } = {}) {
    updateConfig({ userName: name });
    return { ok: true, line: announce(fillLine(pickLine('nombre'), { nombre: name }), { chat, badge: 'NOMBRE' }) };
  }

  // "¿qué hay de nuevo?": the current version's lines, no model
  function goWhatsNewReply({ chat = true } = {}) {
    const lines = notesFor(app.getVersion());
    return {
      ok: true,
      line: lines
        ? announce(lines.join(' '), { chat, badge: 'NUEVO' })
        : commandReply('sinNovedades', { chat, badge: 'NUEVO' }),
    };
  }

  function goMicReply(on, { chat = true } = {}) {
    updateConfig({ voice: { enabled: Boolean(on) } });
    commandReply(on ? 'unmute' : 'mute', { chat, badge: 'MIC' });
    return { ok: true };
  }

  const GAME_BAR_CLIP_HOTKEY = 'Win+Alt+G';

  function clipFailLine(error) {
    if (!hasNvidiaGpu()) {
      return `No pude disparar Xbox Game Bar (Win+Alt+G). Activá la grabación en segundo plano en Windows.${error ? ` (${error})` : ''}`;
    }
    return `No pude disparar el atajo del clip. Revisá NVIDIA o el atajo en config.${error ? ` (${error})` : ''}`;
  }

  function goFixReply(order, { chat = true } = {}) {
    const opts = { chat, badge: 'OÍDO' };
    if (order.action === 'remove') {
      const { removed } = dropFix(order.heard);
      const heard = removed?.heard || order.heard;
      return { ok: Boolean(removed), line: announce(fillLine(pickLine(removed ? 'olvidarCorreccion' : 'sinCorreccion'), { heard }), opts) };
    }
    const { fix, updated } = saveFix(order.heard, order.meant);
    if (!fix) return { ok: false };
    return { ok: true, line: announce(fillLine(pickLine(updated ? 'corregirOtraVez' : 'corregir'), fix), opts) };
  }

  async function goClipReply({ chat = true } = {}) {
    const cfg = config.load();
    const hotkey = hasNvidiaGpu()
      ? (cfg.clips?.saveHotkey || 'Alt+F10')
      : GAME_BAR_CLIP_HOTKEY;
    const result = await saveClip(hotkey);
    if (result.ok) commandReply('clip', { chat, badge: 'CLIP' });
    else announce(clipFailLine(result.error), { chat, badge: 'CLIP' });
    return { ok: result.ok };
  }

  // -- timers and reminders -------------------------------------------------------------------
  // Direct "timer 10 minutos", or her hidden [remind:<ISO>|<text>] tag for real dates. The file lives
  // next to config.json; reminders.js checks it every few seconds, so a long wait is just data.

  function reminderWhen(at) {
    const cfg = config.load();
    return formatWhen(at, {
      timeZone: cfg.timeZone,
      timeFormat: normalizeTimeFormat(cfg.timeFormat),
    });
  }

  // Event clock first; when there is advance notice, also name the fire time.
  function reminderLabel(item) {
    const fireAt = Number(item?.at);
    const eventAt = Number(item?.eventAt);
    const noticeMin = Number(item?.noticeMin) || 0;
    if (Number.isFinite(eventAt) && noticeMin > 0 && eventAt !== fireAt) {
      return `${reminderWhen(eventAt)} · aviso ${reminderWhen(fireAt)}`;
    }
    return reminderWhen(Number.isFinite(eventAt) ? eventAt : fireAt);
  }

  function applyReminderEventMove(item, eventAt) {
    const noticeMin = Number(item?.noticeMin) || 0;
    if (Number.isFinite(Number(item?.eventAt)) && noticeMin > 0) {
      const resolved = resolveFireAt(eventAt, noticeMin);
      if (!resolved) return null;
      return getReminders()?.update?.(item.id, {
        eventAt: resolved.eventAt,
        at: resolved.at,
        noticeMin,
      });
    }
    return getReminders()?.update?.(item.id, { at: eventAt });
  }

  function refreshSettingsMenu() {
    if (!getSettingsWindow() || getSettingsWindow().isDestroyed()) return;
    try { getSettingsWindow().webContents.send('settings:refresh'); } catch { /* closed */ }
  }

  async function weatherFallbackLine(line) {
    if (!getWeather() || !isWeatherOrHolidayQuestion(line)) return null;
    try {
      return await getWeather().answerDirect(line, {
        place: config.load().weatherPlace,
        timeZone: config.load().timeZone,
      });
    } catch {
      return null;
    }
  }

  function goReminderCreate(order, { chat = true, say = true } = {}) {
    const noticeMin = Math.max(0, Number(order.noticeMin) || 0);
    const eventAt = Number(order.eventAt) || Number(order.at);
    const resolved = noticeMin > 0 ? resolveFireAt(eventAt, noticeMin) : { at: Number(order.at), eventAt, noticeMin: 0 };
    if (!resolved || !Number.isFinite(resolved.at)) {
      const line = 'No entendí a qué hora te lo recuerdo.';
      showLine(line, { chat, badge: 'RECORDATORIO' });
      return { ok: false, line };
    }
    const created = getReminders()?.add({
      at: resolved.at,
      text: order.text,
      fixed: !order.minutes,
      eventAt: noticeMin > 0 ? resolved.eventAt : undefined,
      noticeMin: noticeMin > 0 ? noticeMin : undefined,
    });
    if (!created) {
      const line = 'No entendí a qué hora te lo recuerdo.';
      showLine(line, { chat, badge: 'RECORDATORIO' });
      return { ok: false, line };
    }
    let line = fillLine(pickLine('recordatorioListo'), { when: reminderLabel(created) });
    if (noticeMin > 0) {
      line = `Listo: el evento es ${reminderWhen(resolved.eventAt)}, te aviso ${durationText(noticeMin)} antes (${reminderWhen(created.at)}).`;
    }
    if (created.fixed) {
      line += ' Decime «agregalo a mi calendario» si lo querés en Google Calendar.';
    }
    if (say) {
      const spoken = Boolean(speakLine(line));
      followUp.reply(line, { spoken });
    }
    showLine(line, { chat, badge: 'RECORDATORIO' });
    refreshSettingsMenu();
    return { ok: true, line };
  }

  function goReminderReply(order, { chat = true } = {}) {
    if (order.action === 'create') return goReminderCreate(order, { chat });
    if (order.action === 'list') {
      const pending = getReminders()?.list() || [];
      const line = pending.length
        ? `Tenés ${pending.length} recordatorio${pending.length === 1 ? '' : 's'}: ${pending
          .map((item) => `${reminderLabel(item)}: ${item.text}`).join(' · ')}`
        : 'No tenés recordatorios pendientes.';
      return { ok: true, line: announce(line, { chat, badge: 'RECORDATORIO' }) };
    }
    if (order.action === 'move') {
      const zone = config.load().timeZone;
      const hits = getReminders()?.matches?.(order.match, { timeZone: zone }) || [];
      if (!hits.length) {
        const line = order.match
          ? `No encontré un recordatorio de «${order.match}».`
          : 'No tenía recordatorios para mover.';
        return { ok: true, line: announce(line, { chat, badge: 'RECORDATORIO' }) };
      }
      if (hits.length > 1) {
        const line = `¿Cuál de estos? ${hits.map((item) => `${reminderLabel(item)}: ${item.text}`).join(' · ')}`;
        return { ok: true, line: announce(line, { chat, badge: 'RECORDATORIO' }) };
      }
      const hit = hits[0];
      const baseAt = Number(hit.eventAt) || hit.at;
      const eventAt = (order.destSaid
        && (parseMoveTarget(order.destSaid, { timeZone: zone, baseAt })
          || parseMoveTarget(`a ${order.destSaid}`, { timeZone: zone, baseAt })))
        || order.at;
      const done = applyReminderEventMove(hit, eventAt);
      refreshSettingsMenu();
      const line = done
        ? `Listo, lo pasé a ${reminderLabel(done)}: ${done.text}.`
        : 'No pude mover ese recordatorio.';
      return { ok: true, line: announce(line, { chat, badge: 'RECORDATORIO' }) };
    }
    if (order.action === 'calendar') {
      const fixed = (getReminders()?.list() || []).filter((item) => item.fixed);
      const hits = order.match
        ? findMatches(fixed, order.match, { timeZone: config.load().timeZone })
        : fixed;
      const hit = hits[hits.length - 1]; // list()/findMatches sort by time: the latest one
      if (!hit) {
        const line = 'Para eso necesito un recordatorio con fecha y hora, no un timer.';
        return { ok: true, line: announce(line, { chat, badge: 'CALENDARIO' }) };
      }
      shell.openExternal(calendarUrl(hit));
      const line = `Listo, abrí Google Calendar con «${hit.text}».`;
      return { ok: true, line: announce(line, { chat, badge: 'CALENDARIO' }) };
    }
    if (order.action === 'cancel') {
      if (order.all) {
        const count = getReminders()?.cancelAll() || 0;
        refreshSettingsMenu();
        const line = count
          ? `Listo, cancelé ${count} recordatorio${count === 1 ? '' : 's'}.`
          : 'No tenía recordatorios para cancelar.';
        return { ok: true, line: announce(line, { chat, badge: 'RECORDATORIO' }) };
      }
      const hits = order.match
        ? (getReminders()?.matches?.(order.match, { timeZone: config.load().timeZone }) || [])
        : [];
      if (order.match && hits.length > 1) {
        const line = `¿Cuál cancelo? ${hits.map((item) => `${reminderLabel(item)}: ${item.text}`).join(' · ')}`;
        return { ok: true, line: announce(line, { chat, badge: 'RECORDATORIO' }) };
      }
      const done = hits.length === 1
        ? getReminders()?.remove?.(hits[0].id)
        : getReminders()?.cancelOne(order.match);
      refreshSettingsMenu();
      const line = done
        ? `Listo, cancelé este recordatorio: ${done.text}.`
        : order.match
          ? `No encontré un recordatorio de «${order.match}».`
          : 'No tenía recordatorios para cancelar.';
      return { ok: true, line: announce(line, { chat, badge: 'RECORDATORIO' }) };
    }
    return null;
  }

  return {
    MUSIC_LINE,
    pcReply,
    musicReply,
    runReplyAction,
    goSleepReply,
    goWakeReply,
    goForgetReply,
    goNameReply,
    goWhatsNewReply,
    goMicReply,
    GAME_BAR_CLIP_HOTKEY,
    goFixReply,
    goClipReply,
    reminderLabel,
    applyReminderEventMove,
    refreshSettingsMenu,
    weatherFallbackLine,
    goReminderCreate,
    goReminderReply,
  };
}

module.exports = { createReplies };
