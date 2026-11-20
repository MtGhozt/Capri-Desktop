export function render(menu, state, ctx) {
  const { section, action } = ctx;

  section('MEMORIA Y PERSONALIDAD', 'memory');
  action('Olvidar conversación', {
    value: menu.confirmForget ? 'CONFIRMAR' : '',
    danger: menu.confirmForget,
    onClick: () => menu.act('forget'),
  });
  action('Abrir personalidad', {
    setting: 'memory',
    value: 'PERSONA.MD',
    onClick: () => menu.act('persona-open'),
  });
  action('Abrir memoria', {
    setting: 'memory',
    value: 'MEMORY.MD',
    onClick: () => menu.act('memory-open'),
  });
  action('Recargar personalidad', { setting: 'memory', value: 'RELEER', onClick: () => menu.act('persona-reload') });
}