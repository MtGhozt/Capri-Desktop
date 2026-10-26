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

async function boot() {
  const [config, image, intro, ...cutins] = await Promise.all([
    host.getConfig(),
    loadImage('../../assets/capri/capri-full.png'),
    Promise.all(GRAB_FRAMES.map((name) => loadImage(`../../assets/capri/intro-${name}.webp`).catch(() => null)))
      .then((cels) => (cels[0] ? Object.fromEntries(GRAB_FRAMES.map((name, i) => [name, cels[i]])) : null)),
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
  const chip = new Chip(document.getElementById('chip'));
  chip.place(innerWidth, innerHeight);
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
  const appMenu = new AppMenu({
    el: document.getElementById('app-menu'),
    host,
    folded: () => machine.get() === 'DORMANT',
  });
  const dormant = new DormantWidget({ el: document.getElementById('dormant'), host });
  const vhs = document.getElementById('vhs');
  dormant.loadPos(config.idle?.widget, innerWidth, innerHeight);

  const capri = new Capri({
    root: document.getElementById('capri'),
    canvas: document.getElementById('sprite'),
    image,
    fx,
    voice,
  });
  capri.wander = config.wander;
  capri.possessWindows = config.possess;
  capri.setScale(config.scale);

  const brain = new Brain({ capri, panel, voice, host, lang: config.lang });

  // Click-through everywhere except on her body, the panel and her biochip.
  let interactive = false;
  let mouse = null;
  let folding = false;
  let lastLive = performance.now();
  const bumpIdle = () => { lastLive = performance.now(); };
  const setInteractive = (on) => {
    if (on === interactive) return;
    interactive = on;
    host.setInteractive(on);
  };
  const onChip = () => Boolean(chip.visible && mouse && chip.contains(mouse.x, mouse.y, 0));
  const refreshHit = () => {
    if (folding || capri.dragging || appMenu.visible) return setInteractive(true);
    if (!mouse) return setInteractive(false);
    const r = panel.rect();
    const onPanel = r && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom;
    const b = bubble.rect();
    const onBubble = b && mouse.x >= b.left && mouse.x <= b.right && mouse.y >= b.top && mouse.y <= b.bottom;
    const m = appMenu.rect();
    const onMenu = m && mouse.x >= m.left && mouse.x <= m.right && mouse.y >= m.top && mouse.y <= m.bottom;
    const onDormant = dormant.contains(mouse.x, mouse.y);
    document.body.style.cursor = (onChip() || onDormant) ? 'pointer' : '';
    return setInteractive(Boolean(onPanel || onBubble || onMenu || onDormant || capri.hit(mouse.x, mouse.y) || onChip()));
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
  window.addEventListener('mousemove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    refreshHit();
    hoverChip();
    if (interactive) bumpIdle();
  });
  document.addEventListener('mouseleave', () => {
    mouse = null;
    refreshHit();
    hoverChip();
  });
  const menuAvoid = (x, y) => {
    if (dormant.contains(x, y)) return dormant.rect();
    if (chip.visible && chip.contains(x, y, 0)) {
      return { left: chip.x, top: chip.y, right: chip.x + chip.w, bottom: chip.y + chip.h };
    }
    if (!capri.hidden && capri.p.alpha >= 0.5) return capri.bounds();
    return { left: x, top: y, right: x, bottom: y };
  };
  const openAppMenu = (x, y, avoid) => {
    setInteractive(true);
    appMenu.show(x, y, avoid || menuAvoid(x, y));
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
  bubble.onOpenChange = (open) => {
    if (open) panel.hide();
    refreshHit();
  };
  appMenu.onOpenChange = () => refreshHit();
  dormant.onOpenChange = () => refreshHit();
  capri.onMenu = (at) => openAppMenu(at?.x ?? capri.head().x, at?.y ?? capri.head().y, capri.bounds());

  let idleMs = Number(config.idle?.dormantAfterMs);
  let glitchFx = config.fx?.glitch !== false;
  dormant.setFx(glitchFx);
  let talkGlitch = 0;
  const useGlitch = () => glitchFx && !reducedMotion.matches;
  const showVhs = (on) => { vhs.hidden = !on; };
  const canFold = () => (
    Number.isFinite(idleMs) && idleMs > 0
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
    appMenu.hide();
    panel.hide();
    if (bubble.open) bubble.hide();
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
    dormant.setLabel('DORMANT');
    dormant.show();
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
      refreshHit();
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

  const applyBoot = (state) => {
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
  host.onChatError(() => bubble.onError());
  host.onVoice(async (evt) => {
    const type = evt?.type;
    if (type === 'listening') {
      bubble.abortForListen();
      bumpIdle();
      await unfold({ chat: true });
      machine.set('LISTENING');
      bubble.setMeter(true);
      return;
    }
    if (type === 'level') {
      bumpIdle();
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
      bubble.submitFromVoice(evt.text);
      return;
    }
    if (type === 'talking') {
      bumpIdle();
      clearTimeout(bubble.voiceTimer);
      bubble.voiceTimer = 0;
      bubble.stopThink();
      bubble.voicePlaying = true;
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
    if (type === 'notice') {
      bubble.holdVoice = false;
      bumpIdle();
      await unfold();
      panel.say({
        kind: 'error',
        badge: 'VOICE',
        line: evt.message || 'Voice sidecar is offline. Chat still works.',
        hold: 10000,
      });
    }
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

  host.onResize(({ width, height }) => {
    fx.resize(width, height);
    chip.place(width, height);
    dormant.setView(width, height);
    capri.setView(width, height);
  });
  window.addEventListener('resize', () => {
    fx.resize(innerWidth, innerHeight);
    chip.place(innerWidth, innerHeight);
    dormant.setView(innerWidth, innerHeight);
    capri.setView(innerWidth, innerHeight);
  });

  const applyVoiceHold = (cfg) => {
    const kind = String(cfg.voice?.tts || 'kokoro').toLowerCase();
    bubble.holdVoice = cfg.voice?.enabled !== false && !cfg.muted && kind !== 'off' && kind !== 'none' && kind !== 'false';
  };
  applyVoiceHold(config);

  host.onConfig((cfg) => {
    voice.configure(cfg);
    applyVoiceHold(cfg);
    capri.wander = cfg.wander;
    capri.possessWindows = cfg.possess;
    idleMs = Number(cfg.idle?.dormantAfterMs);
    glitchFx = cfg.fx?.glitch !== false;
    dormant.setFx(glitchFx);
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
      case 'stow': // Ctrl+Alt+C: into her biochip, or back out
        if (cmd.on) {
          bubble.hide({ fromHost: true });
          dormant.hide();
          if (machine.get() === 'DORMANT') machine.set('ONLINE');
          host.setFolded(false);
          capri.stow();
        } else capri.unstow();
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
  else if (config.fx?.intro !== false && intro) await capri.intro(capri.spot('post'));
  else await capri.materialize(capri.spot('post'));
  bumpIdle();
  if (config.guide?.welcome) {
    const hooks = await host.hooksStatus();
    if (!config.welcomed || !hooks.installed) guide.welcome();
    else panel.say({ kind: 'info', line: pick(brain.t.online), hold: 4000 });
  } else if ((await host.llmStatus()) !== 'booting') {
    panel.say({ kind: 'info', line: pick(brain.t.online), hold: 4000 });
  }
}

boot().catch((err) => {
  console.error('[capri] boot failed', err);
});
