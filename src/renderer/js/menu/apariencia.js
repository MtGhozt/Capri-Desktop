import { THEME_OPTIONS } from './widgets.js';

// SIN GPU asks once (CONFIRMAR) before the relaunch.
export function pickRender(menu, id, state) {
  const current = state?.cfg?.render || 'auto';
  if (id === 'software' && id !== current && !menu.confirmSoftware) {
    menu.confirmSoftware = true;
    if (menu.lastState) menu.render(menu.lastState);
    return;
  }
  menu.confirmSoftware = false;
  menu.act('render', id);
}

export function render(menu, state, ctx) {
  const { cfg } = state;
  const { section, toggle, selector, labelNode, action, body, build } = ctx;

  section('APARIENCIA', 'bubble');
  toggle('Animaciones de apps', {
    setting: 'bubble',
    on: cfg.appFx !== false,
    labels: ['INACTIVO', 'ACTIVO'],
    onChange: (on) => menu.act('app-fx', on),
  });
  toggle('Caja de mensaje', {
    setting: 'bubble',
    on: cfg.scanlines !== false,
    labels: ['PLANA', 'FX'],
    onChange: (on) => menu.act('scanlines', on),
  });
  selector('Tema', {
    setting: 'bubble',
    options: THEME_OPTIONS,
    current: cfg.theme,
    onChange: (id) => menu.act('theme', id),
  });
  const renderOptions = [
    { id: 'auto', label: 'Automático (recomendado)', hint: 'Usa la configuración gráfica normal de Windows.' },
    { id: 'gl', label: 'OpenGL (experimental)', hint: 'Si Capri se vuelve invisible o transparente, volvé a Automático.' },
    { id: 'software', label: 'Sin GPU (lento)', hint: 'Dibuja por CPU; sirve como último recurso.' },
  ];
  const screenLabel = build('div', 'appmenu__row');
  screenLabel.dataset.setting = 'bubble';
  screenLabel.append(labelNode('Pantalla', 'screen'));
  body.append(screenLabel);
  const renderRow = build('div', 'appmenu__radio-group');
  renderRow.dataset.setting = 'bubble';
  for (const option of renderOptions) {
    const label = build('label', 'appmenu__radio');
    const input = build('input');
    input.type = 'radio';
    input.name = 'capri-render';
    input.checked = (cfg.render || 'auto') === option.id;
    input.addEventListener('change', () => pickRender(menu, option.id, state));
    label.append(input, build('span', 'appmenu__label', option.label));
    // OpenGL's warning only shows while it is the chosen one
    const hint = option.id === 'gl' && !input.checked ? '' : option.hint;
    if (hint) label.append(build('span', 'appmenu__hint', hint));
    renderRow.append(label);
  }
  body.append(renderRow);
  if (menu.confirmSoftware) {
    action('SIN GPU', {
      setting: 'bubble',
      value: 'CONFIRMAR',
      danger: true,
      onClick: () => {
        menu.confirmSoftware = false;
        menu.act('render', 'software');
      },
    });
  }
}