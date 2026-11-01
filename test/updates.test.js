'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isNewer, due, checkForUpdate, parseTag } = require('../src/main/updates');

test('tag compare: only a higher semver counts as an update', () => {
  assert.equal(isNewer('0.1.3', '0.1.2'), true);
  assert.equal(isNewer('v0.2.0', '0.1.9'), true);
  assert.equal(isNewer('0.1.2', '0.1.2'), false);
  assert.equal(isNewer('0.1.1', '0.1.2'), false);
  assert.deepEqual(parseTag('v1.2.3-beta'), [1, 2, 3]);
});

test('due at most once per day, and never when disabled', () => {
  const now = 1_000_000;
  assert.equal(due({ enabled: false, lastCheck: 0, now }), false);
  assert.equal(due({ enabled: true, lastCheck: 0, now }), true);
  assert.equal(due({ enabled: true, lastCheck: now - 1000, now }), false);
  assert.equal(due({ enabled: true, lastCheck: now - 25 * 60 * 60 * 1000, now }), true);
});

test('checkForUpdate: newer tag returns the release; skip and failures stay quiet', async () => {
  const fetchOk = async () => ({
    ok: true,
    json: async () => ({ tag_name: 'v0.1.3', html_url: 'https://github.com/MtGhozt/Capri-Desktop/releases/tag/v0.1.3' }),
  });
  const hit = await checkForUpdate({
    localVersion: '0.1.2', lastCheck: 0, enabled: true, fetchImpl: fetchOk, now: 10,
  });
  assert.equal(hit.update.version, '0.1.3');
  assert.match(hit.update.url, /releases/);

  const skipped = await checkForUpdate({
    localVersion: '0.1.2', skippedVersion: '0.1.3', lastCheck: 0, enabled: true, fetchImpl: fetchOk, now: 10,
  });
  assert.equal(skipped.update, null);

  const fail = await checkForUpdate({
    localVersion: '0.1.2', lastCheck: 0, enabled: true, now: 10,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(fail.update, null);
  assert.match(fail.error, /offline/);
});
