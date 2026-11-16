'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  THRESHOLDS,
  recommendProfile,
  hardwareFingerprint,
  detectHardware,
  matchesConfig,
  applyPatch,
  bubbleLine,
  shouldOfferBubble,
  cudaArchSupported,
} = require('../src/main/recommend-profile');

test('recommendProfile: NVIDIA + enough VRAM + supported arch → OmniVoice CUDA', () => {
  const rec = recommendProfile({
    gpu: 'nvidia', vramMB: 8192, ramMB: 32768, cores: 16, computeCap: '8.9',
  });
  assert.equal(rec.voice, 'omnivoice-cuda');
  assert.equal(rec.whisper, 'small');
  assert.equal(rec.lightAnimations, false);
  assert.match(rec.reason, /OmniVoice/);
});

test('recommendProfile: no NVIDIA → Kokoro', () => {
  const rec = recommendProfile({ gpu: 'none', vramMB: 0, ramMB: 16384, cores: 8 });
  assert.equal(rec.voice, 'kokoro');
  assert.equal(rec.whisper, 'small');
  assert.equal(rec.lightAnimations, false);
});

test('recommendProfile: low VRAM NVIDIA still gets Kokoro', () => {
  const rec = recommendProfile({
    gpu: 'nvidia',
    vramMB: THRESHOLDS.OMNI_VRAM_MB - 1,
    ramMB: 16384,
    cores: 8,
    computeCap: '8.9',
  });
  assert.equal(rec.voice, 'kokoro');
});

test('recommendProfile: unsupported compute_cap → Kokoro with Spanish reason', () => {
  assert.equal(cudaArchSupported('6.1'), false);
  const rec = recommendProfile({
    gpu: 'nvidia', vramMB: 8192, ramMB: 32768, cores: 16, computeCap: '6.1',
  });
  assert.equal(rec.voice, 'kokoro');
  assert.match(rec.reason, /sm_61/);
  assert.match(rec.reason, /no es compatible con OmniVoice/);
  assert.match(rec.reason, /Kokoro/);
});

test('recommendProfile: missing compute_cap → Kokoro with Spanish reason', () => {
  const rec = recommendProfile({
    gpu: 'nvidia', vramMB: 8192, ramMB: 32768, cores: 16,
  });
  assert.equal(rec.voice, 'kokoro');
  assert.match(rec.reason, /arquitectura CUDA/i);
  assert.match(rec.reason, /Kokoro/);
});

test('recommendProfile: low RAM/cores → smaller Whisper + light animations', () => {
  const rec = recommendProfile({ gpu: 'none', vramMB: 0, ramMB: 4096, cores: 2 });
  assert.equal(rec.voice, 'kokoro');
  assert.equal(rec.whisper, 'base');
  assert.equal(rec.lightAnimations, true);
  assert.match(bubbleLine(rec), /Kokoro/);
  assert.match(bubbleLine(rec), /Whisper base/);
  assert.match(bubbleLine(rec), /animaciones ligeras/);
});

test('no bubble when config already matches', () => {
  const hw = { gpu: 'none', vramMB: 0, ramMB: 16384, cores: 8 };
  const rec = recommendProfile(hw);
  const cfg = {
    welcomed: true,
    voice: { tts: 'kokoro', sttModel: 'small' },
    fx: { apps: true },
    profile: { dismissedHw: '' },
  };
  assert.equal(matchesConfig(cfg, rec), true);
  assert.equal(shouldOfferBubble({ cfg, rec, hw, firstRun: false }), false);
});

test('no bubble after Ahora no for the same hardware', () => {
  const hw = { gpu: 'nvidia', vramMB: 8192, ramMB: 32768, cores: 16, computeCap: '8.9' };
  const rec = recommendProfile(hw);
  const cfg = {
    welcomed: true,
    voice: { tts: 'off', sttModel: 'auto' },
    fx: { apps: true },
    profile: { dismissedHw: hardwareFingerprint(hw) },
  };
  assert.equal(shouldOfferBubble({ cfg, rec, hw }), false);
  assert.equal(shouldOfferBubble({ cfg, rec, hw, force: true }), true);
});

test('Aplicar writes only those keys', () => {
  const rec = recommendProfile({ gpu: 'none', vramMB: 0, ramMB: 4096, cores: 2 });
  const patch = applyPatch(rec);
  assert.deepEqual(Object.keys(patch).sort(), ['fx', 'voice']);
  assert.deepEqual(Object.keys(patch.voice).sort(), ['sttModel', 'tts']);
  assert.deepEqual(Object.keys(patch.fx), ['apps']);
  assert.equal(patch.voice.tts, 'kokoro');
  assert.equal(patch.voice.sttModel, 'base');
  assert.equal(patch.fx.apps, false);

  const strong = applyPatch(recommendProfile({
    gpu: 'nvidia', vramMB: 8192, ramMB: 32768, cores: 16, computeCap: '8.9',
  }));
  assert.equal(strong.voice.tts, 'omnivoice');
  assert.equal(strong.voice.sttModel, 'small');
  assert.equal(strong.fx.apps, true);
});

test('detectHardware: failure / empty probe → null; nvidia-smi hit → nvidia + computeCap', () => {
  assert.equal(detectHardware({
    readVramImpl: () => null,
    osImpl: { totalmem: () => 0, cpus: () => [] },
  }), null);
  const hit = detectHardware({
    readVramImpl: () => ({ usedMiB: 100, totalMiB: 8192, computeCap: '8.9' }),
    osImpl: { totalmem: () => 16 * 1024 * 1024 * 1024, cpus: () => [1, 2, 3, 4] },
  });
  assert.equal(hit.gpu, 'nvidia');
  assert.equal(hit.vramMB, 8192);
  assert.equal(hit.ramMB, 16384);
  assert.equal(hit.cores, 4);
  assert.equal(hit.computeCap, '8.9');
});

test('shouldOfferBubble skips game quiet and first run', () => {
  const hw = { gpu: 'none', vramMB: 0, ramMB: 16384, cores: 8 };
  const rec = recommendProfile(hw);
  const cfg = {
    welcomed: false,
    voice: { tts: 'off', sttModel: 'auto' },
    fx: { apps: true },
    profile: { dismissedHw: '' },
  };
  assert.equal(shouldOfferBubble({ cfg, rec, hw, firstRun: true }), false);
  assert.equal(shouldOfferBubble({ cfg, rec, hw, firstRun: false, gameQuiet: true }), false);
  assert.equal(shouldOfferBubble({ cfg, rec, hw, firstRun: false, force: true }), true);
});
