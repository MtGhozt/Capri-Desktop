'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/renderer/js/poses.js');

test('lying A loops 0,1,0,2 at 5 fps', async () => {
  const { poseFrame, poseFile, LIE_FPS } = await load();
  assert.equal(LIE_FPS, 5);
  const step = 1000 / 5;
  assert.equal(poseFile('lieA', 0, 0), 'lying_A.png');
  assert.equal(poseFile('lieA', step, 0), 'lying_A_1.png');
  assert.equal(poseFile('lieA', step * 2, 0), 'lying_A.png');
  assert.equal(poseFile('lieA', step * 3, 0), 'lying_A_2.png');
  assert.equal(poseFrame('lieA', step * 4, 0), 0);
});

test('lying B loops 0,1,2,3 at 5 fps', async () => {
  const { poseFile } = await load();
  const step = 1000 / 5;
  assert.equal(poseFile('lieB', 0, 0), 'lying_B_0.png');
  assert.equal(poseFile('lieB', step, 0), 'lying_B_1.png');
  assert.equal(poseFile('lieB', step * 2, 0), 'lying_B_2.png');
  assert.equal(poseFile('lieB', step * 3, 0), 'lying_B_3.png');
  assert.equal(poseFile('lieB', step * 4, 0), 'lying_B_0.png');
});

test('box seat puts the contact pixel on the top edge', async () => {
  const { boxSeat, POSES } = await load();
  const ledge = { x: 100, y: 200, w: 360, h: 180, top: 200 };
  const a = boxSeat(ledge, 'lieA', { scale: 0.6, dx: 140 });
  assert.equal(a.y, 201);
  assert.equal(a.x, 240);
  assert.equal(POSES.lieA.contact.y, 608);
  const stand = boxSeat(ledge, 'stand', { dx: 140 });
  assert.equal(stand.y, 202);
});

test('pose sheets are at 2x sprite pixels, and a fresh seat lands right of the tab, inside the box', async () => {
  const { boxSeat, poseScale, POSES } = await load();
  assert.equal(poseScale(0.6), 0.3);
  const ledge = { x: 1000, y: 200, w: 420, h: 180, top: 200 };
  for (const pose of ['lieA', 'lieB']) {
    const seat = boxSeat(ledge, pose, { scale: 0.6 });
    const spec = POSES[pose];
    const right = seat.x + (spec.width - spec.contact.x) * 0.3;
    assert.ok(seat.dx > ledge.w * 0.46, `${pose} clears the tab`);
    assert.ok(right <= ledge.x + ledge.w, `${pose} stays on the box`);
  }
  assert.ok(boxSeat(ledge, 'stand', { scale: 0.6 }).dx > ledge.w * 0.46);
});
