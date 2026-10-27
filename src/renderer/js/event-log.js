// Colour-coded lines under Capri's message. Newest at the bottom; older ones drop off.

export const LOG_KINDS = Object.freeze(['oido', 'despierta', 'pregunta', 'cerrado', 'abierto', 'sistema']);

const DEFAULT_LIMIT = 4;

export class EventLog {
  constructor({ limit = DEFAULT_LIMIT } = {}) {
    this.limit = Math.max(1, Number(limit) || DEFAULT_LIMIT);
    this.lines = [];
  }

  setLimit(n) {
    const next = Math.max(1, Number(n) || DEFAULT_LIMIT);
    this.limit = next;
    this.trim();
  }

  push(kind, text = '') {
    this.lines.push({ kind, text: String(text ?? '') });
    this.trim();
    return this.lines;
  }

  trim() {
    while (this.lines.length > this.limit) this.lines.shift();
  }
}

export const DEFAULT_LOG_LIMIT = DEFAULT_LIMIT;
