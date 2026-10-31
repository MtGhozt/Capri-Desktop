'use strict';

// Saved model for this provider, else its catalog default — never another provider's current model.
function modelForProvider(cfg, id, providers) {
  if (cfg.models?.[id]) return String(cfg.models[id]);
  if (id === 'local' && cfg.localModel) return String(cfg.localModel);
  return String(providers[id]?.model || '');
}

function switchProvider(cfg, id, providers) {
  const models = { ...(cfg.models || {}), [cfg.provider]: cfg.model };
  return { ...cfg, provider: id, model: modelForProvider({ ...cfg, models }, id, providers), models };
}

function setProviderModel(cfg, id, model) {
  return { ...cfg, model, models: { ...(cfg.models || {}), [id]: model } };
}

module.exports = { modelForProvider, switchProvider, setProviderModel };
