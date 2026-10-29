import { Capri } from './capri.js';
import { FxLayer, GRAB_FRAMES } from './fx.js';
import { Chip, Mask } from './chip.js';
import { Panel } from './panel.js';
import { Bubble } from './bubble.js';
import { AppMenu } from './menu.js';
import { DormantWidget } from './dormant.js';
import { Machine } from './state.js';
import { Voice } from './voice.js';
import { Brain } from './brain.js';
import { Guide } from './guide.js';
import { LINES } from './lines.js';
import { POSE_FILES } from './poses.js';
import { SystemFx } from './system-fx.js';
import { createDrone } from './drone.js';
import { runArtKit } from './art-kit.js';
import { pick, fmt, sleep, tween, reducedMotion } from './util.js';

const host = window.host;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// close-ups of her for the cut-ins, frames of the show (tools/build-cutins.py)
const CUTINS = ['grin', 'laugh', 'eyes', 'many', 'look'];
const WATCH_MS = 2000; // how often she checks the pointer still reaches her

async function boot() {
  const [config, image, intro, posePairs, ...cutins] = await Promise.all([
    host.getConfig(),
    loadImage('../../assets/capri/capri-full.png'),
    Promise.all(GRAB_FRAMES.map((name) => loadImage(`../../assets/capri/intro-${name}.webp`).catch(() => null)))
      .then((cels) => (cels[0] ? Object.fromEntries(GRAB_FRAMES.map((name, i) => [name, cels[i]])) : null)),
    Promise.all(POSE_FILES.map((name) => loadImage(`../../assets/capri/poses/${name}`).then((img) => [name, img]))),
    ...CUTINS.map((name) => loadImage(`../../assets/capri/cutin-${name}.png`)),
    document.fonts.load('600 16px "Chakra Petch"'),
    document.fonts.load('400 11px "JetBrains Mono"'),
  ]);
  document.documentElement.lang = config.lang;

  const fx = new FxLayer(document.getElementById('fx'), {
    cutins: Object.fromEntries(CUTINS.map((name, i) => [name, cutins[i]])),
    intro,
  });
  fx.resize(innerWidth, innerHeight);
  // how far the top of the taskbar is from the bottom of her window: her window covers it too
  // while she rests on it (she stands on its top edge, see Capri.floor)
  let floorGap = config.floorGap ?? 0;
  const chip = new Chip(document.getElementById('chip'));
  chip.place(innerWidth, innerHeight - floorGap);
  const mask = new Mask(document.getElementById('mask'));

  const voice = new Voice();
  voice.configure(config);
  host.listSounds().then((list) => list.length && voice.loadCustom(list));

  const panel = new Panel({
    panel: document.getElementById('panel'),
    ticker: document.getElementById('ticker'),
    labels: LINES[config.lang] || LINES.fr,
  });
  const machine = new Machine('ONLINE');
  machine.dev = Boolean(config.dev);
  const bubble = new Bubble({ el: document.getElementById('bubble'), machine });
  bubble.setFx(config.fx?.scanlines !== false);
  bubble.setLogLimit(config.ui?.logLines ?? 4);
  const appMenu = new AppMenu({
    el: document.getElementById('app-menu'),
    host,
    folded: () => machine.get() === 'DORMANT',
  });
  appMenu.setTheme(config.ui?.theme);
  const dormant = new DormantWidget({ el: document.getElementById('dormant'), host });
  const drone = createDrone(document.getElementById('drone'));
  drone.setTheme(config.ui?.theme);
  const vhs = document.getElementById('vhs');
  dormant.loadPos(config.idle?.widget, innerWidth, innerHeight);

  const capri = new Capri({
    root: document.getElementById('capri'),
    canvas: document.getElementById('sprite'),
    image,
    fx,
    voice,
    poses: Object.fromEntries(posePairs),
  });
  capri.messageBox = () => bubble.ledge();
  capri.wander = config.wander;
  capri.possessWindows = config.possess;
  capri.restOn = config.rest || 'taskbar';
  capri.setView(innerWidth, innerHeight, innerHeight - floorGap);
  capri.setScale(config.scale);

  // COMPORTAMIENTO > Arrastrar: FIJO keeps her where she was dropped and remembers it.
  const applyPosition = (cfg) => {
    capri.locked = Boolean(cfg.position?.locked);
    const home = cfg.position?.homeX;
    capri.homeX = home != null && Number.isFinite(Number(home)) ? Number(home) : null;
    const x = Number(cfg.position?.x);
    const y = Number(cfg.position?.y);
    if (!capri.locked || !Number.isFinite(x) || !Number.isFinite(y)) return;
    // locked on the bottom edge: on it wherever the bar has it now (she still rides it)
    const edge = Boolean(cfg.position?.edge);
    const to = { x, y: edge ? capri.floor : y };
    if (Math.abs(capri.pos.x - to.x) > 1 || Math.abs(capri.pos.y - to.y) > 1) {
      capri.pos = to;
      if (edge && capri.stance === 'stand' && !capri.busy) capri.setStance('stand');
      capri.place();
    }
  };
  // where she comes in: where FIJO keeps her, else where she rests
  const entrance = () => {
    const x = Number(config.position?.x);
    const y = Number(config.position?.y);
    if (capri.locked && Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y, floor: Boolean(config.position?.edge) };
    }
    return capri.restSpot();
  };
  applyPosition(config);
  // dropped somewhere new at the bottom of the screen: she rests there from now on
  capri.onHome = (homeX) => host.setConfig({ position: { homeX: Math.round(homeX * 10000) / 10000 } });

  const brain = new Brain({ capri, panel, voice, host, lang: config.lang });

  // Click-through everywhere except on her body, the panel and her biochip.
  let interactive = false;
  let mouse = null;
  let folding = false;
  let foldingAt = 0; // when the fold/unfold started: one that never ends can't hold the screen
  let droneActive = false;
  let lastLive = performance.now();
  const bumpIdle = () => { lastLive = performance.now(); };
  const setInteractive = (on) => {
    if (on === interactive) return;
    interactive = on;
    host.setInteractive(on);
  };
  const onChip = () => Boolean(chip.visible && mouse && chip.contains(mouse.x, mouse.y, 0));
  const refreshHit = () => {
    if (folding || capri.dragging || bubble.dragging || appMenu.visible) return setInteractive(true);
    if (!mouse) return setInteractive(false);
    const r = panel.rect();
    const onPanel = r && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom;
    const onBubble = bubble.hitInput(mouse.x, mouse.y) || bubble.hitGrab(mouse.x, mouse.y);
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
  const drawDrone = (time) => {
    if (!document.getElementById('drone').hidden) {
      drone.update(time, { x: (mouse?.x || innerWidth / 2) / innerWidth * 270, y: (mouse?.y || innerHeight / 2) / innerHeight * 270 });
    }
    requestAnimationFrame(drawDrone);
  };
  requestAnimationFrame(drawDrone);
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

  // Click-through: no mousemove. Poll global cursor (~30 ms) over her head for caresses.
  setInterval(async () => {
    if (config.behavior?.caresses === false || capri.busy || capri.hidden || capri.dragging) return;
    const at = await host.cursor().catch(() => null);
    if (!at?.inside) {
      capri._caressStroke = null;
      return;
    }
    capri.noteCursor(at.x, at.y);
  }, 30);
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

  // wiring
  capri.onMove = (head) => {
    // pointing at something: the panel goes on her other side, so it doesn't cover it
    panel.setAnchor({ ...head, lean: capri.pointing ? -capri.pointing.dir : 0 }, capri.view);
    bubble.setAnchor(head, capri.view);
    // she may have moved out from under a still pointer: never leave a dead click zone behind
    refreshHit();
  };
  capri.onTeleport = (phase) => (phase === 'start' ? panel.suspend() : panel.resume());
  capri.chipAt = () => chip.center();
  capri.onStow = () => {
    chip.setMode(capri.mode);
    chip.show();
  };
  capri.onUnstow = () => chip.hide();
  capri.onDoze = (phase, face) => {
    if (phase === 'start') {
      mask.place(face.x, face.y, capri.scale * 1.1);
      mask.show();
    } else if (phase === 'waking') {
      mask.wake();
    } else {
      mask.hide();
    }
  };
  capri.onCaress = () => {
    if (config.behavior?.caresses === false || capri.busy || capri.hidden) return;
    capri.perform('laugh');
    capri.voice?.play?.('land');
  };
  capri.onMode = (mode, prev) => chip.setMode(mode, prev);
  // now and then she says something about the satellite: while she looks at it, or once
  // the red light has gone up (never during, nothing should cover that)
  capri.onGaze = (when) => {
    const lines = when === 'end' ? brain.t.uplink : brain.t.gaze;
    if (!panel.visible && Math.random() < (when === 'end' ? 0.6 : 0.4)) panel.say({ kind: 'info', line: pick(lines), hold: 3800 });
  };
  capri.onClick = () => {
    if (appMenu.visible) return;
    if (machine.get() === 'TALKING' || machine.get() === 'THINKING') {
      host.interruptVoice();
      return;
    }
    if (bubble.visible) return;
    if (panel.visible) panel.hide();
    else brain.status();
  };
  panel.onChar = (kind) => voice.play('blip', { mood: kind });
  panel.onTalk = (talking) => talking && capri.perform('talk');
  bubble.onTalk = (talking) => talking && capri.perform('talk');
  bubble.onBlip = () => voice.typeBlip();
  bubble.onOpenChange = (open) => {
    if (open) panel.hide();
    refreshHit();
  };
  // the box dragged by its tab: she rides along if she's on it
  bubble.onMoved = () => capri.followBox();
  // you moved her (not onto the box): once she has landed, the box pops over to above her
  capri.onDropped = async () => {
    for (let i = 0; i < 40 && capri.busy; i++) await sleep(50);
    if (!bubble.open || capri.onBox() || capri.dragging) return;
    bubble.popAbove(capri.head());
  };
  bubble.onPerchChange = (phase) => {
    capri.nextMove = Math.min(capri.nextMove, performance.now() + (phase === 'open' ? 4000 : 25000));
  };
  appMenu.onOpenChange = (open) => {
    host.menuOpen(open);
    refreshHit();
  };
  dormant.onOpenChange = () => refreshHit();
  capri.onMenu = (at) => openAppMenu(at?.x ?? capri.head().x, at?.y ?? capri.head().y, capri.bounds());

  let idleMs = Number(config.idle?.dormantAfterMs);
  let glitchFx = config.fx?.glitch !== false;
  dormant.setFx(glitchFx);
  let talkGlitch = 0;
  const useGlitch = () => glitchFx && !reducedMotion.matches;
  const showVhs = (on) => { vhs.hidden = !on; };
  // The screen giving up before the PC goes down (Paso 4G): main waits for it to be over.
  const systemFx = new SystemFx({ reducedMotion });
  let artKitRunning = false;
  const canFold = () => (
    !artKitRunning
    && Number.isFinite(idleMs) && idleMs > 0
    && !folding
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
    if (folding || capri.stowed || machine.get() === 'DORMANT') return;
    if (!force && !canFold()) return;
    folding = true;
    foldingAt = performance.now();
    appMenu.hide();
    panel.hide();
    if (bubble.open) bubble.hide();
    // off to a bottom corner first (FIJO: she stays put), so she wakes up there
    if (!capri.dormant && !capri.busy && !capri.hidden) {
      await capri.goToBed();
      const up = ['THINKING', 'TALKING', 'LISTENING', 'BOOTING'].includes(machine.get());
      if (!force && (up || bubble.open || capri.stowed)) { // something came up on her way there: stay up
        folding = false;
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
    if (!droneActive) {
      dormant.setLabel('DORMANT');
      dormant.show();
    }
    folding = false;
    refreshHit();
  };
  const unfold = async ({ chat = false } = {}) => {
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    if (machine.get() === 'DORMANT') {
      folding = true;
      foldingAt = performance.now();
      refreshHit();
      voice.wakeArp();
      const from = dormant.rect();
      const boot = bubble.boot;
      const next = boot === 'booting' ? 'BOOTING' : boot === 'failed' ? 'OFFLINE' : 'ONLINE';
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
          bubble.birth(from, { animate: true }),
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
        bubble.show();
      }
      folding = false;
    }
    bumpIdle();
    capri.wake();
    refreshHit();
    if (chat && !bubble.open) bubble.show();
  };
  dormant.onWake = () => unfold({ chat: true });
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
  window.addEventListener('keydown', () => { if (bubble.open) bumpIdle(); });
  setInterval(() => {
    if (canFold() && performance.now() - lastLive >= idleMs) fold();
  }, 1000);

  // Her guide (guide.js): her welcome on first launch, and "How does it work?" in her menu,
  // where she takes you to things and points at them.
  const guide = new Guide({ capri, panel, voice, host, brain });
  // the first Claude Code event that ever reaches her: so you know it worked
  brain.linked = config.linked;
  brain.onLinked = () => {
    host.setConfig({ linked: true, welcomed: true });
    voice.play('hello');
    capri.perform('hop');
    panel.say({ kind: 'done', badge: 'LINK', line: brain.t.welcome.linked, hold: 6000 });
  };

  // The demo's second half, after its fake Claude session: everything she does on her own, one
  // after the other, a line before each.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (done, max = 15000) => {
    for (const t0 = Date.now(); !done() && Date.now() - t0 < max;) await wait(100);
  };
  const free = () => !capri.busy && !capri.act && capri.stance !== 'fall';
  brain.onShowcase = async () => {
    const t = brain.t.showcase;
    const caption = (line) => panel.say({ kind: 'info', line, hold: 2200 });
    capri.nextMove = capri.nextGaze = performance.now() + 120000; // nothing of her own in between
    if (capri.stowed) await capri.unstow();
    if (capri.dormant) capri.wake();
    await until(free);
    panel.hide();

    caption(t.minds);
    await wait(1000);
    await capri.perform('split');
    await wait(900);

    caption(t.zap);
    await wait(1000);
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    await wait(1800);

    panel.hide();
    if (capri.gaze({ big: true })) await until(() => !capri.sky);
    await wait(2500);

    // a little terminal opens for her to take over, and closes under her once she's done with it
    if (capri.possessWindows && (await host.demoWindow(true))) {
      const top = () => capri.windows.wins.find((w) => capri.canSit(w)); // it opens on top of everything
      await until(top, 4000);
      const win = top();
      const seat = win && { win, dx: win.w * 0.4 };
      if (seat) {
        panel.hide();
        await capri.sitOn(seat);
        await until(free);
        caption(t.possess);
        await wait(1400);
        panel.hide();
        await capri.possess();
        await wait(1800);
      }
      host.demoWindow(false);
      await wait(400);
      await until(free); // she may have fallen off it
      await wait(900);
    }

    caption(t.sleep);
    await wait(1400);
    panel.hide();
    capri.setMode('sleep');
    await wait(2500); // dozing off
    await capri.doze();
    await wait(4500);
    capri.wake();
    await until(free);
    await wait(1200);

    caption(t.chip);
    await wait(1600);
    panel.hide();
    await capri.stow();
    await wait(3500);
    await capri.unstow();
    await wait(600);
    panel.say({ kind: 'info', line: t.end, hold: 5000 });
  };

  brain.onArtKit = async (evt) => {
    artKitRunning = true;
    try {
      await runArtKit({
        capri, panel, bubble, fx, dormant, drone, mask, chip, host, machine, unfold,
        bumpIdle, shots: Boolean(evt?.shots),
      });
    } finally {
      artKitRunning = false;
    }
  };

  const applyBoot = (state) => {
    // a cloud provider answers, so whether LM Studio came up is nobody's business here (Paso 4K)
    if (config.llm?.provider && config.llm.provider !== 'local') return;
    bubble.setBoot(state);
    if (machine.get() === 'DORMANT') return;
    if (state === 'booting') {
      panel.say({ kind: 'info', badge: 'BOOTING', line: 'Spinning up the local stack. Hold still, choom.', hold: null });
    } else if (state === 'failed') {
      panel.say({
        kind: 'error',
        badge: 'BOOTING',
        line: "Couldn't wake LM Studio. Fire it yourself if you want a brain.",
        hold: 7000,
      });
    } else if (panel.current?.badge === 'BOOTING') {
      panel.hide();
    }
  };
  host.llmStatus().then(applyBoot);
  host.onLlmBoot((payload) => applyBoot(payload?.state || payload));

  host.onChatToken((piece) => {
    bumpIdle();
    bubble.onToken(typeof piece === 'string' ? piece : piece?.text || '');
  });
  host.onChatDone((payload) => bubble.onDone(payload?.text || ''));
  host.onChatError((payload) => bubble.onError(payload));
  host.onVoice(async (evt) => {
    const type = evt?.type;
    if (type === 'listening') {
      bubble.abortForListen();
      bumpIdle();
      await unfold({ chat: true });
      machine.set('LISTENING');
      bubble.setMeter(true);
      if (evt.wake || evt.score != null) {
        const pct = Math.round(Number(evt.score) || 0);
        bubble.note('despierta', `${pct} %`);
      }
      return;
    }
    if (type === 'level') {
      bumpIdle();
      if (bubble.voicePlaying) bubble.voiceAt = Date.now();
      bubble.setLevel(evt.rms);
      return;
    }
    if (type === 'stopped') {
      bubble.setMeter(false);
      if (machine.get() === 'LISTENING' && !bubble.busy) machine.set('ONLINE');
      return;
    }
    if (type === 'transcript') {
      bumpIdle();
      await unfold({ chat: true });
      bubble.submitFromVoice(evt.text, evt.command);
      return;
    }
    if (type === 'talking') {
      bumpIdle();
      clearTimeout(bubble.voiceTimer);
      bubble.voiceTimer = 0;
      bubble.stopThink();
      bubble.voicePlaying = true;
      bubble.voiceAt = Date.now();
      machine.set('TALKING');
      bubble.onTalk?.(true);
      return;
    }
    if (type === 'talking_done') {
      clearTimeout(bubble.voiceTimer);
      bubble.voiceTimer = 0;
      bubble.voicePlaying = false;
      bubble.onTalk?.(false);
      bumpIdle();
      if (evt?.crashed) { // her voice died mid-line: nothing more is coming, back to ONLINE
        if (['TALKING', 'THINKING', 'LISTENING'].includes(machine.get()) && !bubble.busy) machine.set('ONLINE');
        return;
      }
      if (evt?.interrupted) {
        bubble.abortForListen();
        if (machine.get() === 'TALKING' || machine.get() === 'THINKING') machine.set('ONLINE');
        return;
      }
      if (machine.get() === 'LISTENING') return;
      if ((machine.get() === 'TALKING' || machine.get() === 'THINKING') && !bubble.busy) {
        machine.set('ONLINE');
      }
      return;
    }
    if (type === 'tts_state') {
      bubble.setVoiceLoading(evt.state === 'loading');
      return;
    }
    if (type === 'notice') {
      bubble.holdVoice = false;
      bumpIdle();
      await unfold();
      const line = evt.message || 'Voice sidecar is offline. Chat still works.';
      bubble.note('sistema', line);
      panel.say({
        kind: 'error',
        badge: 'VOICE',
        line,
        hold: 10000,
      });
    }
  });

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

  setInterval(() => bubble.watchdog(), 5000); // never stuck in DECRYPTING or TALKING

  // Her menu and her click-through, told to main every 2 s (menu-guard.js): main keeps the window in
  // line with it, and takes the clicks back for the other windows if she stops answering.
  function beat() {
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

  host.onClaudeEvent((evt) => brain.handle(evt));
  brain.onPulse = (evt) => {
    bumpIdle();
    const name = evt?.hook_event_name;
    if (name === 'UserPromptSubmit' || name === 'Notification' || name === 'SessionStart') {
      unfold();
    }
  };
  host.onWindows((data) => {
    capri.setWindows(data);
    brain.onWindows(data);
  });
  // the windows as they are now: the watcher only speaks again when something changes
  host.windowsNow().then((data) => data && capri.setWindows(data));

  host.onResize(({ width, height, gap = 0 }) => {
    floorGap = gap;
    fx.resize(width, height);
    chip.place(width, height - gap);
    dormant.setView(width, height);
    capri.setView(width, height, height - gap);
  });
  window.addEventListener('resize', () => {
    fx.resize(innerWidth, innerHeight);
    chip.place(innerWidth, innerHeight - floorGap);
    dormant.setView(innerWidth, innerHeight);
    capri.setView(innerWidth, innerHeight, innerHeight - floorGap);
  });

  const applyVoiceHold = (cfg) => {
    const kind = String(cfg.voice?.tts || 'off').toLowerCase();
    const mode = String(cfg.voice?.replyMode || 'blips').toLowerCase();
    bubble.replyMode = mode;
    bubble.holdVoice = mode === 'voice' && cfg.voice?.enabled !== false && !cfg.muted && kind !== 'off' && kind !== 'none' && kind !== 'false';
  };
  applyVoiceHold(config);

  host.onConfig((cfg) => {
    Object.assign(config, cfg);
    if (cfg.behavior) config.behavior = { ...config.behavior, ...cfg.behavior };
    voice.configure(cfg);
    applyVoiceHold(cfg);
    applyPosition(cfg);
    appMenu.setTheme(cfg.ui?.theme);
    capri.wander = cfg.wander;
    capri.possessWindows = cfg.possess;
    capri.restOn = cfg.rest || 'taskbar';
    idleMs = Number(cfg.idle?.dormantAfterMs);
    glitchFx = cfg.fx?.glitch !== false;
    dormant.setFx(glitchFx);
    bubble.setFx(cfg.fx?.scanlines !== false);
    if (cfg.ui?.logLines) bubble.setLogLimit(cfg.ui.logLines);
    if (cfg.scale !== capri.scale) capri.setScale(cfg.scale);
    if (cfg.lang !== brain.lang) {
      brain.lang = cfg.lang;
      panel.labels = LINES[cfg.lang] || LINES.fr;
      document.documentElement.lang = cfg.lang;
    }
  });

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
          droneActive = true;
          dormant.hide();
          mask.hide();
          drone.show();
        } else {
          droneActive = false;
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
        mouse = null;
        refreshHit();
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
        panel.say({ kind: 'info', badge: cmd.badge, line: cmd.text, hold: 4600 });
        break;
      case 'quit-ask': // Salir / "ciérrate": Sí / No before she actually quits
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
        panel.onAction = (id) => {
          if (id !== 'quit-yes' && id !== 'quit-no') return;
          host.menuAction({ id: 'quit-answer', value: id === 'quit-yes' ? 'si' : 'no' }).catch(() => {});
          panel.hide();
        };
        break;
      case 'quit-clear':
        if (panel.visible && panel.current?.badge === 'SALIR') panel.hide();
        break;
      case 'wake':
        await unfold();
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

  // entrance: she grabs the screen, says hi, then dives down to her spot
  // (put away last time: she starts in her biochip; fx.intro false: skip the grab)
  if (config.visible === false) capri.stowNow();
  else if (config.fx?.intro !== false && intro) await capri.intro(entrance());
  else await capri.materialize(entrance());
  bumpIdle();
  const hello = async () => {
    const greet = await host.greet();
    panel.say({ kind: 'info', badge: 'ONLINE', line: greet?.text || pick(brain.t.online), hold: 6000 });
  };
  if (config.guide?.welcome) {
    const hooks = await host.hooksStatus();
    if (!config.welcomed || !hooks.installed) guide.welcome();
    else await hello();
  } else if ((await host.llmStatus()) !== 'booting') {
    await hello();
  }
}

boot().catch((err) => {
  console.error('[capri] boot failed', err);
});
