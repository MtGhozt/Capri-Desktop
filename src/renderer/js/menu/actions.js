// Menu action dispatch and optimistic cfg patches.

// Patch lastState so toggles/selectors flip before menuAction + getMenu round-trip.
export function optimisticAct(app, id, value) {
  if (!app.lastState?.cfg) return false;
  const cfg = app.lastState.cfg;
  switch (id) {
    case 'mic': cfg.mic = Boolean(value); return true;
    case 'mic-device': cfg.micDevice = value; return true;
    case 'reply-mode': cfg.replyMode = value; return true;
    case 'theme': cfg.theme = value; return true;
    case 'drag-lock': cfg.locked = value === 'locked' || value === true; return true;
    case 'startup': app.lastState.login = Boolean(value); return true;
    case 'desktop-shortcut': app.lastState.deskShortcut = Boolean(value); return true;
    case 'drone-mode': cfg.gaming = { ...(cfg.gaming || {}), drone: Boolean(value) }; return true;
    case 'gaming-play': {
      const next = value === 'comment' ? 'comment' : 'quiet';
      cfg.gaming = { ...(cfg.gaming || {}), mode: next, lastMode: next };
      return true;
    }
    case 'comments': cfg.comments = { ...(cfg.comments || {}), enabled: Boolean(value) }; return true;
    case 'greetings': cfg.behavior = { ...(cfg.behavior || {}), greetings: Boolean(value) }; return true;
    case 'unlock-greeting': cfg.behavior = { ...(cfg.behavior || {}), unlockGreeting: Boolean(value) }; return true;
    case 'caresses': cfg.behavior = { ...(cfg.behavior || {}), caresses: Boolean(value) }; return true;
    case 'music-dance': cfg.behavior = { ...(cfg.behavior || {}), musicDance: Boolean(value) }; return true;
    case 'app-fx': cfg.fx = { ...(cfg.fx || {}), apps: Boolean(value) }; return true;
    case 'scanlines': cfg.fx = { ...(cfg.fx || {}), scanlines: Boolean(value) }; return true;
    case 'time-zone': cfg.timeZone = value; return true;
    case 'time-format': cfg.timeFormat = value === '12h' ? '12h' : '24h'; return true;
    case 'weather-place': cfg.weatherPlace = value; return true;
    case 'music-player': cfg.music = { ...(cfg.music || {}), player: value }; return true;
    default: return false;
  }
}

export async function act(app, id, value) {
  if (id === 'forget' && !app.confirmForget) {
    app.confirmForget = true;
    const state = await app.host.getMenu({ folded: app.folded() });
    app.render(state);
    return;
  }
  app.confirmForget = false;
  if (id !== 'render') app.confirmSoftware = false;
  const keep = app.settingsMode || id === 'mic' || id === 'mic-device' || id === 'reply-mode' || id === 'music-player'
    || id === 'model-provider' || id === 'spotify-connect' || id === 'spotify-disconnect' || id === 'drag-lock' || id === 'theme'
    || id === 'startup' || id === 'gaming-mode' || id === 'gaming-play' || id === 'drone-mode' || id === 'comments' || id === 'comments-range'
    || id === 'desktop-shortcut'
    || id === 'greetings' || id === 'unlock-greeting' || id === 'caresses' || id === 'music-dance'
    || id === 'app-fx' || id === 'scanlines' || id === 'game-list'
    || id === 'time-zone' || id === 'time-format' || id === 'weather-place' || id === 'reminder-update' || id === 'reminder-delete';
  if (keep && app.open && optimisticAct(app, id, value)) {
    app.render(app.lastState);
  }
  const result = await app.host.menuAction({ id, value });
  if (id === 'game-list' && result?.message) app.gameNote = result.message;
  if (id === 'gaming-play' && result?.warning) app.gamePlayNote = result.warning;
  if ((id === 'reminder-update' || id === 'reminder-delete') && result?.message) {
    app.reminderNote = result.message;
  }
  if (id === 'weather-place') {
    if (result?.label) app.placeNote = result.label;
    else if (result?.notFound) app.placeNote = 'No encontré esa ciudad';
    else if (result?.offline) { /* keep quiet: no spam when offline */ }
    else if (!value) app.placeNote = '';
  }
  if (!keep) {
    app.hide();
    return result;
  }
  if (app.open) {
    const state = await app.host.getMenu({ folded: app.folded(), light: !app.settingsMode });
    app.render(state);
  }
  return result;
}
