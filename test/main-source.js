'use strict';

// main.js was split into small modules (step 1 of 5): a test that pins the main process source
// reads this bundle instead. Add each new module here when its code moves out of main.js.

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'src', 'main');
// main.js last: slices anchored on its functions still end at the file they expect.
const MODULES = ['game-window.js', 'state.js', 'main.js'];

module.exports = MODULES
  .map((name) => fs.readFileSync(path.join(DIR, name), 'utf8'))
  .join('\n');
