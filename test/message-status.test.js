'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/renderer/js/message-status.js');

test('machine states map to the Spanish message-box badges', async () => {
  const { messageBadge } = await load();
  assert.equal(messageBadge('ONLINE'), 'EN ESPERA');
  assert.equal(messageBadge('LISTENING'), 'ESCUCHANDO');
  assert.equal(messageBadge('THINKING'), 'PENSANDO');
  assert.equal(messageBadge('TALKING'), 'HABLANDO');
  assert.equal(messageBadge('DORMANT'), 'DORMIDA');
  assert.equal(messageBadge('BOOTING'), 'EN ESPERA');
  assert.equal(messageBadge('OFFLINE'), 'EN ESPERA');
  assert.equal(messageBadge('nope'), 'EN ESPERA');
});
