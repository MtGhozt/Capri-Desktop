'use strict';

// CEREBRO (4K + fase 5): who answers her, the encrypted cloud keys and the probe from Ajustes.
// Switching keeps each local URL/model apart; a key never leaves its own encrypted file.

const path = require('node:path');
const fs = require('node:fs');
const { app, safeStorage } = require('electron');

const config = require('./config');
const { createTokenStore } = require('./spotify');
const {
  PROVIDERS, activeBrainIds, defaultBaseUrl, providerAfterKeyRemoved, isAgent,
} = require('./chat-providers');
const { switchProvider, setProviderModel, modelForProvider } = require('./chat-models');
const { detectAgents, pickAuto } = require('./agent-brain');
const { probeProvider } = require('./llm-probe');

function createChatSettings({ updateConfig }) {

  // Cloud chat keys, kept encrypted with your Windows account in their own file: never in config.json,
  // never in a log (Paso 4K). Same store as Spotify's tokens.
  const llmKeysFile = () => path.join(app.getPath('userData'), 'llm-keys');
  const llmKeys = () => createTokenStore({ file: llmKeysFile(), safeStorage });
  function llmKey(id) {
    return String(llmKeys().read()?.[id] || '');
  }
  function saveLlmKey(id, key) {
    const all = llmKeys().read();
    // A file we cannot decrypt keeps every key in it: writing just this one would wipe the rest.
    if (!all && fs.existsSync(llmKeysFile())) {
      console.error('[capri] llm-keys could not be decrypted; left it untouched');
      return null;
    }
    const next = all || {};
    const clean = String(key || '').trim();
    if (clean) next[id] = clean;
    else delete next[id];
    llmKeys().write(next);
    return Boolean(clean);
  }

  function hasAnyLlmKey() {
    const all = llmKeys().read() || {};
    return Object.values(all).some((value) => String(value || '').trim());
  }

  function setChatProvider(id) {
    if (!PROVIDERS[id]) return { ok: false, message: 'Ese proveedor no existe.' };
    const cfg = config.load();
    const active = activeBrainIds(cfg.llm);
    const enabled = active.includes(id);
    const brains = enabled
      ? active.filter((brain) => brain !== id)
      : (() => {
        const next = active.filter((brain) => brain !== id);
        const localIndex = next.indexOf('local');
        next.splice(localIndex < 0 ? next.length : localIndex, 0, id);
        return next;
      })();
    if (!brains.length) brains.push('local');
    const primary = brains[0];
    const next = switchProvider(cfg.llm || {}, primary, PROVIDERS);
    const patch = { provider: next.provider, brains, model: next.model, models: next.models };
    if (primary === 'local') patch.localModel = next.model;
    // Picking a specific CLI sets the Automático primary for later.
    const agentKind = PROVIDERS[primary].agent;
    if (agentKind && agentKind !== 'auto') patch.agentPreferred = agentKind;
    if (PROVIDERS[primary].local) {
      const urls = { ...(cfg.llm?.baseUrls || {}) };
      const from = String(cfg.llm?.provider || 'local');
      if (PROVIDERS[from]?.local && cfg.llm?.baseUrl) urls[from] = cfg.llm.baseUrl;
      patch.baseUrl = urls[primary] || defaultBaseUrl(primary);
      patch.baseUrls = { ...urls, [primary]: patch.baseUrl };
    }
    updateConfig({ llm: patch });
    return { ok: true };
  }

  function setChatModel(value) {
    const provider = String(value?.provider || config.load().llm?.provider || 'local');
    const model = String(value?.model ?? value ?? '').trim().slice(0, 120);
    if (!model) return { ok: false, message: 'Falta el nombre del modelo.' };
    const cfg = config.load();
    const next = setProviderModel(cfg.llm || {}, provider, model);
    const patch = {
      models: next.models,
      ...(provider === cfg.llm?.provider ? { model } : {}),
      ...(provider === 'local' ? { localModel: model } : {}),
    };
    if (value?.baseUrl != null && PROVIDERS[provider]?.local) {
      const baseUrl = String(value.baseUrl).trim().replace(/\/+$/, '') || defaultBaseUrl(provider);
      const urls = { ...(cfg.llm?.baseUrls || {}), [provider]: baseUrl };
      if (provider === cfg.llm?.provider) patch.baseUrl = baseUrl;
      patch.baseUrls = urls;
    }
    updateConfig({ llm: patch });
    return { ok: true, model };
  }

  function reorderBrains(value) {
    const cfg = config.load();
    const brains = activeBrainIds(cfg.llm);
    const index = brains.indexOf(String(value?.id || ''));
    const next = index + (value?.direction === 'up' ? -1 : 1);
    if (index < 0 || next < 0 || next >= brains.length) return { ok: true };
    [brains[index], brains[next]] = [brains[next], brains[index]];
    updateConfig({ llm: { brains, provider: brains[0], model: modelForProvider(cfg.llm, brains[0], PROVIDERS) } });
    return { ok: true };
  }

  function setChatKey(value) {
    const provider = String(value?.provider || config.load().llm?.provider || 'local');
    if (!PROVIDERS[provider] || PROVIDERS[provider].local) return { ok: false, message: 'Ese proveedor no usa clave.' };
    const saved = saveLlmKey(provider, value?.key);
    if (saved === null) return { ok: false, message: 'No pude leer las claves guardadas; no toqué nada.' };
    if (!saved) {
      // A removed key that was answering hands her to someone who still has one.
      const active = String(config.load().llm?.provider || 'local');
      const next = providerAfterKeyRemoved(active, provider, (pid) => Boolean(llmKey(pid)));
      if (next !== active) setChatProvider(next);
    }
    return { ok: true, hasKey: saved, message: saved ? 'Clave guardada.' : 'Clave borrada.' };
  }

  async function probeChatFromMenu(value = {}) {
    const id = String(value.provider || config.load().llm?.provider || 'local');
    if (!PROVIDERS[id]) return { ok: false, message: 'Ese proveedor no existe.' };
    if (isAgent(id)) {
      const agents = detectAgents();
      const want = PROVIDERS[id].agent === 'auto'
        ? pickAuto({ installed: agents, preferred: config.load().llm?.agentPreferred })
        : PROVIDERS[id].agent;
      const hit = agents.find((a) => a.id === want);
      if (!hit?.ready) {
        const how = hit?.installHow ? ` Cómo instalarlo: ${hit.installHow}` : '';
        return { ok: false, message: `No encuentro ese agente en el PATH.${how}` };
      }
      setChatProvider(id);
      return { ok: true, message: `Listo. Usaré ${hit.label} (más lento; gasta su plan).` };
    }
    if (value.key != null && !PROVIDERS[id].local) {
      const clean = String(value.key).trim();
      if (clean) saveLlmKey(id, clean);
    }
    if (value.model || value.baseUrl != null) {
      setChatModel({
        provider: id,
        model: value.model || config.load().llm?.model || PROVIDERS[id].model,
        baseUrl: value.baseUrl,
      });
    }
    const cfg = config.load();
    const result = await probeProvider({
      id,
      model: String(cfg.llm?.models?.[id] || (id === 'local' ? cfg.llm?.localModel : null) || PROVIDERS[id].model),
      key: PROVIDERS[id].local ? '' : llmKey(id),
      baseUrl: cfg.llm?.baseUrls?.[id] || cfg.llm?.baseUrl,
    });
    // Capri's line only — never echo the key or the raw server body.
    return { ok: Boolean(result.ok), message: String(result.message || '') };
  }

  return {
    llmKey,
    saveLlmKey,
    hasAnyLlmKey,
    setChatProvider,
    setChatModel,
    reorderBrains,
    setChatKey,
    probeChatFromMenu,
  };
}

module.exports = { createChatSettings };
