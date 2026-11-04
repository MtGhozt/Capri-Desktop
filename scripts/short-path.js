'use strict';
// Quick test: get a Windows 8.3 short path for a file via powershell
const { spawnSync } = require('child_process');
const fp = process.argv[2] || 'C:/Program Files/Common Files/System/ado/msado15.dll';
const script = `(New-Object -ComObject Scripting.FileSystemObject).GetFile('${fp}').ShortPath`;
const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8' });
console.log(JSON.stringify({ out: r.stdout.trim(), err: r.stderr.trim(), st: r.status }));
