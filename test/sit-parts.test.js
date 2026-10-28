'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('sit replacement assets have reproducible face and arm metadata', () => {
  const parts = path.join(root, 'assets', 'capri', 'parts');
  const manifest = JSON.parse(fs.readFileSync(path.join(parts, 'parts.json'), 'utf8'));
  assert.equal(manifest.scale, 0.5);
  assert.deepEqual(Object.keys(manifest.parts).sort(), ['arm_L', 'arm_R']);
  for (const name of ['arm_L', 'arm_R', 'face-calm']) {
    assert.ok(fs.statSync(path.join(parts, `${name}.png`)).size > 0);
  }
});

test('the shader gates the face replacement to the sitting uniform', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'sprite.js'), 'utf8');
  assert.match(source, /uSit\s*>\s*0\.0/);
  assert.match(source, /SitPartsLayer/);
  assert.match(fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'sit-parts.js'), 'utf8'), /SIT_FACE_ENABLED\s*=\s*false/);
});
