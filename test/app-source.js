'use strict';

// app.js was split into focused modules (step 4 of 5): a test that pins the renderer boot
// source reads this bundle instead. Add each new module here when its code moves out of app.js.

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'src', 'renderer', 'js', 'app');
// app.js last: slices anchored on boot() still end at the file they expect.
const MODULES = [
  'pointer.js',
  'voice-events.js',
  'commands.js',
  'demo.js',
  'app.js',
];

module.exports = MODULES
  .map((name) => {
    const file = name === 'app.js'
      ? path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js')
      : path.join(DIR, name);
    return fs.readFileSync(file, 'utf8');
  })
  .join('\n');
