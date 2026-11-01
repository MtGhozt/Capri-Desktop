'use strict';

// Links and copy for Ajustes › Acerca de. Missing community/donate URLs stay hidden (TODO).

const LINKS = {
  github: 'https://github.com/MtGhozt/Capri-Desktop',
  releases: 'https://github.com/MtGhozt/Capri-Desktop/releases',
  issues: 'https://github.com/MtGhozt/Capri-Desktop/issues/new',
  readme: 'https://github.com/MtGhozt/Capri-Desktop#readme',
  changelog: 'https://github.com/MtGhozt/Capri-Desktop/blob/main/CHANGELOG.md',
  license: 'https://github.com/MtGhozt/Capri-Desktop/blob/main/LICENSE',
  tiktok: 'https://www.tiktok.com/@mtghozt',
  discord: 'https://discord.gg/wmVfYdjpdA',
  kofi: '', // TODO: paste Ko-fi when ready
};

const AUTHOR = 'MtGhozt';

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
    donate: LINKS.kofi ? [{ id: 'kofi', label: 'Ko-fi', url: LINKS.kofi }] : [],
    other: [
      { id: 'license', label: 'Licencia', url: LINKS.license },
      { id: 'check-updates', label: 'Buscar actualizaciones', action: 'check-updates' },
      { id: 'share-logs', label: 'Compartir registros', action: 'share-logs' },
    ],
    links: LINKS,
  };
}

module.exports = { LINKS, AUTHOR, aboutInfo };
