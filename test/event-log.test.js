'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/renderer/js/event-log.js');

test('keeps only the last N lines, newest at the end', async () => {
  const { EventLog } = await load();
  const log = new EventLog({ limit: 4 });
  log.push('oido', 'uno');
  log.push('pregunta', 'dos');
  log.push('abierto', '');
  log.push('sistema', 'boot');
  log.push('oido', 'cinco');
  assert.equal(log.lines.length, 4);
  assert.deepEqual(log.lines.map((l) => l.text), ['dos', '', 'boot', 'cinco']);
  log.setLimit(2);
  assert.equal(log.lines.length, 2);
  assert.deepEqual(log.lines.map((l) => l.kind), ['sistema', 'oido']);
});
