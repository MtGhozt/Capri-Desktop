'use strict';

// A cloud model's answer, before she shows it or says it: some of them open with a safety
// classifier line, think out loud, or answer in Markdown, which she would then read out loud as
// "asterisco asterisco". Everything here is for her answers only; the local model is left alone.

const SAFETY_VERDICT = /^\s*(?:user\s+)?safety\s*[:\-–]\s*(?:safe|unsafe|unknown)\b[.:!]*\s*/i;
const SAFETY_TAG = /<\/?\s*safety(?:_classification)?\s*>/gi;
const SAFETY_BRACKET = /\[\s*(?:safe|unsafe|unknown)\s*\]/gi;
const BARE_VERDICT = /^\s*(?:safe|unsafe)\s*$/i;
const THINKING = /<(think|reasoning|thought)\b[^>]*>[\s\S]*?<\/\1>/gi;
const THINKING_OPEN = /<(think|reasoning|thought)\b[^>]*>(?![\s\S]*<\/\1>)/i;

const HEADING = /^\s{0,3}#{1,6}\s+/;
const BULLET = /^\s*(?:[-*+•]|\d{1,2}[.)])\s+/;
const QUOTE = /^\s*>\s?/;

// Where her streamed answer may be handed over: a sentence end or a line break, so a word or a
// ** pair is never split in two pieces of her answer.
const BOUNDARY = /(?<!\d)[.!?…]+(?:["»”')\]]+)?(?:\s+|$)|[\n\r]+/g;
const LONG_RUN = 240;

function withoutMarkdown(text) {
  return text
    .replace(/```[^\n]*\n?[\s\S]*?(?:```|$)/g, ' ') // a code block is read out loud nothing but noise
    .replace(/`([^`\n]*)`/g, '$1') // inline code keeps its text
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // bold
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1$2') // italics with underscores
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2') // italics with stars
    .replace(/~~(.+?)~~/g, '$1') // struck through
    .replace(/[*_`]+/g, ''); // whatever is left of the markers
}

/** The answer as plain text: no classifier, no reasoning, no Markdown. */
function cleanText(raw) {
  let text = String(raw ?? '');
  text = text.replace(THINKING, ' ');
  text = text.replace(THINKING_OPEN, ' '); // never closed: the token limit came first
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const kept = [];
  for (const raw of lines) {
    let line = raw.replace(SAFETY_TAG, ' ').replace(SAFETY_BRACKET, ' ').replace(SAFETY_VERDICT, '');
    if (BARE_VERDICT.test(line)) continue; // the classifier said its word and nothing else
    line = line.replace(HEADING, '').replace(BULLET, '').replace(QUOTE, '');
    kept.push(line);
  }
  // Collapse runs of spaces/tabs inside a line, but never eat the space after ".!?" or
  // spaces around newlines — stream chunks are concatenated as-is.
  return withoutMarkdown(kept.join('\n'))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}

// Where a stream may be cut: after the last sentence end, or at a space once it runs long.
function cutPoint(text) {
  BOUNDARY.lastIndex = 0;
  let cut = 0;
  let match;
  while ((match = BOUNDARY.exec(text))) cut = match.index + match[0].length;
  if (cut) return cut;
  if (text.length < LONG_RUN) return 0;
  const at = text.lastIndexOf(' ');
  return at > 0 ? at + 1 : 0;
}

/**
 * Cleans an answer as it streams in, handing it over sentence by sentence. The tail (a word half
 * arrived, a tag still opening, a `<think>` block not closed) waits in the buffer.
 */
function createStreamCleaner({ onText } = {}) {
  let buf = '';

  // cleanText trims; streamed pieces are concatenated, so keep the whitespace the model put
  // between sentences ("pasa? " + "No" → not "pasa?No").
  function emit(text, { final = false } = {}) {
    const lead = text.match(/^\s*/)?.[0] || '';
    const trail = text.match(/\s*$/)?.[0] || '';
    let clean = cleanText(text);
    if (!clean && !final) return;
    if (!final) {
      if (lead && !/^\s/.test(clean)) clean = (lead.includes('\n') ? '\n' : ' ') + clean;
      if (trail && !/\s$/.test(clean)) clean += trail.includes('\n') ? '\n' : ' ';
    }
    if (clean) onText?.(clean);
  }

  return {
    push(piece) {
      buf += String(piece ?? '');
      if (/<[^>]*$/.test(buf)) return; // a tag is still being written
      if (THINKING_OPEN.test(buf)) return; // still thinking: nothing of it is hers to say
      const cut = cutPoint(buf);
      if (!cut) return;
      const ready = buf.slice(0, cut);
      buf = buf.slice(cut);
      emit(ready);
    },
    // The answer is over (or the cloud gave up): whatever is left still has to be said.
    flush() {
      const rest = buf;
      buf = '';
      emit(rest, { final: true });
    },
  };
}

module.exports = { cleanText, createStreamCleaner };
