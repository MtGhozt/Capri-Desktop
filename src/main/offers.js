'use strict';

// Optional bubbles after boot: a new Capri release on GitHub, and a hardware profile suggestion.
// Pending answers live here so main.js only wires sendCommand / updateConfig.

const { app, shell } = require('electron');

const config = require('./config');
const { checkForUpdate } = require('./updates');
const {
  recommendProfile, detectHardware, hardwareFingerprint, shouldOfferBubble,
  applyPatch, bubbleLine, matchesConfig,
} = require('./recommend-profile');

function createOffers(deps) {
  const {
    updateConfig,
    sendCommand,
    appLog,
    gameQuietActive,
  } = deps;

  let pendingUpdate = null;
  let pendingProfile = null;

  async function runUpdateCheck({ force = false } = {}) {
    const cfg = config.load();
    const now = Date.now();
    const result = await checkForUpdate({
      localVersion: app.getVersion(),
      skippedVersion: cfg.updates?.skippedVersion,
      enabled: force ? true : cfg.updates?.enabled !== false,
      lastCheck: force ? 0 : cfg.updates?.lastCheck,
      now,
    });
    if (result.checked) updateConfig({ updates: { lastCheck: now } });
    if (result.error) {
      appLog(`updates check failed: ${result.error}`);
      return force ? { ok: false, message: 'No pude mirar GitHub ahora.' } : { ok: true };
    }
    if (!result.update) {
      return force ? { ok: true, message: 'Ya estás al día.' } : { ok: true };
    }
    pendingUpdate = result.update;
    sendCommand('update-ask', {
      text: `¡Salió Capri v${result.update.version}! ¿Querés actualizar?`,
      version: result.update.version,
      url: result.update.url,
    });
    return { ok: true, update: result.update };
  }

  function answerUpdatePrompt(value) {
    const update = pendingUpdate;
    pendingUpdate = null;
    const answer = String(value || '');
    if (answer === 'yes' && update?.url) {
      shell.openExternal(update.url);
      return { ok: true };
    }
    if (answer === 'skip' && update?.version) {
      updateConfig({ updates: { skippedVersion: update.version } });
      return { ok: true };
    }
    return { ok: true }; // later
  }

  function maybeOfferProfile({ force = false } = {}) {
    if (gameQuietActive()) return { ok: true, skipped: 'game' };
    const cfg = config.load();
    const hw = detectHardware();
    if (!hw) return { ok: true, skipped: 'detect' };
    const rec = recommendProfile(hw);
    if (force && matchesConfig(cfg, rec)) {
      sendCommand('line', { badge: 'PERFIL', text: 'Ya estás en el perfil que te conviene.' });
      return { ok: true, skipped: 'match' };
    }
    if (!shouldOfferBubble({
      cfg,
      rec,
      hw,
      force,
      firstRun: !cfg.welcomed,
      gameQuiet: gameQuietActive(),
    })) {
      return { ok: true, skipped: 'no-offer' };
    }
    pendingProfile = { rec, hw };
    sendCommand('profile-ask', { text: bubbleLine(rec) });
    return { ok: true, offered: true };
  }

  function answerProfilePrompt(value) {
    const pending = pendingProfile;
    pendingProfile = null;
    if (!pending?.rec || !pending?.hw) return { ok: true };
    const answer = String(value || '');
    if (answer === 'apply') {
      updateConfig(applyPatch(pending.rec));
      return { ok: true, applied: true };
    }
    if (answer === 'dismiss') {
      updateConfig({ profile: { dismissedHw: hardwareFingerprint(pending.hw) } });
      return { ok: true, dismissed: true };
    }
    return { ok: true };
  }

  return {
    runUpdateCheck,
    answerUpdatePrompt,
    maybeOfferProfile,
    answerProfilePrompt,
  };
}

module.exports = { createOffers };
