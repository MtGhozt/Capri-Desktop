'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripReplyTags, createMoodStripper } = require('../src/main/mood-tag');

test('stripReplyTags takes a mood and an action tag, in either order', () => {
  assert.deepEqual(stripReplyTags('[burla] [open:Discord] Ahí va.'), {
    text: 'Ahí va.',
    mood: 'burla',
    action: { kind: 'open', value: 'Discord' },
  });
  assert.deepEqual(stripReplyTags('[play:Back in Black] [emocion] ¡Dale!'), {
    text: '¡Dale!',
    mood: 'emocion',
    action: { kind: 'play', value: 'Back in Black' },
  });
});

test('stripReplyTags knows her song and leaves unknown tags alone', () => {
  assert.deepEqual(stripReplyTags('[play:hersong] Mi canción.'), {
    text: 'Mi canción.',
    mood: null,
    action: { kind: 'play', value: 'hersong', herSong: true },
  });
  assert.deepEqual(stripReplyTags('[foo:DISCORD] Nada.'), {
    text: '[foo:DISCORD] Nada.',
    mood: null,
    action: null,
  });
});

test('stream stripper hides mood and action tags from text and reports both', () => {
  const out = [];
  let mood = null;
  let action = null;
  const s = createMoodStripper({
    onText: (piece) => out.push(piece),
    onMood: (name) => { mood = name; },
    onAction: (act) => { action = act; },
  });
  s.push('[');
  s.push('burla');
  s.push('] [op');
  s.push('en:Spot');
  s.push('ify] Hola, humanito.');
  s.flush();
  assert.equal(mood, 'burla');
  assert.deepEqual(action, { kind: 'open', value: 'Spotify' });
  assert.equal(out.join(''), 'Hola, humanito.');
  assert.equal(s.action.kind, 'open');
});

test('stream stripper passes plain text through', () => {
  const out = [];
  const s = createMoodStripper({ onText: (piece) => out.push(piece) });
  s.push('Sin tags, ');
  s.push('choom.');
  s.flush();
  assert.equal(s.mood, null);
  assert.equal(s.action, null);
  assert.equal(out.join(''), 'Sin tags, choom.');
});
