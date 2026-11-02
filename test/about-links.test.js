'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LINKS, KOFI_URL, isAllowedOpenUrl, aboutInfo } = require('../src/main/about');

test('Acerca de community links include Discord invite and TikTok', () => {
  const about = aboutInfo({ version: '0.1.3' });
  assert.equal(LINKS.discord, 'https://discord.gg/wmVfYdjpdA');
  assert.ok(about.community.some((l) => l.url === LINKS.discord));
  assert.ok(about.community.some((l) => l.url === LINKS.tiktok));
  assert.ok(about.dev.some((l) => l.id === 'github' && l.url === LINKS.github));
  assert.ok(about.dev.some((l) => l.id === 'issues' && l.url === LINKS.issues));
});

test('donations stay hidden until the Ko-fi URL exists', () => {
  const about = aboutInfo({ version: '0.1.4' });
  assert.equal(KOFI_URL, '');
  assert.deepEqual(about.donate, []);
  assert.equal(LINKS.kofi, KOFI_URL);
});

test('open-url allowlist: discord, tiktok, Capri github; rejects random hosts', () => {
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
  assert.equal(isAllowedOpenUrl('https://ko-fi.com/someone'), true);
  assert.equal(isAllowedOpenUrl('https://www.python.org/downloads/release/python-3119/'), true);
  assert.equal(isAllowedOpenUrl('https://evil.example/phishing'), false);
  assert.equal(isAllowedOpenUrl('https://github.com/other/repo'), false);
  assert.equal(isAllowedOpenUrl('http://discord.gg/wmVfYdjpdA'), false);
});
