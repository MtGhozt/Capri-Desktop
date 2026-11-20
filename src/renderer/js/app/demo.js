// Demo showcase sequence (after a fake Claude session) and the Playwright E2E hook.

export function wireDemo({
  host,
  brain,
  capri,
  panel,
  bubble,
  appMenu,
  config,
  ptr,
  fold,
  unfold,
}) {
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

  // Playwright E2E (fresh profile): drive menu / faults without fighting OS click-through.
  if (!config.e2e) return;
  const { openAppMenu, forceFree, setInteractive } = ptr;
  window.__capriE2E = {
    openMenu: (x = Math.round(innerWidth / 2), y = Math.round(innerHeight / 2)) => {
      openAppMenu(x, y);
    },
    forceFree,
    interactive: () => ptr.interactive,
    setInteractive: (on) => setInteractive(Boolean(on)),
    pos: () => ({ x: capri.pos.x, y: capri.pos.y }),
    throwError: () => { setTimeout(() => { throw new Error('e2e-sync'); }, 0); },
    reject: () => { Promise.reject(new Error('e2e-reject')); },
    sleep: () => fold({ force: true }),
    wake: () => unfold(),
    openChat: () => unfold({ chat: true }),
    caress: () => capri.onCaress?.(),
    sendChat: (text) => host.sendChat(text),
    menuVisible: () => Boolean(appMenu.visible),
    menuHidden: () => Boolean(appMenu.el.hidden),
    // Message-box "window": Capri on the bubble; tab must be interactive on first open.
    perchOnBox: async () => {
      await capri.perchOnBox('lieA');
      return { onBox: capri.onBox(), interactive: ptr.interactive };
    },
    bubblePos: () => (bubble.at ? { left: bubble.at.left, top: bubble.at.top } : null),
    dragBubbleBy: (dx, dy) => {
      if (!bubble.open || !bubble.at) return null;
      const from = { left: bubble.at.left, top: bubble.at.top };
      bubble.moveTo({ left: from.left + dx, top: from.top + dy });
      return { from, to: { left: bubble.at.left, top: bubble.at.top }, interactive: ptr.interactive };
    },
    clickThroughOk: () => {
      // Fail-closed for E2E: folding stuck or menu drawn while closed = bad.
      if (ptr.folding && performance.now() - ptr.foldingAt > 3000) return false;
      if (!appMenu.visible && !appMenu.el.hidden) return false;
      return true;
    },
    pressEsc: () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      appMenu.hide({ force: true });
      forceFree();
    },
    dragBy: (dx, dy) => {
      const from = { x: capri.pos.x, y: capri.pos.y };
      capri.pos = { x: from.x + dx, y: from.y + dy };
      capri.pivot?.();
      capri.onMove?.(capri.head());
      return { from, to: { ...capri.pos } };
    },
  };
}
