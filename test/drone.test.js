'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/renderer/js/drone.js');

test('drone draws only when its animation frame changes', async () => {
  const { createDrone } = await load();
  const calls = [];
  const ctx = { clearRect: () => calls.push('clear'), save() {}, restore() {}, translate() {}, rotate() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, ellipse() {}, fill() {}, stroke() {},
    fillStyle: '', strokeStyle: '', lineWidth: 0, shadowBlur: 0, shadowColor: '' };
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
  const drone = createDrone(canvas, { reducedMotion: true });
  drone.update(0, { x: 10, y: 10 });
  drone.update(1, { x: 10, y: 10 });
  assert.equal(calls.filter((item) => item === 'clear').length, 1);
});

test('drone can be shown and hidden without owning game mode', async () => {
  const { createDrone } = await load();
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ({}) };
  const drone = createDrone(canvas);
  drone.show();
  assert.equal(canvas.hidden, false);
  drone.hide();
  await new Promise((resolve) => setTimeout(resolve, 190));
  assert.equal(canvas.hidden, true);
});

test('game drone mode hides dormant and restores it when still dormant', () => {
  const app = require('./app-source');
  assert.match(app, /case 'game-drone':[\s\S]*?dormant\.hide\(\);[\s\S]*?mask\.hide\(\);[\s\S]*?drone\.show\(\)/);
  assert.match(app, /case 'game-drone':[\s\S]*?drone\.hide\(\);[\s\S]*?machine\.get\(\) === 'DORMANT'[\s\S]*?dormant\.show\(\)/);
  assert.match(app, /if \(!ptr\.droneActive\) \{[\s\S]*?dormant\.show\(\)/);
});

test('entering a game no longer starts the drone', () => {
  const main = require('./main-source');
  const from = main.indexOf('async function gameEnter');
  const enter = main.slice(from, main.indexOf('async function gameLeave', from));
  assert.ok(from > 0, 'gameEnter exists');
  assert.doesNotMatch(enter, /game-drone/);
  assert.doesNotMatch(enter, /gaming\?\.drone/);
  // Leaving still hides it, so nothing can stay on screen over her after the game.
  const leave = main.slice(main.indexOf('async function gameLeave'), main.indexOf('function voiceReplyOn'));
  assert.match(leave, /sendCommand\('game-drone', \{ on: false \}\)/);
});
