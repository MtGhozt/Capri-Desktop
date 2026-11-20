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
import { pick, sleep, reducedMotion } from './util.js';
import { createPetTaps, shouldPlayPetPurr } from './pet-taps.js';
import { wirePointer, wireFold } from './app/pointer.js';
import { wireVoiceEvents } from './app/voice-events.js';
import { wireCommands } from './app/commands.js';
import { wireDemo } from './app/demo.js';

const host = window.host;

const rendererError = (kind, value) => {
  const message = value instanceof Error ? (value.stack || value.message) : String(value || '');
  if (message) host.rendererLog?.({ kind, message });
};
const logStartup = (message) => host.rendererLog?.({ kind: 'startup', message: `${Math.round(performance.now())}ms ${message}` });
const nativeConsoleError = console.error.bind(console);
console.error = (...args) => {
  nativeConsoleError(...args);
  rendererError('console.error', args.map((arg) => (
    arg instanceof Error ? (arg.stack || arg.message) : String(arg)
  )).join(' '));
};

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
    // menu uses Rajdhani with font-display:block — preload or the plate paints empty until the face loads
    document.fonts.load('500 14px "Rajdhani"'),
    document.fonts.load('600 14px "Rajdhani"'),
    document.fonts.load('700 14px "Rajdhani"'),
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
  // Same about.version as Acerca de (menu:get → app.getVersion())
  host.getMenu({ folded: true, light: true }).then((state) => {
    const ver = String(state?.about?.version || '').replace(/^v/i, '').trim();
    if (ver) bubble.setVersion(`v${ver}`);
  }).catch(() => {});
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
  capri.onStartupLog = logStartup;
  capri.drawFrame();
  logStartup(`startup renderer first render rootOpacity=${getComputedStyle(capri.root).opacity} rootClass=${capri.root.className} alpha=${capri.p.alpha} render=${config.render}`);

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

  const ptr = wirePointer({
    host, chip, mask, capri, panel, bubble, appMenu, dormant, drone, config, rendererError,
  });
  const {
    bumpIdle, setInteractive, refreshHit, openAppMenu, ensureDroneLoop,
  } = ptr;

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
  const petTaps = createPetTaps();
  capri.onCaress = () => {
    if (config.behavior?.caresses === false || capri.busy || capri.hidden) return;
    if (petTaps.tap() === 'annoyed') {
      host.menuAction({ id: 'pet-annoyed' }).catch(() => {});
      return;
    }
    // 'laugh' is a cut-in face / victory cue, not an ACTS name — hop is the playful beat.
    capri.perform('hop');
    capri.voice?.play?.('land');
    if (shouldPlayPetPurr({ muted: config.muted, replyMode: config.voice?.replyMode })) {
      voice.play('purr');
    }
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
  // main keeps one truth for the chat toggle: every open/close is reported, with who did it
  let chatSource = 'overlay';
  bubble.onOpenChange = (open) => {
    window.host.chatVisible?.(open, chatSource);
    chatSource = 'overlay'; // a close after this has no opener to blame
    if (open) {
      panel.hide();
      // First entry after launch: enable hit-testing before any mousemove (tab drag).
      setInteractive(true);
    }
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

  // The screen giving up before the PC goes down (Paso 4G): main waits for it to be over.
  const systemFx = new SystemFx({ reducedMotion });
  let artKitRunning = false;
  const { fold, unfold, setIdleMs, setGlitchFx } = wireFold({
    host, ptr, capri, panel, bubble, appMenu, dormant, mask, voice, machine, brain, vhs, config,
    setChatSource: (v) => { chatSource = v; },
    isArtKitRunning: () => artKitRunning,
  });

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

  wireDemo({
    host, brain, capri, panel, bubble, appMenu, config, ptr, fold, unfold,
  });

  brain.onArtKit = async (evt) => {
    artKitRunning = true;
    try {
      await runArtKit({
        capri, panel, bubble, fx, dormant, drone, mask, chip, host, machine, unfold,
        bumpIdle, ensureDroneLoop, shots: Boolean(evt?.shots),
      });
    } finally {
      artKitRunning = false;
    }
  };

  wireVoiceEvents({
    host, config, bubble, panel, machine, bumpIdle, unfold,
  });

  setInterval(() => bubble.watchdog(), 5000); // never stuck in DECRYPTING or TALKING

  wireCommands({
    host, config, capri, panel, bubble, appMenu, dormant, mask, chip, drone, fx,
    machine, brain, guide, systemFx, ptr, fold, unfold, ensureDroneLoop,
  });

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
    setIdleMs(cfg.idle?.dormantAfterMs);
    setGlitchFx(cfg.fx?.glitch !== false);
    bubble.setFx(cfg.fx?.scanlines !== false);
    if (cfg.ui?.logLines) bubble.setLogLimit(cfg.ui.logLines);
    if (cfg.scale !== capri.scale) capri.setScale(cfg.scale);
    if (cfg.lang !== brain.lang) {
      brain.lang = cfg.lang;
      panel.labels = LINES[cfg.lang] || LINES.fr;
      document.documentElement.lang = cfg.lang;
    }
  });

  // entrance: she grabs the screen, says hi, then dives down to her spot
  // (put away last time: she starts in her biochip; fx.intro false: skip the grab)
  logStartup(`startup intro start rootOpacity=${getComputedStyle(capri.root).opacity} rootClass=${capri.root.className} alpha=${capri.p.alpha}`);
  await capri.intro(entrance());
  bumpIdle();
  const hello = async () => {
    const greet = await host.greet();
    if (greet?.skipped) return; // missed reminders own the bubble: no ONLINE fallback over them
    panel.say({ kind: 'info', badge: 'ONLINE', line: greet?.text || pick(brain.t.online), hold: 6000 });
  };
  if (config.guide?.welcome) {
    const hooks = await host.hooksStatus();
    if (!config.welcomed && !config.userName) await guide.askName(); // once, on the very first run
    if (!config.welcomed || !hooks.installed) await guide.welcome();
    else await hello();
  } else if ((await host.llmStatus()) !== 'booting') {
    await hello();
  }
  if (!config.guide?.extras) {
    await guide.extras();
    config.guide = { ...config.guide, extras: true };
  }
  // after an update only: one bubble with what changed in this version
  // never over a pending Salir confirm: it would replace Sí/No and the window couldn't close
  if (config.whatsNew?.length && !ptr.quitConfirm) {
    panel.say({ kind: 'info', badge: 'NUEVO', line: config.whatsNew.join(' '), hold: 9000 });
  }
}

boot().catch((err) => {
  console.error('[capri] boot failed', err);
});
