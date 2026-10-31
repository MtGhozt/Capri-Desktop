'use strict';

// First-run: nothing can answer yet → open Cerebro with a short Capri welcome.

const SETUP_HINT = 'Choom, todavía no tengo cerebro. Elige una tarjeta: key gratis (NVIDIA o Gemini), en tu PC, o tu propia key. Luego dale a Probar.';

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
