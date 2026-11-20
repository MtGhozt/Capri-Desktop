// host.onCommand dispatch and her app FX helpers (Paso 4E).

import { fmt, reducedMotion } from '../util.js';

export function wireCommands({
  host,
  config,
  capri,
  panel,
  bubble,
  appMenu,
  dormant,
  mask,
  chip,
  drone,
  fx,
  machine,
  brain,
  guide,
  systemFx,
  ptr,
  fold,
  unfold,
  ensureDroneLoop,
}) {
  const {
    refreshHit,
    openAppMenu,
    forceFree,
    inputReset,
    holdQuitConfirm,
  } = ptr;

  // -- her apps' effects (Paso 4E) --------------------------------------------------------------
  // Drawn on the fx layer (pointer-events: none): they never take a click. main.js waits for the
  // zap's hit before closing (never more than 1.2 s), so she always answers it, played or not.
  const fxFrom = () => {
    if (!capri.hidden && !capri.stowed && machine.get() !== 'DORMANT') return capri.head();
    const d = dormant.rect();
    if (d) return { x: d.left + d.width / 2, y: d.top + d.height / 2 };
    if (chip.visible) return { x: chip.x + chip.w / 2, y: chip.y + chip.h / 2 };
    return { x: innerWidth / 2, y: innerHeight - 40 };
  };
  // no window to aim at: the taskbar, where its button is
  const fxTaskbar = () => {
    const bar = capri.windows?.bar;
    if (bar?.shown && bar.w > 0) return { x: bar.x + bar.w / 2, y: bar.y + bar.h / 2 };
    return { x: innerWidth / 2, y: innerHeight - 20 };
  };
  const fxRect = (r) => (r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0 ? r : null);
  let sparkWatch = 0;
  const appFx = (cmd) => {
    const live = !reducedMotion.matches;
    if (cmd.kind === 'zap') {
      if (!live) return host.appFxHit(cmd.id);
      const rect = fxRect(cmd.rect);
      fx.zapApp(fxFrom(), rect ? { rect } : { point: fxTaskbar() })
        .then(() => host.appFxHit(cmd.id), () => host.appFxHit(cmd.id));
      return;
    }
    if (cmd.kind !== 'spark' || !live) return;
    // a small one at her hand now; the real one where the new window comes up, if one does
    const from = fxFrom();
    fx.sparkApp({ point: from });
    clearInterval(sparkWatch);
    const before = capri.windows?.fg;
    const until = performance.now() + 8000;
    sparkWatch = setInterval(() => {
      const fg = capri.windows?.fg;
      const win = fg != null && String(fg) !== String(before) && capri.windows?.wins?.find((w) => String(w.id) === String(fg));
      if (win && win.w > 80 && win.h > 60) {
        clearInterval(sparkWatch);
        // a game taking the whole screen: nothing drawn over it (game mode is on its way)
        const full = win.w >= innerWidth - 2 && win.h >= innerHeight - 2;
        if (!full) fx.sparkApp({ rect: { x: win.x, y: win.y, w: win.w, h: win.h } });
      } else if (performance.now() > until) clearInterval(sparkWatch);
    }, 150);
  };

  host.onCommand(async (cmd) => {
    const t = brain.t;
    switch (cmd.name) {
      case 'teleport':
        await unfold();
        capri.teleport(capri.spot('random'));
        break;
      case 'status':
        brain.status();
        break;
      case 'welcome': // "How does it work?" in her menu
        guide.menu();
        break;
      case 'fakeClaude': { // --dev: the topmost window (the test window) is where a prompt was typed, and you're elsewhere
        const win = capri.windows.wins[0];
        if (win) {
          brain.sessions.set('dev', { id: 'dev', project: 'dev', taskStart: Date.now(), count: 0, files: new Set(), log: [], working: true, waiting: false, window: win.id, seen: Date.now() });
          capri.windows = { ...capri.windows, fg: -1 };
        }
        break;
      }
      case 'guide': // --dev: one topic of her guide (welcome, menu, connect, icon, claude, folder)
        if (cmd.topic === 'welcome') guide.welcome();
        else if (cmd.topic === 'menu') guide.menu();
        else if (typeof guide[cmd.topic] === 'function') guide.scene(() => guide[cmd.topic]());
        break;
      case 'menu': // --dev: open her context menu, to look at it
        openAppMenu(capri.head().x, capri.head().y - 20, capri.bounds(), cmd.expand || null);
        break;
      case 'stow': // Ctrl+Alt+C: into her biochip, or back out
        if (cmd.on) {
          bubble.hide({ fromHost: true });
          dormant.hide();
          if (machine.get() === 'DORMANT') machine.set('ONLINE');
          host.setFolded(false);
          capri.stow();
        } else capri.unstow();
        break;
      case 'game-drone':
        if (cmd.on) {
          ptr.droneActive = true;
          dormant.hide();
          mask.hide();
          drone.show();
          ensureDroneLoop();
        } else {
          ptr.droneActive = false;
          drone.hide();
          if (machine.get() === 'DORMANT') {
            dormant.setLabel('DORMANT');
            dormant.show();
          }
        }
        refreshHit();
        break;
      case 'music-state':
        if (cmd.playing && config.behavior?.musicDance !== false && !capri.hidden && !capri.busy) {
          setTimeout(() => {
            if (cmd.playing && !capri.hidden && !capri.busy) capri.flourish();
          }, 1200 + Math.random() * 2800);
        }
        break;
      case 'do-something':
        if (!capri.busy && !capri.hidden) capri.flourish();
        break;
      case 'chat': // Ctrl+Alt+T: wake DORMANT and open chat
        if (cmd.on) {
          await unfold({ chat: true });
        } else {
          bubble.hide({ fromHost: true });
        }
        break;
      case 'sleep':
        await fold({ force: true });
        break;
      case 'lock-position':
        host.setConfig({
          position: {
            locked: Boolean(cmd.on),
            x: Math.round(capri.pos.x),
            y: Math.round(capri.pos.y),
            edge: capri.grounded, // on the bottom edge: she keeps riding the bar up and down
          },
        });
        break;
      case 'box-log': // ABIERTO / CERRADO: an app she opened or closed, in the message box log
        bubble.note(cmd.kind, cmd.text);
        break;
      case 'app-fx': // her zap before closing an app, her spark after opening one (Paso 4E)
        appFx(cmd);
        break;
      case 'system-fx': // the screen tears itself apart before a shutdown / restart / suspend (Paso 4G)
        systemFx.play({ ms: cmd.ms }).then(() => host.systemFxDone?.(cmd.id));
        break;
      case 'system-fx-stop': // cancelled: give the screen back at once
      case 'system-fx-clear': // preview over, the command failed, or back from sleep
        systemFx.stop();
        break;
      case 'menu-close': // another window came to the front; force: the tray, Ctrl+Alt+M, Esc
        if (!cmd.force) {
          appMenu.hide();
          break;
        }
        forceFree();
        break;
      case 'rearmed': // a new mouse hook (main.js): click-through until the pointer comes over her again
        ptr.mouse = null;
        refreshHit();
        break;
      case 'input-reset': // look/speak/capture fault: never leave click-through or busy stuck
        inputReset();
        break;
      case 'rearm': // --dev: as if she'd noticed the pointer no longer reaches her
        host.rearm();
        break;
      case 'loseGl': { // --dev: as if the GPU had been reset (waking from sleep): she goes, then comes back
        const lose = capri.sprite.gl.getExtension('WEBGL_lose_context');
        lose?.loseContext();
        setTimeout(() => lose?.restoreContext(), cmd.ms ?? 1500);
        break;
      }
      case 'line': // a short notice from a menu action (memory, clip)
        panel.say({ kind: 'info', badge: cmd.badge, line: cmd.text, hold: cmd.hold ?? 4600 });
        break;
      case 'update-ask': { // GitHub release newer than package.json
        const prevAction = panel.onAction;
        panel.say({
          kind: 'info',
          badge: 'UPDATE',
          line: cmd.text,
          hold: null,
          actions: [
            { id: 'update-yes', label: 'Sí', primary: true },
            { id: 'update-later', label: 'Más tarde' },
            { id: 'update-skip', label: 'Saltar esta versión' },
          ],
        });
        panel.onAction = (id) => {
          if (id === 'update-yes' || id === 'update-later' || id === 'update-skip') {
            const map = { 'update-yes': 'yes', 'update-later': 'later', 'update-skip': 'skip' };
            host.menuAction({ id: 'update-answer', value: map[id] }).catch(() => {});
            panel.onAction = prevAction;
            panel.hide();
            return;
          }
          prevAction?.(id);
        };
        break;
      }
      case 'profile-ask': { // auto profile from PC hardware (Aplicar / Ahora no)
        const prevAction = panel.onAction;
        panel.say({
          kind: 'info',
          badge: 'PERFIL',
          line: cmd.text,
          hold: null,
          actions: [
            { id: 'profile-apply', label: 'Aplicar', primary: true },
            { id: 'profile-later', label: 'Ahora no' },
          ],
        });
        panel.onAction = (id) => {
          if (id === 'profile-apply' || id === 'profile-later') {
            host.menuAction({
              id: 'profile-answer',
              value: id === 'profile-apply' ? 'apply' : 'dismiss',
            }).catch(() => {});
            panel.onAction = prevAction;
            panel.hide();
            return;
          }
          prevAction?.(id);
        };
        break;
      }
      case 'quit-ask': { // Salir / "ciérrate": Sí / No before she actually quits
        // Solid window: no click-through / hover passthrough until confirm closes (+~300 ms).
        holdQuitConfirm(true);
        const prevAction = panel.onAction;
        panel.say({
          kind: 'info',
          badge: 'SALIR',
          line: cmd.text,
          hold: null,
          actions: [
            { id: 'quit-yes', label: 'Sí', primary: true },
            { id: 'quit-no', label: 'No' },
          ],
        });
        // Diagnose cover-ups after enter clip-path clears (Capri canvas / leftover is-entering).
        setTimeout(() => {
          const btn = panel.el.querySelector('.panel__action.is-primary');
          if (!btn) return;
          const r = btn.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const ok = Boolean(hit && (hit === btn || btn.contains(hit)));
          console.warn(
            `[capri] quit Sí elementFromPoint=${hit?.className || hit?.tagName || hit} ok=${ok}`,
          );
        }, 280);
        panel.onAction = (id) => {
          if (id === 'quit-yes' || id === 'quit-no') {
            const yes = id === 'quit-yes';
            host.menuAction({ id: 'quit-answer', value: yes ? 'si' : 'no' }).catch(() => {});
            panel.onAction = prevAction;
            panel.hide();
            holdQuitConfirm(false);
            return;
          }
          prevAction?.(id);
        };
        break;
      }
      case 'quit-clear':
        if (panel.visible && panel.current?.badge === 'SALIR') panel.hide();
        holdQuitConfirm(false);
        break;
      case 'wake':
        await unfold({ silent: cmd.silent === true }); // game coming back: her portrait, no bubble
        break;
      case 'satellite': // the whole sequence, on demand (tray)
        await unfold();
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (capri.stance === 'peek') await capri.unpeek();
        if (!capri.gaze({ big: true })) setTimeout(() => capri.gaze({ big: true }), 1500);
        break;
      case 'hooks':
        if (cmd.ok) panel.say({ kind: 'info', line: cmd.action === 'install' ? t.hooksOk : t.hooksRemoved, hold: 6000 });
        else panel.say({ kind: 'error', line: fmt(t.hooksFail, { error: cmd.error }), hold: 9000 });
        break;
      // --dev helpers
      case 'intro': // her intro again, as when she starts (still: as with Windows' animations off)
        panel.hide();
        await capri.intro(capri.spot('post'), cmd.still ? { still: true } : {});
        break;
      case 'pose':
        capri.debug = cmd.params || null;
        if (cmd.still) capri.nextMove = capri.nextGaze = Infinity; // no wandering off mid-test
        if (cmd.hush) {
          panel.setTicker(null);
          panel.hide();
        }
        if (cmd.scale) capri.setScale(cmd.scale);
        if (cmd.stance) capri.setStance(cmd.stance, cmd);
        if (cmd.at) capri.pos = cmd.at;
        if (cmd.facing) capri.facing = cmd.facing;
        capri.drawFrame();
        break;
      case 'config': // a setting, as if changed from her menu
        host.setConfig(cmd.patch || {});
        break;
      case 'focus': // as if window `fg` had come to the front
        capri.windows = { ...capri.windows, fg: cmd.fg };
        brain.onWindows(capri.windows);
        break;
      case 'freeze':
        capri.hidden = Boolean(cmd.on);
        break;
      case 'act':
        // behaviours by method name (gaze, celebrate, hurt, shed, peek, fall, wanderStep...) or acts by name
        if (cmd.act === 'sit') {
          // pile: n-th window she could sit on from the top of the pile (0: the --dev test window
          // opened last), instead of the usual choice
          const top = cmd.pile !== undefined && capri.windows.wins.filter((w) => capri.canSit(w))[cmd.pile];
          const seat = top ? { win: top, dx: top.w * 0.4 } : capri.pickSeat();
          if (seat) capri.sitOn(seat);
        } else if (typeof capri[cmd.act] === 'function') capri[cmd.act](...(cmd.args || []));
        else capri.perform(cmd.act, cmd.dir || 0);
        break;
      default:
        break;
    }
  });
}
