'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../src/main/direct-match');
const { detectInfoKinds } = require('../src/main/pc-actions');
const { isWeatherOrHolidayQuestion } = require('../src/main/weather');

const APPS = [
  { name: 'Discord', aliases: ['discor'], type: 'program', target: 'C:\\Discord\\Discord.exe', processes: ['Discord'] },
  { name: 'Chrome', aliases: [], type: 'program', target: 'C:\\Chrome\\chrome.exe', processes: ['chrome'] },
  { name: 'Spotify', aliases: ['spoti'], type: 'link', target: 'https://open.spotify.com', processes: ['Spotify'] },
  { name: 'Namida', aliases: [], type: 'link', target: 'https://namida.app', processes: ['namida'] },
];

const opts = { apps: APPS };

const ROWS = [
  // stop-TTS
  ['callate', 'stopTts'],
  ['cállate', 'stopTts'],
  ['callá', 'stopTts'],
  ['callate capri', 'stopTts'],
  ['dejá de hablar', 'stopTts'],
  ['deja de hablar', 'stopTts'],
  ['pará de hablar', 'stopTts'],
  ['para de hablar', 'stopTts'],
  // bare volume verbs → LLM
  ['subí', 'llm'],
  ['bajá', 'llm'],
  ['bajale', 'llm'],
  ['subile', 'llm'],
  // anchored volume / theme
  ['más bajo', 'pc'],
  ['más fuerte', 'pc'],
  ['subí el volumen', 'pc'],
  ['silencio', 'pc'],
  ['volumen al 40', 'pc'],
  ['poné el modo oscuro', 'pc'],
  ['cambialo a modo oscuro', 'pc'],
  // music vs apps
  ['silenciá la música', 'music'],
  ['ponés música', 'music'],
  ['apagá la música', 'music'],
  ['siguiente', 'music'],
  ['siguiente diapositiva', 'llm'],
  ['pasa', 'llm'],
  ['pasá', 'llm'],
  ['abrí el reproductor', 'music'],
  ['poné Discord', 'app'],
  ['poné Spotify', 'app'],
  ['poné Namida', 'app'],
  ['¿podés poner música?', 'llm'],
  ['no pongas música', 'llm'],
  // reminders
  ['poné timer', 'llm'], // no duration → not create
  ['poné alarma', 'llm'],
  ['pasa la canción a las 9', 'llm'],
  ['recordá en 5 minutos', 'reminder'],
  ['recuerdame en 5 minutos', 'reminder'],
  ['recordame en 5 minutos', 'reminder'],
  ['pasá el de las 8 a las 9', 'reminder'],
  ['poné una alarma a las 8', 'llm'], // clock, not relative minutes
  // system / sleep
  ['apagate', 'sleep'],
  ['apagá la compu', 'system'],
  // name / clip / look / forget
  ['dime hola', 'llm'],
  ['dime tu nombre', 'llm'],
  ['no guarda eso', 'llm'],
  ['después guarda eso', 'llm'],
  ['guarda eso', 'clip'],
  ['no sé qué ves de malo', 'llm'],
  ['mirame la pantalla', 'look'],
  ['borra la memoria', 'llm'],
  ['limpia la memoria', 'llm'],
  ['limpia la memoria RAM', 'llm'],
  // window/file phrasing that used to look like volume
  ['bajame ese archivo', 'llm'],
  ['bajá la ventana', 'llm'],
  // snip vs screen-look vs clip
  ['recortá la pantalla', 'snip'],
  ['mirá mi pantalla', 'look'],
  ['guardá un clip', 'clip'],
  // arrange windows
  ['poné Discord a la izquierda', 'window'],
  ['Discord a la izquierda y Chrome a la derecha', 'window'],
  ['maximizá Chrome', 'window'],
  ['poné Discord', 'app'],
  ['poné música a la derecha', 'llm'],
  ['la izquierda de la foto está mal', 'llm'],
];

for (const [phrase, dest] of ROWS) {
  test(`classify(${JSON.stringify(phrase)}) → ${dest}`, () => {
    assert.equal(classify(phrase, opts), dest, phrase);
  });
}

test('weather extras only for real weather questions', () => {
  assert.equal(isWeatherOrHolidayQuestion('qué tiempo hace'), true);
  assert.equal(isWeatherOrHolidayQuestion('llueve'), true);
  assert.equal(isWeatherOrHolidayQuestion('llueve de tareas'), false);
  assert.equal(isWeatherOrHolidayQuestion('no tengo tiempo'), false);
  assert.equal(isWeatherOrHolidayQuestion('hace tiempo que no hablamos'), false);
});

test('disk/RAM info kinds stay picky', () => {
  assert.deepEqual(detectInfoKinds('me gusta ese disco'), []);
  assert.deepEqual(detectInfoKinds('cuánta memoria usa Capri'), []);
  assert.ok(detectInfoKinds('cuánto espacio en disco queda').includes('disk'));
  assert.ok(detectInfoKinds('cuánta memoria tengo').includes('ram'));
});

test('main temporalExtras gates weather on isWeatherOrHolidayQuestion', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /if \(isWeatherOrHolidayQuestion\(user\)\)/);
});

test('dual window phrase yields two snap ops', () => {
  const { parsePcCommand } = require('../src/main/pc-actions');
  const got = parsePcCommand('Discord a la izquierda y Chrome a la derecha', { apps: APPS });
  assert.equal(got?.kind, 'window');
  assert.equal(got.snaps?.length, 2);
  assert.equal(got.snaps[0].position, 'left');
  assert.equal(got.snaps[0].process, 'Discord');
  assert.equal(got.snaps[1].position, 'right');
  assert.equal(got.snaps[1].process, 'chrome');
});
