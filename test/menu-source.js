'use strict';

// menu.js was split into section modules: tests that pin renderer menu source read this bundle
// instead. Add each new section file here when its code moves out of menu.js.

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu');
// menu.js last: source-span tests anchored on menu.js still resolve.
const MODULES = [
  'widgets.js',
  'about.js',
  'menu.js',
];

module.exports = MODULES
  .map((name) => {
    const file = name === 'menu.js'
      ? path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js')
      : path.join(DIR, name);
    return fs.readFileSync(file, 'utf8');
  })
  .join('\n');