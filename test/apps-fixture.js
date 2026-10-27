'use strict';

// A table like the one seeded on a real PC, for the app tests.
const { cleanApps } = require('../src/main/apps-config');

const APPS = cleanApps([
  { name: 'Discord', aliases: ['discor', 'discordia'], type: 'program', target: '%LOCALAPPDATA%\\Discord\\Update.exe', args: '--processStart Discord.exe', processes: ['Discord'], close: 'graceful' },
  { name: 'Spotify', aliases: ['spoti', 'espotifai'], type: 'link', target: 'spotify:', processes: ['Spotify'], close: 'graceful' },
  { name: 'Namida', type: 'program', target: 'C:\\Software\\Namida\\namida\\namida.exe', processes: ['namida'] },
  { name: 'Steam', aliases: ['estim'], type: 'program', target: 'C:\\Program Files (x86)\\Steam\\steam.exe', processes: ['steam'] },
  { name: 'Opera GX', aliases: ['opera', 'navegador', 'browser', 'internet'], type: 'program', target: 'C:\\Opera GX\\opera.exe', processes: ['opera'], close: 'ask' },
  { name: 'YouTube', aliases: ['yutub', 'you tube'], type: 'link', target: 'https://www.youtube.com' },
  { name: 'Google', aliases: ['gugel', 'buscador'], type: 'link', target: 'https://www.google.com' },
]);

module.exports = { APPS };
