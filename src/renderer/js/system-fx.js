// The screen giving up before a shutdown, restart or suspend (Paso 4G): her red-violet scanlines
// spread over the whole screen, everything shakes and splits in RGB while ERROR / SYSTEM FAILURE /
// CAPRI.SYS flicker, then an old CRT switches off: the picture collapses to a line, then a dot,
// then black. play() settles when it's over; stop() drops it at once (cancelled).

const WORDS = ['ERROR', 'SYSTEM FAILURE', 'CAPRI.SYS', 'ERR_0xC4PR1', 'SYSTEM FAILURE', 'CAPRI.SYS // HALT'];

export class SystemFx {
  constructor({ root = document.body, reducedMotion = { matches: false } } = {}) {
    this.root = root;
    this.reducedMotion = reducedMotion;
    this.el = null;
    this.timers = [];
    this.anims = [];
    this.run = 0;
  }

  get active() { return Boolean(this.el); }

  // ms: the whole show (fall + power-off). Resolves true when it played to the end.
  async play({ ms = 3600 } = {}) {
    this.stop();
    if (this.reducedMotion.matches) return true;
    const run = ++this.run;
    const el = document.createElement('div');
    el.className = 'sysfx';
    el.innerHTML = '<div class="sysfx__screen"><div class="sysfx__stripes"></div>'
      + '<div class="sysfx__text"></div><div class="sysfx__dot" hidden></div></div>';
    this.root.append(el);
    this.el = el;
    const screen = el.querySelector('.sysfx__screen');
    const stripes = el.querySelector('.sysfx__stripes');
    const text = el.querySelector('.sysfx__text');
    const dot = el.querySelector('.sysfx__dot');

    const spread = Math.round(ms * 0.28);
    const glitch = Math.round(ms * 0.5);
    const crt = ms - spread - glitch;
    const live = () => run === this.run;
    const wait = (t) => new Promise((resolve) => { this.timers.push(setTimeout(resolve, t)); });
    const anim = (node, frames, opts) => {
      const a = node.animate(frames, { fill: 'forwards', ...opts });
      this.anims.push(a);
      return a.finished.catch(() => {});
    };

    // c. the stripes spread from a band in the middle to the whole screen
    await anim(stripes, [
      { transform: 'scaleY(0.04)', opacity: 0.2 },
      { transform: 'scaleY(0.5)', opacity: 0.7, offset: 0.55 },
      { transform: 'scaleY(1)', opacity: 1 },
    ], { duration: spread, easing: 'cubic-bezier(.2,.7,.3,1)' });
    if (!live()) return false;

    // ...then shakes, splits and flickers
    el.classList.add('is-glitch');
    const steps = Math.max(6, Math.round(glitch / 70));
    const shake = [];
    for (let i = 0; i <= steps; i += 1) {
      const k = 1 - (i / steps) * 0.3;
      const x = (Math.random() * 2 - 1) * 14 * k;
      const y = (Math.random() * 2 - 1) * 8 * k;
      const split = (2 + Math.random() * 7) * k;
      shake.push({
        transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) skewX(${((Math.random() * 2 - 1) * 3).toFixed(1)}deg)`,
        filter: `drop-shadow(${split.toFixed(1)}px 0 rgba(255,0,80,.75)) drop-shadow(${(-split).toFixed(1)}px 0 rgba(0,255,255,.6))`,
        easing: 'steps(1, end)',
      });
    }
    const shaking = anim(screen, shake, { duration: glitch });
    const flick = Math.max(60, Math.round(glitch / 14));
    for (let t = 0, i = 0; t < glitch; t += flick, i += 1) {
      this.timers.push(setTimeout(() => {
        if (!live()) return;
        const word = WORDS[(i + Math.floor(Math.random() * 2)) % WORDS.length];
        text.textContent = word;
        text.dataset.text = word;
        text.style.opacity = Math.random() < 0.2 ? '0.15' : '1';
        text.style.transform = `translate(-50%, -50%) translateX(${Math.round((Math.random() * 2 - 1) * 18)}px)`;
      }, t));
    }
    await shaking;
    if (!live()) return false;

    // d. CRT off: a white flash, the picture collapses to a line, the line to a dot, then black
    el.classList.remove('is-glitch');
    el.classList.add('is-crt');
    text.textContent = '';
    const toLine = Math.round(crt * 0.45);
    const toDot = Math.round(crt * 0.3);
    const fade = crt - toLine - toDot;
    await anim(screen, [
      { transform: 'scale(1, 1)', filter: 'brightness(1)' },
      { transform: 'scale(1, 0.006)', filter: 'brightness(3)' },
    ], { duration: toLine, easing: 'cubic-bezier(.7,0,.9,.4)' });
    if (!live()) return false;
    await anim(screen, [
      { transform: 'scale(1, 0.006)' },
      { transform: 'scale(0.004, 0.006)' },
    ], { duration: toDot, easing: 'cubic-bezier(.6,0,.9,.5)' });
    if (!live()) return false;
    screen.style.visibility = 'hidden';
    dot.hidden = false;
    el.append(dot);
    await anim(dot, [{ opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }, { opacity: 0, transform: 'translate(-50%, -50%) scale(0.2)' }], { duration: fade });
    if (!live()) return false;
    // black until the PC goes down, or until main gives the screen back (clear), at most 15 s
    this.timers.push(setTimeout(() => { if (live()) this.clear(); }, 15000));
    return true;
  }

  // cancelled: drop it now
  stop() {
    this.run += 1;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const a of this.anims) { try { a.cancel(); } catch { /* gone */ } }
    this.anims = [];
    this.el?.remove();
    this.el = null;
  }

  // preview over, a command that failed, or back from sleep
  clear() { this.stop(); }
}
