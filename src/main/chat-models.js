'use strict';

function modelForProvider(cfg, id, providers) {
  return String(cfg.models?.[id] || (id === 'local' ? cfg.localModel : cfg.model) || providers[id]?.model || '');
}

function switchProvider(cfg, id, providers) {
  const models = { ...(cfg.models || {}), [cfg.provider]: cfg.model };
  return { ...cfg, provider: id, model: modelForProvider({ ...cfg, models }, id, providers), models };
}

function setProviderModel(cfg, id, model) {
  return { ...cfg, model, models: { ...(cfg.models || {}), [id]: model } };
}

module.exports = { modelForProvider, switchProvider, setProviderModel };
