import { voiceRefMissing } from '../util.js';
import { REPLY_OPTIONS } from './widgets.js';

export function fixPanel(menu, hearing, build) {
    const panel = build('div', 'appmenu__fix');
    const last = String(hearing.lastHeard || '');
    const heardLine = build('div', 'appmenu__fix-last');
    heardLine.append(
      build('span', 'appmenu__meta', 'OYÓ'),
      build('span', 'appmenu__fix-said', last ? `«${last}»` : 'Todavía no oyó nada.'),
    );
    const field = (label, value, placeholder) => {
      const wrap = build('label', 'appmenu__fix-field');
      const input = build('input', 'appmenu__input');
      input.type = 'text';
      input.value = value;
      input.placeholder = placeholder;
      input.maxLength = 60;
      input.spellcheck = false;
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          menu.onEscape();
        }
      });
      wrap.append(build('span', 'appmenu__fix-label', label), input);
      return { wrap, input };
    };
    const heard = field('Lo que oyó', last, 'la palabra que entendió mal');
    const meant = field('Lo que quise decir', '', 'cómo se lee');
    const saveBtn = build('button', 'appmenu__toggle-btn appmenu__fix-save is-active', 'GUARDAR');
    saveBtn.type = 'button';
    saveBtn.dataset.state = 'on';
    const note = build('span', 'appmenu__meta', menu.fixNote);
    const save = async () => {
      const h = heard.input.value.trim();
      const m = meant.input.value.trim();
      if (!h || !m) {
        (h ? meant : heard).input.focus();
        return;
      }
      await menu.host.menuAction({ id: 'fix-add', value: { heard: h, meant: m } });
      menu.fixNote = 'GUARDADO';
      await menu.refresh();
    };
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      save();
    });
    const actions = build('div', 'appmenu__fix-actions');
    actions.append(note, saveBtn);
    panel.append(heardLine, heard.wrap, meant.wrap, actions);

    const list = build('div', 'appmenu__fix-list');
    if (!hearing.fixes.length) list.append(build('span', 'appmenu__meta', 'SIN CORRECCIONES'));
    for (const fix of hearing.fixes) {
      const row = build('div', 'appmenu__row appmenu__row--sub appmenu__fix-item');
      row.append(build('span', 'appmenu__label', `${fix.heard} → ${fix.meant}`));
      const drop = build('button', 'appmenu__arrow', '✕');
      drop.type = 'button';
      drop.title = 'Borrar';
      drop.setAttribute('aria-label', `Borrar ${fix.heard}`);
      drop.addEventListener('click', async (e) => {
        e.stopPropagation();
        await menu.host.menuAction({ id: 'fix-remove', value: fix.heard });
        menu.fixNote = 'BORRADO';
        await menu.refresh();
      });
      row.append(drop);
      list.append(row);
    }
    panel.append(list);
    // the field to type in: what you meant when she heard something, else what she heard
    const first = last ? meant.input : heard.input;
    requestAnimationFrame(() => first.focus());
    setTimeout(() => first.focus(), 80);
    return panel;
  }


export function sensitivityRow(menu, hearing, build) {
    const wrap = build('div', 'appmenu__slider-wrap');
    const row = build('div', 'appmenu__row');
    const value = build('span', 'appmenu__meta appmenu__slider-value', `${hearing.sensitivity} %`);
    row.append(build('span', 'appmenu__label', 'Sensibilidad'), value);
    const range = build('input', 'appmenu__slider');
    range.type = 'range';
    range.min = String(hearing.sensMin ?? 10);
    range.max = String(hearing.sensMax ?? 90);
    range.step = String(hearing.sensStep ?? 5);
    range.value = String(hearing.sensitivity ?? 20);
    range.setAttribute('aria-label', 'Sensibilidad de la palabra de activación');
    const paint = () => {
      const lo = Number(range.min);
      const pct = ((Number(range.value) - lo) / (Number(range.max) - lo)) * 100;
      range.style.setProperty('--fill', `${pct}%`);
      value.textContent = `${range.value} %`;
    };
    range.addEventListener('input', paint);
    range.addEventListener('change', () => {
      hearing.sensitivity = Number(range.value);
      menu.host.menuAction({ id: 'wake-sensitivity', value: Number(range.value) }).catch(() => {});
    });
    for (const type of ['mousedown', 'click']) range.addEventListener(type, (e) => e.stopPropagation());
    paint();
    const phrase = hearing.wakePhrase || 'hey Capri';
    wrap.append(row, range, build('div', 'appmenu__hint', `Más alto: menos falsas alarmas, pero hay que decir «${phrase}» más claro.`));
    return wrap;
  }

  // Push to talk: the combo, and a way to change it (the next combo you press; Esc cancels).

export function talkKeyRow(menu, hearing, build, kbd) {
    const wrap = build('div', 'appmenu__talkkey');
    const row = build('button', 'appmenu__row appmenu__row--action');
    row.type = 'button';
    const talkLabel = build('span', 'appmenu__label appmenu__label--help');
    talkLabel.append(build('span', '', 'Tecla para hablar'), menu.helpButton('talk'));
    row.append(talkLabel);
    if (menu.capturingId === 'talk') row.append(build('span', 'appmenu__meta appmenu__capture', 'PULSA LA COMBINACIÓN…'));
    else if (hearing.talkHotkey) row.append(kbd(hearing.talkHotkey));
    row.append(build('span', 'appmenu__meta', menu.capturingId === 'talk' ? 'ESC' : 'CAMBIAR'));
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.capturingId = menu.capturingId === 'talk' ? null : 'talk';
      menu.talkNote = '';
      menu.shortcutNote = '';
      menu.rerender();
    });
    wrap.append(row);
    const note = menu.capturingId === 'talk' ? 'Ctrl, Alt o Win más una tecla. Esc cancela.'
      : menu.talkNote || (hearing.talkActive ? '' : 'No se pudo registrar: elige otra combinación.');
    if (note) wrap.append(build('div', 'appmenu__hint', note));
    return wrap;
  }

export function render(menu, state, ctx) {
  const { cfg } = state;
  const { section, toggle, selector, action, body, build, kbd } = ctx;
      // AUDIO
      section('AUDIO', 'hearing');
      toggle('Micrófono', { on: cfg.mic, labels: ['MUTEADO', 'ACTIVO'], onChange: (on) => menu.act('mic', on) });
      const devices = [
        { id: null, label: 'Predeterminado' },
        ...(state.micDevices || []).map((d) => ({ id: d.id, label: d.name })),
      ];
      selector('Dispositivo de entrada', {
        options: devices,
        current: cfg.micDevice,
        onChange: (id) => menu.act('mic-device', id),
      });
      selector('Sensibilidad de la palabra', {
        options: [
          { id: 'low', label: 'BAJA' },
          { id: 'normal', label: 'NORMAL' },
          { id: 'high', label: 'ALTA' },
        ],
        current: String(cfg.wakeSensitivity || 'normal'),
        onChange: (id) => menu.act('wake-level', id),
        help: 'wake',
      });
      selector('Respuesta', {
        options: REPLY_OPTIONS,
        current: String(cfg.replyMode || 'blips'),
        onChange: (id) => menu.act('reply-mode', id),
        help: 'voice',
      });
      const voice = cfg.voice || { dir: '', status: '' };
      action('Carpeta de voz', {
        help: 'voice',
        value: String(voice.dir || '').split(/[\\/]/).filter(Boolean).pop() || 'SIN CARPETA',
        onClick: async () => {
          const res = await menu.host.menuAction({ id: 'voice-dir' }).catch(() => ({ ok: false, message: 'No se pudo.' }));
          menu.voiceNote = res?.message || '';
          await menu.refresh();
        },
      });
      const install = menu.voiceInstall || state.voiceInstall || {};
      const installBusy = Boolean(install.busy);
      const hasNvidia = Boolean(install.hasNvidia);
      const omniChecked = menu.voiceOmni == null ? hasNvidia : Boolean(menu.voiceOmni);
      const installRow = build('div', 'appmenu__voice-install');
      const installBtns = build('div', 'appmenu__voice-install-btns');
      const installed = Boolean(voice.installed || install.installed);
      const installBtn = build(
        'button',
        `appmenu__toggle-btn is-active${installBusy ? ' is-busy' : ''}`,
        installBusy ? 'Instalando…'
          : install.phase === 'error' ? 'Reintentar'
            : installed ? 'Voz ya instalada ✓'
              : 'Instalar voz',
      );
      installBtn.type = 'button';
      installBtn.dataset.state = 'on';
      installBtn.disabled = installBusy;
      installBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        menu.voiceNote = '';
        menu.voiceInstall = { ...(menu.voiceInstall || {}), busy: true, phase: 'download', label: 'Descargando…', lines: [] };
        menu.render(menu.lastState);
        const res = await menu.host.menuAction({
          id: 'voice-install',
          value: { omniVoice: omniChecked },
        }).catch((err) => ({ ok: false, message: err?.message || 'No se pudo.' }));
        menu.voiceNote = res?.message || (res?.ok ? 'Voz instalada' : '');
        if (res?.needPython) {
          menu.voiceInstall = {
            ...(menu.voiceInstall || {}),
            busy: false,
            phase: 'error',
            label: 'Error',
            needPython: true,
            error: res.message,
            lines: [res.message].filter(Boolean),
          };
        }
        await menu.refresh();
      });
      const cancelBtn = build('button', 'appmenu__toggle-btn', 'Cancelar');
      cancelBtn.type = 'button';
      cancelBtn.disabled = !installBusy;
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.host.menuAction({ id: 'voice-install-cancel' }).catch(() => {});
      });
      installBtns.append(installBtn, cancelBtn);
      if (installed && !installBusy) {
        const reinstall = build('button', 'appmenu__toggle-btn', 'Reinstalar');
        reinstall.type = 'button';
        reinstall.addEventListener('click', (e) => installBtn.click(e));
        installBtns.append(reinstall);
      }
      installRow.append(installBtns);
      if (!hasNvidia) {
        const omni = build('label', 'appmenu__voice-omni');
        const box = build('input', '');
        box.type = 'checkbox';
        box.checked = omniChecked;
        box.disabled = installBusy;
        box.addEventListener('change', () => {
          menu.voiceOmni = box.checked;
        });
        omni.append(box, document.createTextNode(' OmniVoice (mejor con GPU NVIDIA)'));
        installRow.append(omni);
      } else {
        installRow.append(build('div', 'appmenu__hint', 'GPU NVIDIA detectada: se instala OmniVoice.'));
      }
      if (state.vcMissing || install.needVc) {
        const vcRow = build('div', 'appmenu__voice-install-btns');
        const vcBtn = build('button', 'appmenu__toggle-btn is-active', 'Instalar VC++ x64');
        vcBtn.type = 'button';
        vcBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.host.menuAction({ id: 'open-vc' }).catch(() => {});
        });
        vcRow.append(vcBtn);
        installRow.append(build('div', 'appmenu__hint', state.vcMessage || 'Falta Microsoft Visual C++ Redistributable (x64).'), vcRow);
      }
      if (install.needPython || (install.phase === 'error' && /Python 3\.11/i.test(String(install.error || menu.voiceNote || '')))) {
        const pyRow = build('div', 'appmenu__voice-install-btns');
        const pyBtn = build('button', 'appmenu__toggle-btn is-active', 'Bajar Python 3.11');
        pyBtn.type = 'button';
        pyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.host.menuAction({ id: 'open-python' }).catch(() => {});
        });
        pyRow.append(pyBtn);
        installRow.append(build('div', 'appmenu__hint', install.error || menu.voiceNote || 'Falta Python 3.11.'), pyRow);
      }
      if (install.label || installBusy) {
        const progress = build('div', 'appmenu__voice-progress');
        progress.append(build('div', 'appmenu__voice-progress-label', install.label || (installBusy ? 'Descargando…' : '')));
        const bar = build('div', 'appmenu__voice-progress-bar');
        const fill = build('span');
        const pct = Number(install.progress);
        fill.style.width = Number.isFinite(pct)
          ? `${Math.max(0, Math.min(100, pct))}%`
          : install.phase === 'done' ? '100%' : install.phase === 'install' ? '70%' : '35%';
        bar.append(fill);
        progress.append(bar);
        installRow.append(progress);
      }
      if (Array.isArray(install.lines) && install.lines.length) {
        const detailsRow = build('div', 'appmenu__voice-install-btns');
        const details = build('button', 'appmenu__toggle-btn', menu.voiceDetails ? 'Ocultar detalles' : 'Ver detalles');
        details.type = 'button';
        details.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.voiceDetails = !menu.voiceDetails;
          menu.render(menu.lastState);
        });
        detailsRow.append(details);
        if (menu.voiceDetails) {
          const copy = build('button', 'appmenu__toggle-btn', 'Copiar detalles');
          copy.type = 'button';
          copy.addEventListener('mousedown', (e) => e.preventDefault());
          copy.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(install.lines.join('\n'));
              copy.textContent = 'Copiado';
              clearTimeout(copy.resetTimer);
              copy.resetTimer = setTimeout(() => { copy.textContent = 'Copiar detalles'; }, 1600);
            } catch { /* no clipboard: the text below is selectable */ }
          });
          detailsRow.append(copy);
        }
        installRow.append(detailsRow);
        if (menu.voiceDetails) installRow.append(build('pre', 'appmenu__voice-log', install.lines.join('\n')));
      }
      body.append(installRow);
      const voiceSource = voice.source || voice.ttsSourceName
        || (String(voice.ttsRef || '').trim() ? `Tu voz (${String(voice.ttsRef).split(/[\\/]/).pop()})` : 'Voz por defecto');
      body.append(build('div', 'appmenu__hint appmenu__voice-source', `Voz activa: ${voiceSource}`));
      if (voice.tts?.state === 'fallback') {
        body.append(build('div', 'appmenu__hint', 'Uso la voz normal: tu clon no cargó (el motivo está en el log).'));
      }
      if (menu.voiceRefForm) {
        const form = build('div', 'appmenu__voice-ref');
        form.append(build('div', 'appmenu__hint', '1) Elegí tu audio .wav (5–15 s)'));
        form.append(build('div', 'appmenu__hint', menu.pendingRefWav
          ? `Archivo: ${String(menu.pendingRefWav).split(/[\\/]/).pop()}`
          : 'Ningún audio elegido todavía.'));
        form.append(build('div', 'appmenu__hint', '2) Qué dice el audio (palabra por palabra)'));
        const transcript = build('textarea', 'appmenu__input appmenu__voice-text');
        transcript.rows = 3;
        transcript.placeholder = 'Qué dice el audio (palabra por palabra)';
        transcript.value = menu.pendingRefText || '';
        transcript.maxLength = 500;
        transcript.spellcheck = true;
        const missing = build('div', 'appmenu__hint appmenu__voice-missing');
        let saveRef;
        const syncSave = () => {
          const reason = voiceRefMissing({ wav: menu.pendingRefWav, transcript: transcript.value });
          if (saveRef) saveRef.disabled = Boolean(reason);
          missing.textContent = reason;
          missing.hidden = !reason;
        };
        transcript.addEventListener('input', () => {
          menu.pendingRefText = transcript.value;
          syncSave();
        });
        const loadTxt = build('button', 'appmenu__toggle-btn', 'Cargar .txt');
        loadTxt.type = 'button';
        loadTxt.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await menu.host.menuAction({ id: 'voice-ref-text' }).catch(() => null);
          if (!res?.ok || !res.transcript) return;
          transcript.value = res.transcript;
          menu.pendingRefText = res.transcript;
          syncSave();
        });
        saveRef = build('button', 'appmenu__toggle-btn is-active', 'GUARDAR VOZ');
        saveRef.type = 'button';
        saveRef.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await menu.host.menuAction({
            id: 'voice-ref-save',
            value: {
              path: menu.pendingRefWav,
              transcript: transcript.value,
              transcriptPath: menu.pendingRefTranscriptPath,
            },
          }).catch(() => ({ ok: false, message: 'No se pudo.' }));
          menu.voiceNote = res?.message || '';
          if (res?.ok) {
            menu.voiceRefForm = false;
            menu.pendingRefWav = '';
            menu.pendingRefText = '';
            menu.pendingRefTranscriptPath = '';
          }
          await menu.refresh();
        });
        const cancelRef = build('button', 'appmenu__toggle-btn', 'CANCELAR');
        cancelRef.type = 'button';
        cancelRef.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.voiceRefForm = false;
          menu.pendingRefWav = '';
          menu.pendingRefText = '';
          menu.pendingRefTranscriptPath = '';
          menu.render(menu.lastState);
        });
        const txtRow = build('div', 'appmenu__voice-install-btns');
        txtRow.append(loadTxt);
        const refBtns = build('div', 'appmenu__voice-install-btns');
        refBtns.append(saveRef, cancelRef);
        form.append(transcript, txtRow, missing, refBtns);
        form.append(build('div', 'appmenu__hint appmenu__voice-saved-in',
          `Se guarda en: ${String(voice.dir || '').trim() || 'la carpeta de voz'}`));
        body.append(form);
        syncSave();
      } else {
        const refRow = build('div', 'appmenu__voice-install-btns');
        const custom = String(voice.ttsRef || '').trim();
        const useMine = build('button', `appmenu__toggle-btn${custom ? ' is-active' : ''}`,
          custom ? `${voice.source || 'Tu voz'} ✓` : 'Usar mi propia voz…');
        useMine.type = 'button';
        useMine.dataset.state = custom ? 'on' : 'off';
        useMine.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await menu.host.menuAction({ id: 'voice-ref-pick' }).catch(() => null);
          if (!res?.ok || !res.path) return;
          menu.pendingRefWav = res.path;
          menu.pendingRefTranscriptPath = res.transcriptPath || '';
          menu.pendingRefText = res.transcript || '';
          menu.voiceRefForm = true;
          menu.render(menu.lastState);
        });
        refRow.append(useMine);
        const clear = build('button', `appmenu__toggle-btn${custom ? '' : ' is-active'}`,
          custom ? 'Voz por defecto' : 'Voz por defecto ✓');
        clear.type = 'button';
        clear.dataset.state = custom ? 'off' : 'on';
        clear.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await menu.host.menuAction({ id: 'voice-ref-clear' }).catch(() => null);
          menu.voiceNote = res?.message || 'Voz por defecto.';
          await menu.refresh();
        });
        refRow.append(clear);
        body.append(refRow);
      }
      body.append(build(
        'div',
        'appmenu__hint',
        menu.voiceNote || voice.dir || 'Instalá la voz con un clic, o elegí una carpeta con server.py y setup.ps1.',
      ));
      if (voice.status) body.append(build('div', 'appmenu__hint', voice.status));

    section('OÍDO Y VOZ', 'hearing');
  const hearing = state.hearing || { fixes: [], lastHeard: '' };
  action('Corregir lo último', {
    value: hearing.fixes.length ? `${hearing.fixes.length} CORRECCIONES` : '',
    chevron: 'fixes',
    onClick: () => menu.toggle('fixes', state),
  });
  if (menu.expanded === 'fixes') body.append(fixPanel(menu, hearing, build));
  body.append(sensitivityRow(menu, hearing, build));
  body.append(talkKeyRow(menu, hearing, build, kbd));
  selector('Pausa antes de cortar', {
    options: [
      { id: 'short', label: 'CORTA · 0.8 s' },
      { id: 'normal', label: 'NORMAL · 1.4 s' },
      { id: 'long', label: 'LARGA · 2.2 s' },
    ],
    current: String(hearing.pauseBeforeCut || 'normal'),
    onChange: (id) => menu.act('pause-before-cut', id),
    help: 'talk',
  });

}
