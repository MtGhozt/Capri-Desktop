'use strict';

// "buscame X en Google/Spotify": the phrase is parsed locally and only a search page opens.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseQuickSearch, searchUrl } = require('../src/main/quick-search');
const { classify } = require('../src/main/direct-match');

test('"buscame/buscá X en Google" opens a Google search', () => {
  for (const text of [
    'buscame pizza en Google',
    'buscá pizza en google',
    'buscar pizza en Google',
    'Capri, buscame pizza en Google',
    'Buscame Pizza en GOOGLE',
    'buscame pizza en Google por favor',
  ]) {
    assert.deepEqual(parseQuickSearch(text), { target: 'google', query: 'pizza' }, text);
  }
});

test('"buscame X en Spotify" opens the Spotify search', () => {
  for (const text of [
    'buscame Bohemian Rhapsody en Spotify',
    'buscá bohemian rhapsody en spotify',
    'buscar bohemian rhapsody en Spotify',
  ]) {
    assert.deepEqual(
      parseQuickSearch(text),
      { target: 'spotify', query: 'bohemian rhapsody' },
      text,
    );
  }
});

test('no search words: she has to ask what to search', () => {
  assert.deepEqual(parseQuickSearch('buscame en Google'), { target: 'google', query: '' });
  assert.deepEqual(parseQuickSearch('buscá en Spotify'), { target: 'spotify', query: '' });
});

test('other search phrasings stay off this path', () => {
  for (const text of [
    'buscá en Google recetas',
    'buscame una excusa para mañana',
    'buscame el PDF de cálculo',
    'buscá la canción Bohemian en Spotify',
    'pon Bohemian en Spotify',
    'abrí Google',
  ]) {
    assert.equal(parseQuickSearch(text), null, text);
  }
});

test('search URLs encode the query; Spotify has a web fallback', () => {
  assert.equal(
    searchUrl('google', 'pizza a la napolitana'),
    'https://www.google.com/search?q=pizza%20a%20la%20napolitana',
  );
  assert.equal(
    searchUrl('spotify', 'Bohemian Rhapsody'),
    'https://open.spotify.com/search/Bohemian%20Rhapsody',
  );
});

test('the direct-command ladder sends these to search, not the model', () => {
  assert.equal(classify('buscame pizza en google'), 'search');
  assert.equal(classify('buscá pizza en spotify'), 'search');
  assert.equal(classify('buscá en Google recetas'), 'llm');
});
