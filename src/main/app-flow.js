'use strict';

// "abre X" / "cierra X" from start to finish (Paso 4C): reading the order (app-command.js),
// asking first when it has to (app-confirm.js), doing it (app-actions.js), and the line she says
// about it (lines-es.js). main.js says the line and logs; nothing here touches the PC itself.
//
//   answer(text)  -> { line } when it answered her last question ("sí" / "no"), else null
//   command(text) -> { line } when it was an order about her apps, null when the model should answer
//   handle(text)  -> both, in that order
//   dryRun(text)  -> what she would do, in Spanish, done nothing (her menu's "Probar comando")

const { parseAppCommand, planAppCommand, joinNames, describePlan } = require('./app-command');
const { createConfirm } = require('./app-confirm');

// event(kind, names): 'abierto' / 'cerrado' with the apps it did, for the message box log
function createAppFlow({ apps, actions, line, log = () => {}, event = () => {}, confirm = createConfirm() }) {
  const names = (list) => joinNames(list.map((a) => a.name));
  const quoted = (list) => joinNames(list.map((m) => `«${m}»`));

  async function open(list, missing = []) {
    const ok = [];
    const lines = [];
    for (const app of list) {
      const res = await actions.open(app);
      log(`app open ${app.name} type=${app.type} ${res.ok ? 'ok' : `failed: ${res.error}`}`);
      if (res.ok) ok.push(app);
      else if (lines.length < 2) lines.push(line('appFallo', { app: app.name }));
    }
    if (ok.length) event('abierto', names(ok));
    if (ok.length === 1) lines.unshift(line('appAbrir', { app: ok[0].name }));
    if (ok.length > 1) lines.unshift(line('appAbrirVarias', { apps: names(ok) }));
    if (missing.length) lines.push(line('appNoEncontrada', { app: quoted(missing) }));
    return lines.join(' ');
  }

  // `mode` null: each app's own close mode ('ask' ones get a question)
  async function close(list, mode = null, missing = []) {
    const by = { closed: [], notRunning: [], denied: [], notCloseable: [], failed: [], force: [], ask: [] };
    for (const app of list) {
      if (!mode && app.close === 'ask') {
        by.ask.push(app);
        log(`app close ${app.name} mode=ask: asking first`);
        continue;
      }
      const use = mode || app.close || 'graceful';
      const res = await actions.close(app, use);
      log(`app close ${app.name} mode=${use} status=${res.status}${res.ids?.length ? ` pids=${res.ids.join(',')}` : ''}${res.error ? ` error: ${res.error}` : ''}`);
      // File Explorer has nothing to force: only its windows are ever closed
      if (res.status === 'stillRunning') (use === 'force' || app.windows ? by.failed : by.force).push(app);
      else (by[res.status] || by.failed).push(app);
    }
    const lines = [];
    if (by.closed.length) event('cerrado', names(by.closed));
    if (by.closed.length) lines.push(line('appCerrar', { app: names(by.closed) }));
    if (by.notRunning.length) lines.push(line('appNoCorre', { app: names(by.notRunning) }));
    if (by.notCloseable.length) lines.push(line('appNoCerrable', { app: names(by.notCloseable) }));
    if (by.denied.length) lines.push(line('appProhibido', { app: names(by.denied) }));
    if (by.failed.length) lines.push(line('appFallo', { app: names(by.failed) }));
    if (missing.length) lines.push(line('appNoEncontrada', { app: quoted(missing) }));
    // the question last: said aloud, the mic opens for the answer (4B)
    if (by.ask.length) {
      confirm.ask({ type: 'close', apps: by.ask, mode: 'graceful' });
      lines.push(line('appConfirmar', { apps: names(by.ask) }));
    } else if (by.force.length) {
      confirm.ask({ type: 'close', apps: by.force, mode: 'force' });
      lines.push(line('appForzar', { app: names(by.force) }));
    }
    return lines.join(' ');
  }

  function run({ type, apps: list, mode = null, missing = [] }) {
    return type === 'open' ? open(list, missing) : close(list, mode, missing);
  }

  // Your answer to her last question, if she asked one: { line }, or null (nothing pending, or
  // you said something else: the question is dropped and the message is read as usual).
  async function answer(text) {
    const answer = confirm.take(text);
    if (answer?.kind === 'yes') {
      log(`app confirm yes: ${answer.action.type} ${names(answer.action.apps)}`);
      return { line: await run(answer.action) };
    }
    if (answer?.explicit) {
      log(`app confirm no: ${answer.action.type} ${names(answer.action.apps)}`);
      return { line: line('appCancelado', {}) };
    }
    if (answer) log('app confirm dropped: something else was said');
    return null;
  }

  // An order about her apps: { line }, or null when it isn't one.
  async function command(text) {
    const plan = planAppCommand(parseAppCommand(text, apps()));
    if (!plan) return null;
    if (plan.kind === 'notFound') {
      log(`app ${plan.action} not found: ${plan.missing.join(', ')}`);
      return { line: line('appNoEncontrada', { app: quoted(plan.missing) }) };
    }
    if (plan.kind === 'ask') {
      log(`app ${plan.action} did you mean: ${names(plan.suggest)}`);
      confirm.ask({ type: plan.action, apps: plan.apps, mode: null, missing: plan.missing });
      return { line: line('appQuisiste', { apps: names(plan.suggest) }) };
    }
    return { line: await run({ type: plan.action, apps: plan.apps, missing: plan.missing }) };
  }

  async function handle(text) {
    return (await answer(text)) || command(text);
  }

  function dryRun(text) {
    if (!String(text || '').trim()) return 'Escribe algo como «abre Discord».';
    return describePlan(planAppCommand(parseAppCommand(text, apps())));
  }

  return { answer, command, handle, dryRun, confirm };
}

module.exports = { createAppFlow };
