'use strict';

// "buscame X en Google" / "buscá X en Spotify": open the search page, never read the results.

const { normalizeCommandText } = require('./command-text');

const QUICK_SEARCH_RE = /^busca(?:me|r)?(?: (.+?))? en (google|spotify)$/;
// "buscá la canción X en Spotify" is a song search: the music player owns it.
const SONG_QUERY = /^(?:la |el )?(?:cancion|tema|rola|pista|musica)\b/;

/** Web page for a search: Google, or Spotify's search when the desktop app does not answer. */
function searchUrl(target, query) {
  const q = encodeURIComponent(String(query || '').trim());
  return target === 'spotify'
    ? `https://open.spotify.com/search/${q}`
    : `https://www.google.com/search?q=${q}`;
}

/** `{ target, query }`, or null. An empty query means she has to ask what to search. */
function parseQuickSearch(text) {
  const said = normalizeCommandText(text).replace(/\s+por favor$/, '').trim();
  const hit = QUICK_SEARCH_RE.exec(said);
  if (!hit) return null;
  const query = String(hit[1] || '').trim();
  if (SONG_QUERY.test(query)) return null;
  return { target: hit[2], query };
}

module.exports = { parseQuickSearch, searchUrl };
