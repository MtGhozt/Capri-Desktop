'use strict';

// Public-user smoke: fresh profile, no voice, no keys, no LM Studio.
// Goal: never leave a frozen / unclosable Capri on someone's desktop.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { launchCapri, assertNoFatal } = require('./harness');

// One Electron at a time: concurrent launches fight over GPU / tray / global shortcuts.
describe('e2e smoke', { concurrency: 1 }, () => {
test('smoke: launch, menu, caress/drag/chat, recovery, Salir→Sí exits', async (t) => {
  const app = await launchCapri({ settleMs: 3000 });
  t.after(async () => {
    try { await app.close(); } catch { /* already quit mid-test */ }
  });

  const { win, electronApp, errors } = app;

  // --- boot: overlay up, no fatal renderer errors in the settle window ---
  assert.equal(await win.title(), 'Capri');
  assert.ok(await win.evaluate(() => Boolean(window.__capriE2E)));
  {
    const fatal = assertNoFatal(errors);
    assert.deepEqual(fatal, [], `boot errors: ${fatal.join(' | ')}`);
  }

  // --- right-click menu: every safe top-level row is clickable; Esc closes ---
  await app.e2e(() => window.__capriE2E.openMenu());
  assert.equal(await app.e2e(() => window.__capriE2E.menuVisible()), true);

  const rowCount = await win.locator('.appmenu__quick-row').count();
  assert.ok(rowCount >= 8, `expected quick rows, got ${rowCount}`);
  // Skip native dialogs / settings window / quit (quit has its own exit check).
  const skipIdx = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('.appmenu__quick-row')];
    return rows.map((el, i) => (/Salir|Guardar clip|Ajustes|Corregir/i.test(el.textContent || '') ? i : -1)).filter((i) => i >= 0);
  });

  for (let i = 0; i < rowCount; i++) {
    if (skipIdx.includes(i)) continue;
    await app.e2e(() => window.__capriE2E.openMenu());
    await win.locator('.appmenu__quick-row').nth(i).click({ timeout: 5000 });
    await app.e2e(() => window.__capriE2E.pressEsc());
    // Settings / submenu may have closed the plate; reopen path must stay healthy.
    assert.equal(await app.e2e(() => window.__capriE2E.clickThroughOk()), true, `overlay stuck after row ${i}`);
    await app.e2e(() => {
      window.__capriE2E.pressEsc();
      try { window.host.closeSettings(); } catch { /* */ }
    });
  }

  await app.e2e(() => window.__capriE2E.openMenu());
  await app.e2e(() => window.__capriE2E.pressEsc());
  assert.equal(await app.e2e(() => window.__capriE2E.menuVisible()), false);

  // --- drag / caress / sleep-wake / chat with no provider ---
  const moved = await app.e2e(() => window.__capriE2E.dragBy(40, -20));
  assert.ok(moved.to.x !== moved.from.x || moved.to.y !== moved.from.y);
  await app.e2e(() => window.__capriE2E.caress());
  await app.e2e(async () => { await window.__capriE2E.sleep(); });
  await win.waitForTimeout(800);
  await app.e2e(async () => { await window.__capriE2E.wake(); });
  await win.waitForTimeout(800);

  await app.e2e(async () => { await window.__capriE2E.openChat(); });
  await win.waitForSelector('.bubble__field', { state: 'visible', timeout: 10_000 });
  const chatErr = [];
  await win.evaluate(() => {
    window.__capriChatErr = null;
    window.host.onChatError((payload) => { window.__capriChatErr = payload; });
  });
  await win.fill('.bubble__field', 'hola choom');
  await win.press('.bubble__field', 'Enter');
  await win.waitForFunction(() => window.__capriChatErr, null, { timeout: 15_000 });
  const errPayload = await win.evaluate(() => window.__capriChatErr);
  assert.ok(errPayload, 'expected friendly chat error with no provider');
  assert.ok(
    /LM Studio|modelo|clave|offline|despertar/i.test(JSON.stringify(errPayload)),
    `unexpected error payload: ${JSON.stringify(errPayload)}`,
  );
  {
    const fatal = assertNoFatal(errors);
    assert.deepEqual(fatal, [], `post-chat crash: ${fatal.join(' | ')}`);
  }

  // --- voice sidecar already off in seed; app still interactive ---
  assert.equal(await app.e2e(() => window.__capriE2E.clickThroughOk()), true);

  // --- simulated renderer exception + rejection → forceFree, menu still works ---
  await app.e2e(() => {
    window.__capriE2E.setInteractive(false);
    window.__capriE2E.throwError();
  });
  await win.waitForTimeout(300);
  await app.e2e(() => window.__capriE2E.reject());
  await win.waitForTimeout(300);
  // forceFree flips interactive true then refreshHit may clear it; menu must still open
  await app.e2e(() => window.__capriE2E.openMenu());
  assert.equal(await app.e2e(() => window.__capriE2E.menuVisible()), true);
  assert.equal(await app.e2e(() => window.__capriE2E.clickThroughOk()), true);
  await app.e2e(() => window.__capriE2E.pressEsc());

  // --- Salir → one click on Sí exits (button handler → doQuit, not a quit-answer shortcut) ---
  await app.e2e(() => window.__capriE2E.pressEsc());
  await win.evaluate(() => window.host.menuAction({ id: 'quit' }));
  await win.waitForSelector('.panel__actions button.is-primary', { state: 'visible', timeout: 8_000 });
  // Confirm window must be solid (no click-through) so a real pointer click would land.
  assert.equal(await app.e2e(() => window.__capriE2E.interactive()), true);
  assert.deepEqual(
    await win.evaluate(() => [...document.querySelectorAll('.panel__actions button')].map((b) => b.textContent)),
    ['Sí', 'No'],
  );
  const closed = new Promise((resolve) => {
    electronApp.once('close', () => resolve('closed'));
  });
  // DOM click on Sí (same listener as a pointer). OS click is flaky under ignoreMouseEvents races
  // in Playwright; the solid-window assert above covers click-through. Quitting tears the page down.
  win.evaluate(() => {
    document.querySelector('.panel__actions button.is-primary')?.click();
  }).catch(() => {});
  const outcome = await Promise.race([
    closed,
    new Promise((r) => setTimeout(() => r('timeout'), 8000)),
  ]);
  assert.equal(outcome, 'closed', 'Capri process did not exit within 8s after one click on Sí');
});

test('smoke: emergency force-quit from main (Ctrl+Alt+Shift+Q path)', async (t) => {
  const app = await launchCapri({ settleMs: 1500 });
  t.after(async () => {
    try { await app.close(); } catch { /* */ }
  });
  const { electronApp } = app;
  const closed = new Promise((resolve) => electronApp.once('close', () => resolve('closed')));
  await electronApp.evaluate(() => global.__capriForceQuit());
  const outcome = await Promise.race([
    closed,
    new Promise((r) => setTimeout(() => r('timeout'), 5000)),
  ]);
  assert.equal(outcome, 'closed', 'force quit did not exit within 5s');
});
});
