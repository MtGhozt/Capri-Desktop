'use strict';

// The mutable state that main.js and the modules split out of it share. One object instead of
// module-level globals: whoever moves out takes this with it. Instances (overlay, voice, llm…)
// are passed as getters, not here.
module.exports = {
  overlayFolded: false, // her window is put away (DORMANT)
  ttsLoading: false, // the sidecar is loading a voice
  voiceTalking: false, // she is speaking right now
  llmBusy: false, // a turn is waiting on the model
  lastTts: null, // last tts_state from the sidecar: engine ('off' | 'kokoro' | 'omnivoice') + state
  lastHeard: '', // the last thing Whisper wrote, before her fixes (Corregir lo último)
};
