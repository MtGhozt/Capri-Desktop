'use strict';

// The voice sidecar's native wheels (onnxruntime, ctranslate2) need the Microsoft VC++
// 2015-2022 x64 runtime. Without it every wake word and every transcription dies with a
// DLL load error that no retry can fix, so she has to say which install is missing.

const fs = require('node:fs');
const path = require('node:path');

const VC_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
const VC_MESSAGE = 'Falta Microsoft Visual C++ Redistributable (x64). Instalalo, reiniciá la PC y abrí Capri de nuevo.';
const VC_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];

function missingVcRuntime({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (platform !== 'win32') return false;
  const root = env.SystemRoot || env.windir || 'C:\\Windows';
  const sys32 = path.join(root, 'System32');
  return VC_DLLS.some((dll) => !exists(path.join(sys32, dll)));
}

module.exports = { VC_URL, VC_MESSAGE, VC_DLLS, missingVcRuntime };
