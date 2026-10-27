// Spanish badges on the message box. The DORMANT widget still uses the English machine names.

const BADGE = {
  ONLINE: 'EN ESPERA',
  LISTENING: 'ESCUCHANDO',
  THINKING: 'PENSANDO',
  TALKING: 'HABLANDO',
  DORMANT: 'DORMIDA',
  BOOTING: 'EN ESPERA',
  OFFLINE: 'EN ESPERA',
};

export function messageBadge(state) {
  return BADGE[state] || 'EN ESPERA';
}

export { BADGE };
