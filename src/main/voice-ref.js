'use strict';

// Custom clone ref for Ajustes › AUDIO: a short .wav + exact transcript → voice/ref/my_ref.*.
// ttsRef null means OmniVoice voice-design (ttsDesign), not “TTS off”.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TTS_DESIGN = 'voz femenina joven, juguetona, español latino, clara';
const CUSTOM_REF_REL = path.join('ref', 'my_ref.wav');

function activeVoiceLabel(voice) {
  return String(voice?.ttsRef || '').trim() ? 'Tu voz (archivo)' : 'Voz por defecto';
}

function usesCloneRef(voice) {
  return Boolean(String(voice?.ttsRef || '').trim());
}

function saveCustomRef({
  voiceDir,
  wavPath,
  transcript,
  transcriptPath,
  copyFileSync = fs.copyFileSync,
  writeFileSync = fs.writeFileSync,
  mkdirSync = fs.mkdirSync,
  existsSync = fs.existsSync,
} = {}) {
  const wav = String(wavPath || '').trim();
  const sidecar = wav.replace(/\.wav$/i, '.txt');
  const textFile = transcriptPath || (existsSync(sidecar) ? sidecar : '');
  const text = String(transcript || (textFile && fs.readFileSync(textFile, 'utf8')) || '').trim();
  if (!text) return { ok: false, message: 'Escribí la transcripción exacta del audio.' };
  const dir = path.resolve(String(voiceDir || '').trim());
  if (!dir || !existsSync(dir)) {
    return { ok: false, message: 'Instalá o elegí la carpeta de voz primero.' };
  }
  const src = path.resolve(wav);
  if (!src || !existsSync(src) || !/\.wav$/i.test(src)) {
    return { ok: false, message: 'Elegí un archivo .wav corto (unos 5–15 s).' };
  }
  const refDir = path.join(dir, 'ref');
  mkdirSync(refDir, { recursive: true });
  const destWav = path.join(dir, CUSTOM_REF_REL);
  const destTxt = destWav.replace(/\.wav$/i, '.txt');
  copyFileSync(src, destWav);
  writeFileSync(destTxt, `${text}\n`, 'utf8');
  return { ok: true, ttsRef: CUSTOM_REF_REL.replace(/\\/g, '/'), message: 'Tu voz (archivo) lista.' };
}

module.exports = {
  DEFAULT_TTS_DESIGN,
  CUSTOM_REF_REL,
  activeVoiceLabel,
  usesCloneRef,
  saveCustomRef,
};
