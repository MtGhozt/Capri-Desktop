// "?" help button, help panel, and floating submenu placement.

import { HELP_STEPS, toggleHelp, splitHelpText } from '../help-steps.js';

// Keep the "?" panel inside its host (.appmenu). Settings uses overflow:hidden on the
// content pane — viewport-relative left flips used to park half the panel under the tabs.
export function placeHelpPanel({ main, anchor, width, height, pad = 8, gap = 8 } = {}) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  let x = anchor.right + gap;
  if (x + w > main.right - pad) x = anchor.left - gap - w;
  if (x < main.left + pad) x = main.left + pad;
  if (x + w > main.right - pad) x = Math.max(main.left + pad, main.right - pad - w);

  let y = anchor.top;
  if (y + h > main.bottom - pad) y = Math.max(main.top + pad, main.bottom - pad - h);
  if (y < main.top + pad) y = main.top + pad;
  return { left: x - main.left, top: y - main.top };
}

export function placeSubmenu(app) {
  const panel = app.el.querySelector('.appmenu__submenu');
  if (!panel) return;
  const host = app.el.getBoundingClientRect();
  if (!host.width) return;
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  // After re-render the old rect is stale (scroll restore); prefer the live "?".
  const live = app.helpOpen
    && app.el.querySelector(`.appmenu__help[data-help="${app.helpOpen}"]`);
  if (live) app.helpAnchor = live.getBoundingClientRect();
  if (app.helpOpen && app.helpAnchor) {
    const { left, top } = placeHelpPanel({
      main: host, anchor: app.helpAnchor, width: w, height: h,
    });
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    return;
  }
  // Quick-menu selector: park beside the plate (same as before).
  const main = (app.el.querySelector('.appmenu__quick-plate') || app.el.querySelector('.appmenu__plate'))?.getBoundingClientRect() || host;
  const anchor = app.quickAnchor || main;
  const right = main.right + 8;
  const leftSide = main.left - w - 8;
  const x = right + w <= innerWidth - 8 ? right : Math.max(8, leftSide);
  const y = Math.min(Math.max(8, anchor.top ?? main.top), innerHeight - h - 8);
  panel.style.left = `${Math.round(x - host.left)}px`;
  panel.style.top = `${Math.round(y - host.top)}px`;
}

// The "?" that opens a HELP_STEPS panel, in Ajustes and in the quick menu.
export function helpButton(app, helpId) {
  // A span, not a button: some rows are buttons and a nested one is invalid HTML.
  const btn = document.createElement('span');
  btn.className = 'appmenu__help';
  btn.textContent = '?';
  btn.setAttribute('role', 'button');
  btn.tabIndex = 0;
  btn.dataset.help = helpId;
  btn.title = 'Cómo se hace';
  btn.setAttribute('aria-expanded', String(app.helpOpen === helpId));
  const openHelp = () => {
    app.helpOpen = toggleHelp(app.helpOpen, helpId);
    app.helpAnchor = null; // placeSubmenu reads the live "?" after render
    if (app.lastState) app.render(app.lastState);
    else requestAnimationFrame(() => app.placeSubmenu());
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openHelp();
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    openHelp();
  });
  return btn;
}

// The numbered steps for one "?", beside the button that opened it.
// http(s) in the copy open via menu open-url → shell.openExternal (never inside Capri).
export function helpPanel(app, helpId, build) {
  const help = HELP_STEPS[helpId];
  if (!help) return null;
  const panel = build('div', 'appmenu__submenu appmenu__submenu--help');
  panel.dataset.help = helpId;
  panel.append(build('div', 'appmenu__submenu-title', help.title.toUpperCase()));
  if (help.note) panel.append(build('div', 'appmenu__hint', help.note));
  const list = build('ol', 'appmenu__help-list');
  const fillText = (parent, text) => {
    for (const part of splitHelpText(text)) {
      if (part.type === 'url') {
        const a = build('a', 'appmenu__help-link', part.value);
        a.href = part.value;
        a.rel = 'noopener noreferrer';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          app.host.menuAction({ id: 'open-url', value: part.value }).catch(() => {});
        });
        parent.append(a);
      } else {
        parent.append(document.createTextNode(part.value));
      }
    }
  };
  for (const step of help.steps) {
    const item = build('li', 'appmenu__help-step');
    if (typeof step === 'string') {
      fillText(item, step);
    } else {
      const line = build('div', '');
      fillText(line, step.text);
      item.append(line);
      const cmd = build('div', 'appmenu__help-cmd');
      const code = build('code', 'appmenu__help-code', step.command);
      // Command row may be a URL: same external open on click, plus COPIAR.
      if (/^https?:\/\//i.test(String(step.command || ''))) {
        code.classList.add('appmenu__help-link');
        code.setAttribute('role', 'link');
        code.tabIndex = 0;
        const openCmd = (e) => {
          e.preventDefault();
          e.stopPropagation();
          app.host.menuAction({ id: 'open-url', value: step.command }).catch(() => {});
        };
        code.addEventListener('click', openCmd);
        code.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') openCmd(e);
        });
      }
      cmd.append(code);
      const copy = build('button', 'appmenu__toggle-btn', 'COPIAR');
      copy.type = 'button';
      copy.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(step.command);
          copy.textContent = 'COPIADO';
          clearTimeout(copy.resetTimer);
          copy.resetTimer = setTimeout(() => { copy.textContent = 'COPIAR'; }, 1600);
        } catch { /* no clipboard: the command is still on screen */ }
      });
      cmd.append(copy);
      item.append(cmd);
    }
    list.append(item);
  }
  panel.append(list);
  return panel;
}
