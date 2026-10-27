'use strict';

// Her menu can never hold the screen: main follows her heartbeat, takes the clicks back when she
// goes quiet, and closes the menu on demand (tray, Ctrl+Alt+M, Esc), reloading her if she can't.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMenuGuard, SILENT_MS, FORCE_WAIT_MS } = require('../src/main/menu-guard');

function setup() {
  let t = 1000;
  let through = true;
  const calls = [];
  const guard = createMenuGuard({
    now: () => t,
    clickThrough: () => through,
    setClickThrough: (on) => { through = on; calls.push(['through', on]); },
    sendCommand: (name, payload) => calls.push(['cmd', name, payload]),
    keyboardOff: () => calls.push(['keyboardOff']),
    reload: () => calls.push(['reload']),
    onMenu: (open) => calls.push(['esc', open]),
    log: () => {},
  });
  return { guard, calls, advance: (ms) => { t += ms; }, through: () => through, setThrough: (v) => { through = v; } };
}

test('the window follows what she last asked for', () => {
  const s = setup();
  s.guard.beat({ menu: true, interactive: true });
  assert.equal(s.through(), false);
  assert.deepEqual(s.calls.filter((c) => c[0] === 'esc'), [['esc', true]]);
  // a missed "give the clicks back": the next heartbeat fixes it
  s.guard.beat({ menu: false, interactive: false });
  assert.equal(s.through(), true);
  assert.deepEqual(s.calls.filter((c) => c[0] === 'esc'), [['esc', true], ['esc', false]]);
  // already in line: nothing touched
  const before = s.calls.length;
  s.guard.beat({ menu: false, interactive: false });
  assert.equal(s.calls.length, before);
});

test('she goes quiet: the clicks go back to the other windows', () => {
  const s = setup();
  s.guard.beat({ menu: true, interactive: true });
  assert.equal(s.through(), false);
  s.advance(SILENT_MS - 1);
  s.guard.tick();
  assert.equal(s.through(), false);
  s.advance(1);
  s.guard.tick();
  assert.equal(s.through(), true);
  assert.ok(s.calls.some((c) => c[0] === 'keyboardOff'));
  assert.equal(s.guard.menuOpen, false);
});

test('a forced close frees the screen at once, and reloads her only if she never answers', () => {
  let s = setup();
  s.guard.beat({ menu: true, interactive: true });
  s.guard.forceClose('tray');
  assert.equal(s.through(), true);
  assert.deepEqual(s.calls.find((c) => c[0] === 'cmd'), ['cmd', 'menu-close', { force: true }]);
  assert.ok(s.calls.some((c) => c[0] === 'keyboardOff'));
  assert.equal(s.guard.menuOpen, false);
  s.advance(500);
  s.guard.beat({ menu: false, interactive: false }); // she answered
  s.advance(FORCE_WAIT_MS);
  s.guard.tick();
  assert.ok(!s.calls.some((c) => c[0] === 'reload'));

  s = setup();
  s.guard.forceClose('shortcut');
  s.advance(FORCE_WAIT_MS);
  s.guard.tick();
  assert.deepEqual(s.calls.filter((c) => c[0] === 'reload'), [['reload']]);
});

test('Esc is only taken while the menu is open', () => {
  const s = setup();
  s.guard.menuChanged(true);
  s.guard.menuChanged(true);
  s.guard.menuChanged(false);
  assert.deepEqual(s.calls.filter((c) => c[0] === 'esc'), [['esc', true], ['esc', false]]);
});
