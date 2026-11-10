'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LINKS, KOFI_URL, isAllowedOpenUrl, aboutInfo, formatVersionLabel } = require('../src/main/about');

test('Acerca de community links include Discord invite and TikTok', () => {
  const about = aboutInfo({ version: '0.1.3' });
  assert.equal(LINKS.discord, 'https://discord.gg/wmVfYdjpdA');
  assert.ok(about.community.some((l) => l.url === LINKS.discord));
  assert.ok(about.community.some((l) => l.url === LINKS.tiktok));
  assert.ok(about.dev.some((l) => l.id === 'github' && l.url === LINKS.github));
  assert.ok(about.dev.some((l) => l.id === 'issues' && l.url === LINKS.issues));
});

test('Acerca de shows the Ko-fi donation link', () => {
  const about = aboutInfo({ version: '0.1.4' });
  assert.equal(KOFI_URL, 'https://ko-fi.com/mtghozt');
  assert.deepEqual(about.donate, [{ id: 'kofi', label: 'Ko-fi', url: KOFI_URL }]);
  assert.equal(LINKS.kofi, KOFI_URL);
});

test('Acerca de exposes Abrir log next to Diagnóstico', () => {
  const about = aboutInfo({ version: '0.2.4' });
  const ids = about.other.map((o) => o.id);
  assert.ok(ids.includes('diagnose'));
  assert.ok(ids.includes('open-log'));
  assert.ok(ids.indexOf('open-log') > ids.indexOf('diagnose') - 2);
});

test('version chrome labels use the same about.version as Acerca de', () => {
  assert.equal(formatVersionLabel('0.2.9'), 'v0.2.9');
  assert.equal(formatVersionLabel('v0.2.9'), 'v0.2.9');
  assert.equal(formatVersionLabel(''), '');
  assert.equal(aboutInfo({ version: '0.2.9' }).version, '0.2.9');

  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /aboutInfo\(\{\s*version:\s*app\.getVersion\(\)/);

  const aboutPanel = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'menu.js'), 'utf8');
  assert.match(aboutPanel, /about\.version/);

  const appJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'app.js'), 'utf8');
  assert.match(appJs, /state\?\.about\?\.version/);
  assert.match(appJs, /bubble\.setVersion/);
  assert.doesNotMatch(appJs, /setVersion\(['"]v0\./);

  const settingsJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'settings.js'), 'utf8');
  assert.match(settingsJs, /state\?\.about\?\.version/);
  assert.doesNotMatch(settingsJs, /textContent\s*=\s*['"]v0\./);

  const indexHtml = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const settingsHtml = fs.readFileSync(path.join(root, 'src', 'renderer', 'settings.html'), 'utf8');
  assert.match(indexHtml, /bubble__ver/);
  assert.match(settingsHtml, /settings__ver/);
  assert.doesNotMatch(indexHtml, />v0\.\d/);
  assert.doesNotMatch(settingsHtml, />v0\.\d/);
});

test('open-url allowlist: discord, tiktok, Capri github, Spotify; http/https only', () => {
  assert.equal(isAllowedOpenUrl(LINKS.discord), true);
  assert.equal(isAllowedOpenUrl('https://discord.com/invite/wmVfYdjpdA'), true);
  assert.equal(isAllowedOpenUrl(LINKS.tiktok), true);
  assert.equal(isAllowedOpenUrl(LINKS.github), true);
  assert.equal(isAllowedOpenUrl(LINKS.releases), true);
  assert.equal(isAllowedOpenUrl(LINKS.issues), true);
  assert.equal(isAllowedOpenUrl(LINKS.readme), true);
  assert.equal(isAllowedOpenUrl(LINKS.changelog), true);
  assert.equal(isAllowedOpenUrl(LINKS.license), true);
  assert.equal(isAllowedOpenUrl('https://console.anthropic.com/'), true);
  assert.equal(isAllowedOpenUrl('https://console.groq.com/keys'), true);
  assert.equal(isAllowedOpenUrl('https://console.mistral.ai/api-keys'), true);
  assert.equal(isAllowedOpenUrl('https://platform.deepseek.com/api_keys'), true);
  assert.equal(isAllowedOpenUrl('https://openrouter.ai/keys'), true);
  assert.equal(isAllowedOpenUrl('https://ko-fi.com/someone'), true);
  assert.equal(isAllowedOpenUrl('https://www.python.org/downloads/release/python-3119/'), true);
  assert.equal(isAllowedOpenUrl('https://developer.spotify.com/dashboard'), true);
  assert.equal(isAllowedOpenUrl('http://discord.gg/wmVfYdjpdA'), true); // http allowed on allowlisted hosts
  assert.equal(isAllowedOpenUrl('https://evil.example/phishing'), false);
  assert.equal(isAllowedOpenUrl('https://github.com/other/repo'), false);
  assert.equal(isAllowedOpenUrl('http://127.0.0.1:47835/callback'), false);
  assert.equal(isAllowedOpenUrl('file:///C:/secret'), false);
  assert.equal(isAllowedOpenUrl('javascript:alert(1)'), false);
});
