'use strict';

// Optional check against GitHub Releases. Never blocks boot; failures stay quiet in the log.

const REPO = 'MtGhozt/Capri-Desktop';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseTag(tag) {
  const m = String(tag || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(remote, local) {
  const a = parseTag(remote);
  const b = parseTag(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function due({ enabled, lastCheck, now = Date.now(), everyMs = DAY_MS } = {}) {
  if (enabled === false) return false;
  const last = Number(lastCheck) || 0;
  return !last || now - last >= everyMs;
}

async function fetchLatest({ fetchImpl = fetch, timeoutMs = 4000, url = RELEASES_URL } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Capri-Desktop' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const json = await res.json();
    const tag = String(json.tag_name || '');
    const htmlUrl = String(json.html_url || `https://github.com/${REPO}/releases/latest`);
    if (!parseTag(tag)) throw new Error('bad tag');
    return { tag, version: tag.replace(/^v/i, ''), url: htmlUrl };
  } finally {
    clearTimeout(timer);
  }
}

async function checkForUpdate({
  localVersion,
  skippedVersion,
  enabled,
  lastCheck,
  now = Date.now(),
  fetchImpl,
  timeoutMs,
} = {}) {
  if (!due({ enabled, lastCheck, now })) return { checked: false, update: null };
  try {
    const latest = await fetchLatest({ fetchImpl, timeoutMs });
    const skip = String(skippedVersion || '').replace(/^v/i, '');
    const remote = latest.version;
    if (skip && skip === remote) return { checked: true, update: null, latest };
    if (!isNewer(remote, localVersion)) return { checked: true, update: null, latest };
    return { checked: true, update: latest, latest };
  } catch (err) {
    return { checked: true, update: null, error: err.message || String(err) };
  }
}

module.exports = {
  REPO, RELEASES_URL, DAY_MS, parseTag, isNewer, due, fetchLatest, checkForUpdate,
};
