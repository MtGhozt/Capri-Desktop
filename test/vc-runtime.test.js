'use strict';

// Without the Microsoft VC++ 2015-2022 x64 runtime the voice wheels (onnxruntime,
// ctranslate2) cannot load: she must say it once, with the official download link.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { VC_URL, VC_MESSAGE, VC_DLLS, missingVcRuntime } = require('../src/main/vc-runtime');

test('missing runtime is detected from the three DLLs in System32', () => {
  const env = { SystemRoot: 'C:\\Windows' };
  const withDlls = (present) => missingVcRuntime({
    platform: 'win32',
    env,
    exists: (file) => present.includes(path.basename(file)),
  });

  assert.equal(withDlls(VC_DLLS), false);
  assert.equal(withDlls(VC_DLLS.filter((dll) => dll !== 'vcruntime140_1.dll')), true);
  assert.equal(withDlls([]), true);
  assert.equal(missingVcRuntime({ platform: 'linux', env }), false);
});

test('the message names the runtime and links to the x64 installer', () => {
  assert.match(VC_MESSAGE, /Microsoft Visual C\+\+ Redistributable \(x64\)/);
  assert.match(VC_MESSAGE, /reiniciá la PC/);
  assert.equal(VC_URL, 'https://aka.ms/vs/17/release/vc_redist.x64.exe');
});
