'use strict';

// One line per event, local time on every line, and voice.log rolls over at 5 MB keeping two
// files (voice.log and voice.log.1).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MAX_BYTES, stamp, oneLine, rotate, logEvent, logLines } = require('../src/main/log.js');

function tmpFile(name = 'voice.log') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-log-'));
  return { dir, file: path.join(dir, name) };
}

const read = (file) => fs.readFileSync(file, 'utf8');

test('the stamp is local time, zero padded', () => {
  assert.equal(stamp(new Date(2026, 9, 26, 7, 5, 3)), '2026-10-26 07:05:03');
  assert.equal(stamp(new Date(2026, 0, 2, 23, 59, 59)), '2026-01-02 23:59:59');
});

test('one event is one line, whatever the sidecar printed', () => {
  assert.equal(oneLine('tts loaded\n  device cuda:0  '), 'tts loaded device cuda:0');
  assert.equal(oneLine('   \n\t '), '');
});

test('logEvent writes one timestamped line and ignores empty text', () => {
  const { file } = tmpFile();
  const now = new Date(2026, 9, 26, 12, 0, 0);
  assert.equal(logEvent(file, 'tts loaded device cuda:0', { now }), true);
  assert.equal(logEvent(file, '   ', { now }), false);
  assert.equal(read(file), '2026-10-26 12:00:00 tts loaded device cuda:0\n');
});

test('logLines splits a chunk of sidecar output into one line each', () => {
  const { file } = tmpFile();
  const now = new Date(2026, 9, 26, 12, 0, 0);
  logLines(file, 'first\nsecond\r\n\nthird\n', { now });
  assert.deepEqual(read(file).split('\n').filter(Boolean), [
    '2026-10-26 12:00:00 first',
    '2026-10-26 12:00:00 second',
    '2026-10-26 12:00:00 third',
  ]);
});

test('logEvent creates the folder it writes into', () => {
  const { dir } = tmpFile();
  const file = path.join(dir, 'nested', 'deeper', 'voice.log');
  assert.equal(logEvent(file, 'hello'), true);
  assert.match(read(file), /hello\n$/);
});

test('rotate keeps exactly two files, the newest one live', () => {
  const { file } = tmpFile();
  fs.writeFileSync(file, 'old\n');
  rotate(file, 4); // 4 bytes reached → rolls
  assert.equal(fs.existsSync(file), false);
  assert.equal(read(`${file}.1`), 'old\n');

  fs.writeFileSync(file, 'fresh\n');
  rotate(file, 4); // the older roll is dropped, not chained
  assert.equal(read(`${file}.1`), 'fresh\n');
  assert.equal(fs.existsSync(`${file}.2`), false);
});

test('rotate leaves a small log alone', () => {
  const { file } = tmpFile();
  fs.writeFileSync(file, 'small\n');
  rotate(file, MAX_BYTES);
  assert.equal(read(file), 'small\n');
  assert.equal(fs.existsSync(`${file}.1`), false);
});

test('logEvent rolls over once the live file passes the cap', () => {
  const { file } = tmpFile();
  logEvent(file, 'first', { maxBytes: 20 });
  logEvent(file, 'second', { maxBytes: 20 });
  assert.match(read(`${file}.1`), /first\n$/);
  assert.equal(read(file).split('\n').filter(Boolean).length, 1);
});
