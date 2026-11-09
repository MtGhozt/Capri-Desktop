'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWeather, weatherLabel, willRain } = require('../src/main/weather');
const { temporalContext } = require('../src/main/llm');

const GEO = {
  results: [{
    name: 'San José', country: 'Costa Rica', country_code: 'CR',
    latitude: 9.93, longitude: -84.08, timezone: 'America/Costa_Rica',
  }],
};

const FORECAST = {
  current: { temperature_2m: 24.2, weather_code: 61, precipitation_probability: 80 },
  daily: {
    time: ['2026-11-08', '2026-11-09'],
    weather_code: [61, 0],
    temperature_2m_max: [27, 29],
    temperature_2m_min: [19, 18],
    precipitation_probability_max: [80, 10],
  },
};

const HOLIDAYS = [
  { date: '2026-11-08', localName: 'Feriado de prueba', name: 'Test' },
  { date: '2026-12-25', localName: 'Navidad', name: 'Christmas' },
];

function mockFetch(map) {
  return async (url) => {
    const href = String(url);
    for (const [needle, body] of map) {
      if (href.includes(needle)) {
        return { ok: true, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => null };
  };
}

test('WMO labels and rain heuristic', () => {
  assert.equal(weatherLabel(61), 'lluvia leve');
  assert.equal(willRain(61, 10), true);
  assert.equal(willRain(0, 80), true);
  assert.equal(willRain(0, 10), false);
});

test('context snippet includes weather and holidays when online', async () => {
  const weather = createWeather({
    now: () => Date.parse('2026-11-08T18:00:00.000Z'),
    fetchImpl: mockFetch([
      ['geocoding-api.open-meteo.com', GEO],
      ['api.open-meteo.com', FORECAST],
      ['date.nager.at', HOLIDAYS],
    ]),
  });
  const text = await weather.contextSnippet({
    place: 'San José, Costa Rica',
    timeZone: 'America/Costa_Rica',
    at: new Date('2026-11-08T18:00:00.000Z'),
  });
  assert.match(text, /Clima en San José/);
  assert.match(text, /24°C/);
  assert.match(text, /lluvia/i);
  assert.match(text, /Feriados próximos/);
  assert.match(text, /no inventes/i);

  const withExtras = temporalContext({
    now: new Date('2026-11-08T18:00:00.000Z'),
    timeZone: 'America/Costa_Rica',
    extras: text,
  });
  assert.match(withExtras, /Hora local/);
  assert.match(withExtras, /Clima en San José/);
});

test('offline or empty place: silent empty context, honest direct answers', async () => {
  const offline = createWeather({
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(await offline.contextSnippet({ place: 'San José' }), '');
  assert.match(
    await offline.answerDirect('¿va a llover hoy?', { place: 'San José' }),
    /no puedo consultar el clima/i,
  );

  const empty = createWeather({
    fetchImpl: mockFetch([
      ['geocoding-api.open-meteo.com', GEO],
      ['api.open-meteo.com', FORECAST],
    ]),
  });
  assert.equal(await empty.contextSnippet({ place: '' }), '');
  assert.match(
    await empty.answerDirect('¿mañana es feriado?', { place: '' }),
    /Configurá una ciudad/i,
  );
});

test('direct rain and holiday questions use real data', async () => {
  const weather = createWeather({
    now: () => Date.parse('2026-11-08T18:00:00.000Z'),
    fetchImpl: mockFetch([
      ['geocoding-api.open-meteo.com', GEO],
      ['api.open-meteo.com', FORECAST],
      ['date.nager.at', HOLIDAYS],
    ]),
  });
  const rain = await weather.answerDirect('¿va a llover hoy?', {
    place: 'San José',
    timeZone: 'America/Costa_Rica',
    at: new Date('2026-11-08T18:00:00.000Z'),
  });
  assert.match(rain, /sí apunta a lluvia/i);

  const dry = await weather.answerDirect('¿va a llover mañana?', {
    place: 'San José',
    timeZone: 'America/Costa_Rica',
    at: new Date('2026-11-08T18:00:00.000Z'),
  });
  assert.match(dry, /no parece que llueva/i);

  const holiday = await weather.answerDirect('¿hoy es feriado?', {
    place: 'San José',
    timeZone: 'America/Costa_Rica',
    at: new Date('2026-11-08T18:00:00.000Z'),
  });
  assert.match(holiday, /es feriado: Feriado de prueba/);

  assert.equal(await weather.answerDirect('abre Discord', { place: 'San José' }), null);
});

test('weather cache avoids a second network hit within the TTL', async () => {
  let hits = 0;
  const weather = createWeather({
    now: () => 1000,
    fetchImpl: async (url) => {
      hits += 1;
      const href = String(url);
      if (href.includes('geocoding')) return { ok: true, json: async () => GEO };
      if (href.includes('forecast')) return { ok: true, json: async () => FORECAST };
      if (href.includes('nager')) return { ok: true, json: async () => HOLIDAYS };
      return { ok: false, status: 404, json: async () => null };
    },
  });
  await weather.contextSnippet({ place: 'San José', timeZone: 'America/Costa_Rica' });
  const first = hits;
  await weather.contextSnippet({ place: 'San José', timeZone: 'America/Costa_Rica' });
  assert.equal(hits, first);
});

test('menu exposes the city field next to the time zone', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const menu = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(menu, /Ciudad \/ país \(clima\)/);
  assert.match(menu, /weather-place/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /case 'weather-place'/);
  assert.match(main, /temporalExtras/);
});
