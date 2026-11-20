// Click-through hit-testing, biochip/mask hover & wake, pointer-hook rearm, caress polling,
// menu-guard heartbeat / forceFree / recovery, and DORMANT fold/unfold. Wired from boot().

import { tween, reducedMotion } from '../util.js';

const WATCH_MS = 2000; // how often she checks the pointer still reaches her

export function wirePointer({
  host,
  chip,
  mask,
  capri,
  panel,
  bubble,
  appMenu,
  dormant,
  drone,
  config,
  rendererError,
}) {
  // Click-through everywhere except on her body, the panel and her biochip.
  let interactive = false;
  let mouse = null;
  let folding = false;
  let foldingAt = 0; // when the fold/unfold started: one that never ends can't hold the screen
  let droneActive = false;
  let capriBusyAt = 0;
  let quitConfirm = false; // ¿Salir? Sí/No: whole window solid until it closes (+300 ms)
  let quitConfirmClearAt = 0;
  let lastLive = performance.now();
  const bumpIdle = () => { lastLive = performance.now(); };
  const setInteractive = (on) => {
    if (quitConfirm) on = true;
    if (on === interactive) return;
    interactive = on;
    host.setInteractive(on);
  };
  const holdQuitConfirm = (on) => {
    quitConfirm = Boolean(on);
    // Capri's canvas used to sit above the panel and eat Sí/No; also force her off hit-testing.
    const capriRoot = document.getElementById('capri');
    if (capriRoot) capriRoot.style.pointerEvents = quitConfirm ? 'none' : '';
    if (quitConfirm) {
      quitConfirmClearAt = 0;
      setInteractive(true);
      return;
    }
    quitConfirmClearAt = performance.now() + 300;
    setTimeout(() => {
      if (quitConfirm || performance.now() < quitConfirmClearAt) return;
      refreshHit();
    }, 320);
  };
  const onChip = () => Boolean(chip.visible && mouse && chip.contains(mouse.x, mouse.y, 0));
  const refreshHit = () => {
    if (quitConfirm) return setInteractive(true);
    if (folding || capri.dragging || bubble.dragging || appMenu.visible) return setInteractive(true);
    if (!mouse) return setInteractive(false);
    const r = panel.rect();
    const onPanel = r && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom;
    const br = bubble.rect();
    const onBubble = Boolean(
      br && mouse.x >= br.left && mouse.x <= br.right && mouse.y >= br.top && mouse.y <= br.bottom,
    ) || bubble.hitInput(mouse.x, mouse.y) || bubble.hitGrab(mouse.x, mouse.y);
    const m = appMenu.rect();
    const onMenu = m && mouse.x >= m.left && mouse.x <= m.right && mouse.y >= m.top && mouse.y <= m.bottom;
    const onDrone = !document.getElementById('drone').hidden && drone.hit(mouse.x, mouse.y);
    const onDormant = dormant.contains(mouse.x, mouse.y);
    document.body.style.cursor = (onChip() || onDormant) ? 'pointer' : '';
    return setInteractive(Boolean(onPanel || onBubble || onMenu || onDormant || onDrone || capri.hit(mouse.x, mouse.y) || onChip()));
  };
  // Her biochip: her eyes on it follow the pointer over it, and she comes out when you click it
  // (only then, so the pointer passing through that corner doesn't call her back).
  // Her mask, asleep: the pointer coming over it stirs her, and a moment of that wakes her up.
  let wakeTimer = 0;
  const comeOut = () => {
    if (capri.stowed) host.setConfig({ visible: true }); // the tray and Ctrl+Alt+C follow
    capri.unstow();
  };
  const hoverChip = () => {
    chip.pointer = chip.visible && mouse && chip.contains(mouse.x, mouse.y) ? mouse : null;
    const near = mask.visible && mouse && mask.contains(mouse.x, mouse.y, 30);
    mask.pointer = near ? mouse : null;
    if (!near) {
      clearTimeout(wakeTimer);
      wakeTimer = 0;
    } else if (!wakeTimer) {
      wakeTimer = setTimeout(() => {
        wakeTimer = 0;
        if (capri.dormant) capri.wake();
      }, 400);
    }
  };
  let lastMove = 0;
  window.addEventListener('mousemove', (e) => {
    lastMove = performance.now();
    mouse = { x: e.clientX, y: e.clientY };
    refreshHit();
    hoverChip();
    if (interactive) bumpIdle();
  });
  // Only burn rAF while the game drone is visible (was always-on).
  let droneRaf = 0;
  const drawDrone = (time) => {
    droneRaf = 0;
    if (document.getElementById('drone').hidden) return;
    drone.update(time, { x: (mouse?.x || innerWidth / 2) / innerWidth * 270, y: (mouse?.y || innerHeight / 2) / innerHeight * 270 });
    droneRaf = requestAnimationFrame(drawDrone);
  };
  const ensureDroneLoop = () => {
    if (!droneRaf && !document.getElementById('drone').hidden) {
      droneRaf = requestAnimationFrame(drawDrone);
    }
  };
  document.addEventListener('mouseleave', () => {
    mouse = null;
    refreshHit();
    hoverChip();
  });
  // Where the pointer really is, every couple of seconds: if it moved over her window and no
  // mousemove came, the hook that brings it to her is gone (Windows drops it without a word, after
  // sleep say), and main.js puts in a new one.
  let seen = null;
  let rearmedAt = -Infinity;
  setInterval(async () => {
    const at = await host.cursor().catch(() => null);
    const before = seen;
    seen = at;
    if (!at?.inside) return;
    const now = performance.now();
    // Adapted from mochiiwuff/capri-desktop (PolyForm Noncommercial 1.0.0)
    // The pointer is on her and she isn't clickable (its moves stopped reaching her): she is now.
    if (!interactive && now - lastMove > WATCH_MS) {
      mouse = { x: at.x, y: at.y };
      refreshHit();
    }
    if (!before?.inside || (at.x === before.x && at.y === before.y)) return;
    if (now - lastMove < WATCH_MS * 1.5 || now - rearmedAt < 20000) return;
    rearmedAt = now;
    host.rearm();
  }, WATCH_MS);

  // Click-through: no mousemove. Poll global cursor over her head for caresses (~80 ms: same feel, less IPC).
  setInterval(async () => {
    if (config.behavior?.caresses === false || capri.busy || capri.hidden || capri.dragging || capri.dormant) return;
    const at = await host.cursor().catch(() => null);
    if (!at?.inside) {
      capri._caressStroke = null;
      return;
    }
    capri.noteCursor(at.x, at.y);
  }, 80);
  const menuAvoid = (x, y) => {
    if (dormant.contains(x, y)) return dormant.rect();
    if (chip.visible && chip.contains(x, y, 0)) {
      return { left: chip.x, top: chip.y, right: chip.x + chip.w, bottom: chip.y + chip.h };
    }
    if (!capri.hidden && capri.p.alpha >= 0.5) return capri.bounds();
    return { left: x, top: y, right: x, bottom: y };
  };
  const openAppMenu = (x, y, avoid, expand = null) => {
    setInteractive(true);
    appMenu.show(x, y, avoid || menuAvoid(x, y), expand);
  };
  const onAppMenuTarget = (x, y) => (
    (chip.visible && chip.contains(x, y, 0)) || dormant.contains(x, y) || capri.hit(x, y)
  );
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (onAppMenuTarget(e.clientX, e.clientY)) openAppMenu(e.clientX, e.clientY);
  });
  window.addEventListener('click', (e) => {
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) comeOut();
  });

  // Her menu and her click-through, told to main every 2 s (menu-guard.js): main keeps the window in
  // line with it, and takes the clicks back for the other windows if she stops answering.
  function beat() {
    if (capri.busy) {
      if (!capriBusyAt) capriBusyAt = performance.now();
      else if (performance.now() - capriBusyAt > 12000) inputReset();
    } else {
      capriBusyAt = 0;
    }
    if (!appMenu.visible && !appMenu.el.hidden) {
      console.error('[capri] menu drawn while closed: hiding it');
      appMenu.hide({ force: true });
    }
    host.beat({
      menu: appMenu.visible,
      shown: !appMenu.el.hidden,
      interactive,
      folding,
      dragging: Boolean(capri.dragging),
    });
  }

  setInterval(beat, 2000);
  // Forced close: the menu goes, whatever it thinks it is, and nothing left holds the screen
  // (a fold that never ended, a drag that lost its mouseup). Main has already put click-through on.
  function forceFree() {
    appMenu.hide({ force: true });
    if (folding && performance.now() - foldingAt > 3000) folding = false;
    if (capri.dragging) window.dispatchEvent(new MouseEvent('mouseup'));
    mouse = null;
    interactive = true; // so the false below is sent, whatever she thought before
    refreshHit();
    beat();
  }

  // A thrown act (or any other renderer fault) must not leave click-through / the menu stuck.
  window.addEventListener('error', (event) => {
    rendererError('window.error', event.error || event.message);
    forceFree();
  });
  window.addEventListener('unhandledrejection', (event) => {
    rendererError('unhandledrejection', event.reason);
    forceFree();
  });

  // Main asks after look/capture errors: idle + clickable again (drag/menu/Settings).
  // Also clears a stuck dragging/busy/fold so she does not freeze over the desktop.
  const inputReset = () => {
    try {
      if (capri.busy) {
        capri.endAct?.(false);
        capri.busy = false;
      }
      if (capri.dragging) window.dispatchEvent(new MouseEvent('mouseup'));
      if (bubble.dragging) window.dispatchEvent(new MouseEvent('mouseup'));
    } catch { /* best effort */ }
    forceFree();
  };

  // Click-through can't stay off by itself: a fold that never ended lets go, and what she asks
  // main for is sent again (main may have lost it to a focus change).
  setInterval(() => {
    if (folding && performance.now() - foldingAt > 15000) {
      console.error('[capri] fold/unfold stuck: letting go of the screen');
      folding = false;
    }
    refreshHit();
    host.setInteractive(interactive);
  }, 3000);

  return {
    get interactive() { return interactive; },
    get mouse() { return mouse; },
    set mouse(v) { mouse = v; },
    get folding() { return folding; },
    set folding(v) { folding = v; },
    get foldingAt() { return foldingAt; },
    set foldingAt(v) { foldingAt = v; },
    get droneActive() { return droneActive; },
    set droneActive(v) { droneActive = v; },
    get quitConfirm() { return quitConfirm; },
    get lastLive() { return lastLive; },
    bumpIdle,
    setInteractive,
    holdQuitConfirm,
    refreshHit,
    comeOut,
    ensureDroneLoop,
    openAppMenu,
    forceFree,
    inputReset,
    beat,
  };
}

// DORMANT fold/unfold + idle timer + talking glitch. Owns nothing new: uses ptr.folding*.
export function wireFold({
  host,
  ptr,
  capri,
  panel,
  bubble,
  appMenu,
  dormant,
  mask,
  voice,
  machine,
  brain,
  vhs,
  config,
  setChatSource,
  isArtKitRunning,
}) {
  let idleMs = Number(config.idle?.dormantAfterMs);
  let glitchFx = config.fx?.glitch !== false;
  dormant.setFx(glitchFx);
  let talkGlitch = 0;
  const useGlitch = () => glitchFx && !reducedMotion.matches;
  const showVhs = (on) => { vhs.hidden = !on; };
  const canFold = () => (
    !isArtKitRunning()
    && Number.isFinite(idleMs) && idleMs > 0
    && !ptr.folding
    && machine.get() !== 'DORMANT'
    && machine.get() !== 'THINKING'
    && machine.get() !== 'TALKING'
    && machine.get() !== 'BOOTING'
    && machine.get() !== 'LISTENING'
    && !bubble.open && !bubble.busy
    && !capri.stowed && !capri.busy
    && brain.busySessions.length === 0
  );
  const fold = async ({ force = false } = {}) => {
    if (ptr.folding || capri.stowed || machine.get() === 'DORMANT') return;
    if (!force && !canFold()) return;
    ptr.folding = true;
    ptr.foldingAt = performance.now();
    appMenu.hide();
    panel.hide();
    if (bubble.open) {
      setChatSource('fold'); // idle/sleep hides it: the toggle must know it is gone
      bubble.hide();
    }
    // off to a bottom corner first (FIJO: she stays put), so she wakes up there
    if (!capri.dormant && !capri.busy && !capri.hidden) {
      await capri.goToBed();
      const up = ['THINKING', 'TALKING', 'LISTENING', 'BOOTING'].includes(machine.get());
      if (!force && (up || bubble.open || capri.stowed)) { // something came up on her way there: stay up
        ptr.folding = false;
        return;
      }
    }
    if (useGlitch()) {
      showVhs(true);
      capri.p.glitchSeed = Math.random() * 100;
      await tween(capri.p, { glitch: 0.85, split: 7, collapse: 0.7, alpha: 0.2 }, 420);
      await tween(capri.p, { collapse: 1, glitch: 1, alpha: 0 }, 180);
      showVhs(false);
    }
    if (capri.dormant) {
      mask.hide();
      capri.dormant = false;
    }
    capri.setHidden(true);
    Object.assign(capri.p, { glitch: 0, split: 0, collapse: 0, alpha: 1 });
    machine.set('DORMANT');
    host.setFolded(true);
    if (!ptr.droneActive) {
      dormant.setLabel('DORMANT');
      dormant.show();
    }
    ptr.folding = false;
    ptr.refreshHit();
  };
  const unfold = async ({ chat = false, source = 'overlay', silent = false } = {}) => {
    if (chat) setChatSource(source);
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    if (machine.get() === 'DORMANT') {
      ptr.folding = true;
      ptr.foldingAt = performance.now();
      ptr.refreshHit();
      if (!silent) voice.wakeArp();
      const from = dormant.rect();
      const bootState = bubble.boot;
      const next = bootState === 'booting' ? 'BOOTING' : bootState === 'failed' ? 'OFFLINE' : 'ONLINE';
      if (useGlitch()) {
        showVhs(true);
        await dormant.burst();
        capri.setHidden(false);
        Object.assign(capri.p, { alpha: 0, collapse: 1, glitch: 0.7, split: 6 });
        capri.drawFrame();
        machine.set(next);
        host.setFolded(false);
        await Promise.all([
          (async () => {
            await tween(capri.p, { collapse: 0, alpha: 1, glitch: 0.25, split: 2 }, 320);
            await tween(capri.p, { glitch: 0, split: 0 }, 180);
          })(),
          silent ? Promise.resolve() : bubble.birth(from, { animate: true }),
        ]);
        showVhs(false);
        dormant.hide();
      } else {
        dormant.hide();
        capri.setHidden(false);
        capri.p.alpha = 1;
        capri.drawFrame();
        machine.set(next);
        host.setFolded(false);
        if (!silent) bubble.show();
      }
      ptr.folding = false;
    }
    ptr.bumpIdle();
    capri.wake();
    ptr.refreshHit();
    if (chat && !bubble.open) bubble.show();
  };
  dormant.onWake = () => unfold({ chat: true, source: 'widget' });
  machine.onChange((state) => {
    dormant.setLabel(state, machine.pct);
    clearInterval(talkGlitch);
    talkGlitch = 0;
    if (state === 'TALKING' && useGlitch() && !capri.hidden) {
      talkGlitch = setInterval(() => {
        capri.p.glitchSeed = Math.random() * 100;
        capri.p.glitch = capri.p.glitch > 0.05 ? 0 : 0.16;
        capri.p.split = capri.p.glitch > 0 ? 2 : 0;
      }, 220);
    } else if (state !== 'TALKING') {
      capri.p.glitch = 0;
      capri.p.split = 0;
    }
  });
  window.addEventListener('keydown', () => { if (bubble.open) ptr.bumpIdle(); });
  setInterval(() => {
    if (canFold() && performance.now() - ptr.lastLive >= idleMs) fold();
  }, 1000);

  return {
    fold,
    unfold,
    setIdleMs: (ms) => { idleMs = Number(ms); },
    setGlitchFx: (on) => { glitchFx = on; dormant.setFx(glitchFx); },
  };
}
