'use strict';

// Ajustes "?" panels: every button that shows one has steps, and only one panel is open at a time.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HELP_STEPS, toggleHelp, splitHelpText } = require('../src/renderer/js/help-steps.js');

test('each help id has a title and steps', () => {
  assert.deepEqual(Object.keys(HELP_STEPS).sort(), [
    'agents', 'apps', 'brain', 'clip', 'gaming', 'hearing', 'memory', 'namida', 'screen', 'spotify', 'talk', 'voice', 'wake',
  ]);
  for (const [id, help] of Object.entries(HELP_STEPS)) {
    assert.ok(help.title, id);
    assert.ok(help.section, id); // which Ajustes tab shows it
    assert.ok(Array.isArray(help.steps) && help.steps.length > 0, id);
    assert.ok(help.steps.length <= 5, `${id} should stay at 3–5 steps`);
    for (const step of help.steps) {
      assert.ok(typeof step === 'string' || (step.text && step.command), id);
    }
  }
});

test('opening one help panel closes the other', () => {
  assert.equal(toggleHelp(null, 'spotify'), 'spotify');
  assert.equal(toggleHelp('spotify', 'brain'), 'brain');
  assert.equal(toggleHelp('brain', 'brain'), null); // the same "?" closes it
});

test('splitHelpText turns http(s) into url parts (clickable in the panel)', () => {
  const parts = splitHelpText('Abrí https://aistudio.google.com/apikey y listo.');
  assert.deepEqual(parts, [
    { type: 'text', value: 'Abrí ' },
    { type: 'url', value: 'https://aistudio.google.com/apikey' },
    { type: 'text', value: ' y listo.' },
  ]);
  assert.deepEqual(splitHelpText('sin links'), [{ type: 'text', value: 'sin links' }]);
  // Trailing punctuation is not part of the URL
  assert.equal(
    splitHelpText('mirá https://discord.gg/wmVfYdjpdA.').find((p) => p.type === 'url').value,
    'https://discord.gg/wmVfYdjpdA',
  );
});

test('help covers current install, talk, brain cards, apps, screen and #bugs', () => {
  const all = Object.values(HELP_STEPS).flatMap((h) => [
    h.note || '',
    ...h.steps.map((s) => (typeof s === 'string' ? s : `${s.text}\n${s.command}`)),
  ]).join('\n');
  assert.match(all, /python\.org\/downloads\/release\/python-3119/);
  assert.match(all, /Add python\.exe to PATH/i);
  assert.match(all, /Instalar voz/);
  assert.match(all, /Ver detalles/);
  assert.doesNotMatch(all, /setup\.ps1/);
  assert.doesNotMatch(all, /PowerShell corré|Fallback manual|escribí powershell/i);
  assert.match(all, /Hey Capri/);
  assert.match(all, /Tecla para hablar/);
  assert.match(all, /Ctrl\+Alt\+T/);
  assert.match(all, /Pausa antes de cortar/);
  assert.match(all, /VOZ/);
  assert.match(all, /BLIPS/);
  assert.match(all, /Gratis con límite/);
  assert.match(all, /Gratis con límite» \(Gemini, Groq\)/);
  assert.match(all, /De pago» \(OpenAI, Anthropic, DeepSeek, Mistral, NVIDIA, Grok\/xAI\)/);
  assert.match(all, /\bGratis\b/);
  assert.match(all, /De pago/);
  assert.match(all, /Agentes instalados/);
  assert.match(all, /Probar/);
  assert.match(all, /Activo/);
  assert.match(all, /INSTALAR|QUITAR/);
  assert.match(all, /Buscar programa/);
  assert.match(all, /Añadir enlace/);
  assert.match(all, /No molestar/);
  assert.match(all, /Silenciar en esta app/);
  assert.match(all, /Automático \(recomendado\)/);
  assert.match(all, /OpenGL \(experimental\)/);
  assert.match(all, /%APPDATA%\\capri-desktop\\logs\\voice\.log/);
  assert.match(all, /#bugs/);
  assert.match(all, /developer\.spotify\.com/);
  assert.match(all, /127\.0\.0\.1:47835\/callback/);
  assert.match(all, /Reproductor = NAMIDA/);
  assert.match(all, /namida\.exe/);
  assert.match(all, /qué está sonando/);
  assert.match(all, /Agregar carpeta o archivo/);
  assert.match(all, /Microsoft Visual C\+\+ Redistributable \(x64\)/);
  assert.match(all, /vc_redist\.x64\.exe/);
});
