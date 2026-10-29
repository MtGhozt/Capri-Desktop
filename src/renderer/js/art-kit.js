'use strict';

// Artist handoff reel: every pose / face / FX in order with a caption. Driven by CapriArtKit
// (scripts/demo-art.js). Sleep / mask / DORMANT run last so earlier steps stay awake.

import { sleep } from './util.js';

const HOLD = 4000;
const FACES = ['calm', 'aside', 'smug', 'wide', 'look', 'laugh', 'many', 'grin'];
const BOX_POSES = ['lieA', 'lieB', 'stand', 'sit'];
const WIN_POSES = ['sit', 'lieA', 'lieB'];

function ensureCaption() {
  let el = document.getElementById('art-caption');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'art-caption';
  el.setAttribute('aria-live', 'polite');
  Object.assign(el.style, {
    position: 'fixed', left: '16px', bottom: '16px', zIndex: '9999',
    maxWidth: 'min(520px, 70vw)', padding: '8px 12px',
    font: '600 13px "JetBrains Mono", Consolas, monospace',
    color: '#e8fdff', background: 'rgba(0,0,0,0.78)',
    border: '1px solid #3de0ff', borderRadius: '2px',
    pointerEvents: 'none', letterSpacing: '0.04em',
  });
  document.body.appendChild(el);
  return el;
}

export async function runArtKit({
  capri, panel, bubble, fx, dormant, drone, mask, chip, host, machine, unfold, bumpIdle, shots = false,
}) {
  const captionEl = ensureCaption();
  const free = () => !capri.busy && !capri.act && capri.stance !== 'fall'
    && !capri.dormant && !capri.hidden && !capri.stowed;
  const until = async (done, max = 12000) => {
    for (const t0 = Date.now(); !done() && Date.now() - t0 < max;) await sleep(80);
  };
  // Same path as a real wake: unfold (DORMANT widget) + await rouse (mask doze).
  const ensureAwake = async () => {
    bumpIdle?.();
    if (machine?.get?.() === 'DORMANT' && typeof unfold === 'function') {
      await unfold();
    }
    if (capri.dormant) await capri.rouse();
    else capri.wake();
    if (capri.stowed) await capri.unstow();
    capri.setHidden(false);
    dormant.hide();
    mask.hide();
    drone.hide();
    await until(free, 15000);
    bumpIdle?.();
  };

  let stepNo = 0;
  const label = (text) => {
    captionEl.hidden = false;
    captionEl.textContent = text;
  };
  const snap = async (name, frames = 1) => {
    if (!shots || !host.artCapture) return;
    const n = Math.max(1, frames);
    for (let i = 0; i < n; i++) {
      const suffix = n > 1 ? `-f${i}` : '';
      await host.artCapture(`${String(stepNo).padStart(2, '0')}-${name}${suffix}`);
      if (i < n - 1) await sleep(180);
    }
  };
  const beat = async (id, text, { frames = 1, ms = HOLD } = {}) => {
    bumpIdle?.();
    stepNo += 1;
    label(`${String(stepNo).padStart(2, '0')} · ${text}`);
    await snap(id, frames);
    await sleep(ms);
    bumpIdle?.();
  };

  capri.nextMove = capri.nextGaze = performance.now() + 600_000;
  await ensureAwake();
  if (typeof chip.hide === 'function') chip.hide();
  panel.hide();
  await until(free);

  // --- intro ---
  await beat('intro', 'Intro (agarra la pantalla)', { frames: 6, ms: 500 });
  const introAt = { x: Math.round(innerWidth * 0.55), y: capri.floor };
  await capri.intro(introAt, { label: 'hi', caption: 'ART KIT' });
  await until(free);
  await sleep(800);

  // --- box poses ---
  bubble.anchor = { x: capri.pos.x, y: capri.pos.y };
  bubble.show();
  await sleep(400);
  for (const pose of BOX_POSES) {
    await capri.perchOnBox(pose);
    await until(free);
    const frames = pose === 'lieA' || pose === 'lieB' ? 5 : 4;
    await beat(`pose-box-${pose}`, `Pose caja: ${pose}`, { frames, ms: HOLD });
  }
  bubble.hide();
  await until(free);

  // --- window poses ---
  if (await host.demoWindow(true)) {
    const top = () => capri.windows.wins.find((w) => capri.canSit(w));
    await until(top, 4000);
    const win = top();
    if (win) {
      for (const pose of WIN_POSES) {
        const dx = Math.min(Math.max(win.w * 0.4, 60), win.w - 60);
        const stance = pose === 'sit' ? 'sit' : 'lie';
        await capri.teleport(capri.windowSeat(win, dx, pose), {
          stance, perch: { id: win.id, dx, pose }, face: capri.facing,
        });
        await until(free);
        await beat(`pose-window-${pose}`, `Pose ventana: ${pose}`, { frames: 5, ms: HOLD });
      }
    }
    host.demoWindow(false);
    await sleep(400);
    await until(free);
  }

  // --- faces (panel portrait) ---
  for (const face of FACES) {
    panel.say({ kind: 'info', face, line: `Cara: ${face}`, hold: HOLD + 500 });
    if (capri.p) capri.p.face = face === 'grin' ? 'calm' : face;
    await beat(`face-${face}`, `Expresión / cara: ${face}`, { frames: 2, ms: HOLD });
  }
  panel.hide();

  // --- cut-ins ---
  for (const kind of ['grin', 'laugh', 'eyes', 'many', 'look']) {
    const [x, y, dir] = capri.cutinAt(capri.towardCenter());
    fx.cutin(x, y, dir, { kind, life: HOLD });
    await beat(`cutin-${kind}`, `Cut-in: ${kind}`, { frames: 3, ms: HOLD });
  }

  // --- talking + blips ---
  bubble.replyMode = 'blips';
  bubble.show();
  bubble.busy = true;
  bubble.replyText = '';
  bubble.typed = '';
  bubble.setLine('');
  bubble.onTalk?.(true);
  capri.perform('talk');
  const talkLine = 'Hola choom — blips de tipeo para el kit de arte.';
  bubble.typeToward(talkLine, { finish: true });
  await beat('talking-blips', 'Hablar + blips de tipeo', { frames: 5, ms: HOLD + 1200 });
  bubble.onTalk?.(false);
  bubble.busy = false;
  bubble.hide();
  await until(free);

  // --- satellite / stars ---
  if (capri.gaze({ big: true })) {
    await beat('satellite', 'Satélite / estrellas (acting)', { frames: 6, ms: 2000 });
    await until(() => !capri.sky, 20000);
  } else {
    await beat('satellite', 'Satélite / estrellas (acting)', { frames: 4, ms: HOLD });
  }
  await until(free);

  // --- sparks / beams ---
  const h = capri.head();
  capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
  await beat('fx-zap', 'FX: rayo / zap', { frames: 5, ms: HOLD });
  await until(free);
  await capri.perform('split');
  await beat('fx-split', 'FX: split / chispas', { frames: 4, ms: HOLD });
  await until(free);

  // --- game drone ---
  dormant.hide();
  drone.show();
  await beat('drone', 'Dron modo juego', { frames: 5, ms: HOLD });
  drone.hide();

  // --- dancing ---
  await capri.perform('spin', capri.towardCenter());
  await beat('dance', 'Bailar / spin', { frames: 5, ms: HOLD });
  await until(free);
  await capri.flourish();
  await beat('flourish', 'Flourish (bailar música)', { frames: 4, ms: HOLD });
  await until(free);

  // --- greeting ---
  const greet = await host.greet?.();
  panel.say({
    kind: 'info', badge: 'ONLINE',
    line: greet?.text || 'Capri online. Hola, choom.',
    hold: HOLD + 500,
  });
  await beat('greeting', 'Saludo', { frames: 3, ms: HOLD });
  panel.hide();

  // --- ignored (line only; fold is the sleep block below) ---
  panel.say({
    kind: 'idle', face: 'aside',
    line: 'Me ignoras… me pliego al widget.',
    hold: HOLD,
  });
  await beat('ignored', 'Reacción al ser ignorada', { frames: 3, ms: HOLD });
  panel.hide();

  // --- teleport / Hacer algo ---
  await capri.teleport(capri.spot('random'));
  await until(free);
  await beat('teleport', 'Teletransporte', { frames: 4, ms: HOLD });
  capri.flourish();
  await beat('hacer-algo', 'Hacer algo (flourish)', { frames: 4, ms: HOLD });
  await until(free);

  // --- dragging ---
  label(`${String(stepNo + 1).padStart(2, '0')} · Arrastrar`);
  stepNo += 1;
  const start = { ...capri.pos };
  capri.dragging = true;
  capri.setStance('stand');
  capri.p.glitch = 0.18;
  capri.p.split = 2;
  await snap('dragging', 5);
  for (let i = 0; i < 12; i++) {
    capri.pos = {
      x: start.x + i * 18,
      y: start.y - Math.sin(i / 3) * 40,
    };
    capri.place();
    await sleep(90);
  }
  capri.dragging = false;
  capri.p.glitch = 0;
  capri.p.split = 0;
  if (typeof capri.drop === 'function') capri.drop();
  await sleep(HOLD / 2);
  await until(free);

  // --- sleep / mask / biochip / DORMANT last (wake fully between each) ---
  await capri.setMode('sleep');
  await sleep(1200);
  await capri.doze();
  await beat('mask-sleep', 'Máscara dormida', { frames: 4, ms: HOLD });
  await ensureAwake();

  await capri.stow();
  await beat('biochip', 'Biochip (stow)', { frames: 4, ms: HOLD });
  await ensureAwake();

  dormant.setLabel('DORMANT');
  dormant.show();
  capri.dormant = true;
  capri.setHidden(true);
  machine?.set?.('DORMANT');
  host.setFolded?.(true);
  await beat('dormant', 'DORMANT (ojo / sleep)', { frames: 4, ms: HOLD });
  await ensureAwake();

  captionEl.textContent = 'FIN · kit de arte listo';
  await sleep(1500);
  captionEl.hidden = true;
  try {
    await host.menuAction({ id: 'quit' });
  } catch {
    /* parent script may kill the process */
  }
}
