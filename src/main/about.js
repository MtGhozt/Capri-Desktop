'use strict';

// Links and copy for Ajustes › Acerca de. Missing community/donate URLs stay hidden (TODO).

// TODO(donate): paste the real Ko-fi URL here. While empty, the "Donar" button stays hidden.
const KOFI_URL = '';

const LINKS = {
  github: 'https://github.com/MtGhozt/Capri-Desktop',
  releases: 'https://github.com/MtGhozt/Capri-Desktop/releases',
  issues: 'https://github.com/MtGhozt/Capri-Desktop/issues/new',
  readme: 'https://github.com/MtGhozt/Capri-Desktop#readme',
  changelog: 'https://github.com/MtGhozt/Capri-Desktop/blob/main/CHANGELOG.md',
  license: 'https://github.com/MtGhozt/Capri-Desktop/blob/main/LICENSE',
  tiktok: 'https://www.tiktok.com/@mtghozt',
  discord: 'https://discord.gg/wmVfYdjpdA',
  kofi: KOFI_URL,
};

const AUTHOR = 'MtGhozt';

// Hosts Capri may open from Acerca de / Cerebro / help "?" (http or https only).
const OPEN_HOSTS = new Set([
  'discord.gg', 'discord.com', 'www.discord.com',
  'tiktok.com', 'www.tiktok.com',
  'github.com',
  'python.org', 'www.python.org',
  'build.nvidia.com', 'aistudio.google.com',
  'console.anthropic.com', 'console.x.ai', 'platform.openai.com',
  'developer.spotify.com',
  'ko-fi.com', 'www.ko-fi.com',
]);

function isAllowedOpenUrl(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (!OPEN_HOSTS.has(host) && !host.endsWith('.discord.com')) return false;
    if (host === 'github.com' && !u.pathname.startsWith('/MtGhozt/Capri-Desktop')) return false;
    return true;
  } catch {
    return false;
  }
}

function aboutInfo({ version } = {}) {
  return {
    name: 'Capri',
    version: String(version || ''),
    author: AUTHOR,
    icon: '../../assets/icons/capri.png',
    community: [
      LINKS.discord ? { id: 'discord', label: 'Discord', url: LINKS.discord } : null,
      LINKS.tiktok ? { id: 'tiktok', label: 'TikTok', url: LINKS.tiktok } : null,
    ].filter(Boolean),
    dev: [
      { id: 'readme', label: 'Guía', url: LINKS.readme },
      { id: 'github', label: 'GitHub', url: LINKS.github },
      { id: 'issues', label: 'Reportar un bug', url: LINKS.issues },
      { id: 'changelog', label: 'Registro de cambios', url: LINKS.changelog },
    ],
    donate: KOFI_URL ? [{ id: 'kofi', label: 'Ko-fi', url: KOFI_URL }] : [],
    other: [
      { id: 'license', label: 'Licencia', url: LINKS.license },
      { id: 'check-updates', label: 'Buscar actualizaciones', action: 'check-updates' },
      { id: 'share-logs', label: 'Compartir registros', action: 'share-logs' },
    ],
    links: LINKS,
  };
}

module.exports = { LINKS, KOFI_URL, AUTHOR, OPEN_HOSTS, isAllowedOpenUrl, aboutInfo };
