'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');
  assert.match(app, /case 'game-drone':[\s\S]*?dormant\.hide\(\);[\s\S]*?mask\.hide\(\);[\s\S]*?drone\.show\(\)/);
  assert.match(app, /case 'game-drone':[\s\S]*?drone\.hide\(\);[\s\S]*?machine\.get\(\) === 'DORMANT'[\s\S]*?dormant\.show\(\)/);
  assert.match(app, /if \(!droneActive\) \{[\s\S]*?dormant\.show\(\)/);
});
