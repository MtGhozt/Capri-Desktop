// Visible overlay state. One source of truth for the CAPRI // label.

export const STATES = Object.freeze([
  'BOOTING', 'OFFLINE', 'DORMANT', 'ONLINE', 'LISTENING', 'THINKING', 'TALKING',
]);

const ALLOWED = {
  BOOTING: ['ONLINE', 'OFFLINE', 'DORMANT'],
  OFFLINE: ['BOOTING', 'ONLINE', 'DORMANT'],
  DORMANT: ['ONLINE', 'BOOTING', 'OFFLINE', 'LISTENING'],
  ONLINE: ['DORMANT', 'THINKING', 'TALKING', 'LISTENING', 'BOOTING', 'OFFLINE'],
  LISTENING: ['ONLINE', 'THINKING', 'DORMANT', 'BOOTING', 'OFFLINE'],
  THINKING: ['TALKING', 'ONLINE', 'OFFLINE', 'DORMANT'],
  TALKING: ['ONLINE', 'THINKING', 'OFFLINE', 'DORMANT'],
};

export function statusText(state, pct = 0) {
  if (state === 'THINKING') {
    const n = String(Math.max(0, Math.min(99, pct))).padStart(3, '0');
    return `decrypting ${n} %`;
  }
  return state;
}

export class Machine {
  constructor(initial = 'ONLINE') {
    this.value = initial;
    this.pct = 0;
    this.dev = false;
    this.listeners = new Set();
  }

  get() {
    return this.value;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setPct(pct) {
    this.pct = pct;
    this.emit();
  }

  set(next) {
    if (next === this.value) return true;
    if (!ALLOWED[this.value]?.includes(next)) {
      if (this.dev) console.warn(`[capri] ignore state ${this.value} -> ${next}`);
      return false;
    }
    this.value = next;
    if (next !== 'THINKING') this.pct = 0;
    this.emit();
    return true;
  }

  emit() {
    for (const fn of this.listeners) fn(this.value, this.pct);
  }
}
