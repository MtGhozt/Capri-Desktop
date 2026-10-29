'use strict';

// First-run: nothing can answer yet → open Modelo y clave with a short Spanish hint.

const SETUP_HINT = 'Todavía no hay modelo que me conteste. Pega una clave gratis de Gemini en https://aistudio.google.com/apikey (o usa OpenRouter / LM Studio en local).';

function needsModelSetup({ hasAnyKey = false, localReachable = false } = {}) {
  if (hasAnyKey) return false;
  return !localReachable;
}

async function probeLocalLlm(baseUrl, { fetchImpl = fetch, timeoutMs = 1200 } = {}) {
  const root = String(baseUrl || 'http://localhost:1235/v1').replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${root}/models`, { signal: ctrl.signal });
    return Boolean(res?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { needsModelSetup, probeLocalLlm, SETUP_HINT };
