// host.onVoice, chat token/done/error, llm boot status, and gamepad push-to-talk.

import { redactSecrets } from '../redact-keys.js';
import { startGamepadPtt } from '../gamepad-ptt.js';

export function wireVoiceEvents({
  host,
  config,
  bubble,
  panel,
  machine,
  bumpIdle,
  unfold,
}) {
  const applyBoot = (state) => {
    // a cloud provider answers, so whether LM Studio came up is nobody's business here (Paso 4K)
    if (config.llm?.provider && config.llm.provider !== 'local') return;
    bubble.setBoot(state);
    if (machine.get() === 'DORMANT') return;
    if (state === 'booting') {
      panel.say({ kind: 'info', badge: 'BOOTING', line: 'Spinning up the local stack. Hold still, choom.', hold: null });
    } else if (state === 'failed') {
      panel.say({
        kind: 'error',
        badge: 'BOOTING',
        line: "Couldn't wake LM Studio. Fire it yourself if you want a brain.",
        hold: 7000,
      });
    } else if (panel.current?.badge === 'BOOTING') {
      panel.hide();
    }
  };
  host.llmStatus().then(applyBoot);
  host.onLlmBoot((payload) => applyBoot(payload?.state || payload));

  host.onChatToken((piece) => {
    bumpIdle();
    bubble.onToken(typeof piece === 'string' ? piece : piece?.text || '');
  });
  host.onChatDone((payload) => bubble.onDone(payload?.text || ''));
  host.onChatError((payload) => bubble.onError(payload));
  host.onVoice(async (evt) => {
    const type = evt?.type;
    if (type === 'listening') {
      bubble.abortForListen();
      bumpIdle();
      await unfold({ chat: true, source: 'wake' });
      machine.set('LISTENING');
      bubble.setMeter(true);
      if (evt.wake || evt.score != null) {
        const pct = Math.round(Number(evt.score) || 0);
        bubble.note('despierta', `${pct} %`);
      }
      return;
    }
    if (type === 'level') {
      bumpIdle();
      if (bubble.voicePlaying) bubble.voiceAt = Date.now();
      bubble.setLevel(evt.rms);
      return;
    }
    if (type === 'stopped') {
      bubble.setMeter(false);
      if (machine.get() === 'LISTENING' && !bubble.busy) machine.set('ONLINE');
      return;
    }
    if (type === 'transcript') {
      bumpIdle();
      await unfold({ chat: true, source: 'wake' });
      bubble.submitFromVoice(evt.text, evt.command, { turn: evt.turn, stt: evt.stt });
      return;
    }
    if (type === 'talking') {
      bumpIdle();
      clearTimeout(bubble.voiceTimer);
      bubble.voiceTimer = 0;
      bubble.stopThink();
      bubble.voicePlaying = true;
      bubble.voiceAt = Date.now();
      machine.set('TALKING');
      bubble.onTalk?.(true);
      return;
    }
    if (type === 'talking_done') {
      clearTimeout(bubble.voiceTimer);
      bubble.voiceTimer = 0;
      bubble.voicePlaying = false;
      bubble.onTalk?.(false);
      bumpIdle();
      if (evt?.crashed) { // her voice died mid-line: nothing more is coming, back to ONLINE
        if (['TALKING', 'THINKING', 'LISTENING'].includes(machine.get()) && !bubble.busy) machine.set('ONLINE');
        return;
      }
      if (evt?.interrupted) {
        bubble.abortForListen();
        if (machine.get() === 'TALKING' || machine.get() === 'THINKING') machine.set('ONLINE');
        return;
      }
      if (machine.get() === 'LISTENING') return;
      if ((machine.get() === 'TALKING' || machine.get() === 'THINKING') && !bubble.busy) {
        machine.set('ONLINE');
      }
      return;
    }
    if (type === 'tts_state') {
      const downloading = evt.state === 'downloading';
      bubble.setVoiceLoading(
        evt.state === 'loading' || downloading,
        evt.progress,
        downloading ? 'Descargando voz (solo la primera vez, puede tardar varios minutos)' : null,
      );
      return;
    }
    if (type === 'notice') {
      bubble.holdVoice = false;
      bumpIdle();
      await unfold();
      const line = redactSecrets(evt.message || 'Voice sidecar is offline. Chat still works.');
      const kind = evt.level === 'info' ? 'info' : 'error';
      bubble.note('sistema', line);
      const prevAction = panel.onAction;
      const actions = [];
      if (evt.url) actions.push({ id: 'open-url', label: 'Descargar e instalar', primary: true });
      if (kind === 'error') actions.push({ id: 'copy-error', label: 'Copiar error' });
      panel.say({
        kind,
        badge: evt.badge || 'VOICE',
        line,
        hold: actions.length ? null : 10000,
        actions: actions.length ? actions : undefined,
        ...(kind === 'info' ? { face: 'calm' } : {}),
      });
      if (actions.length) {
        panel.onAction = (id) => {
          if (id === 'open-url') {
            host.menuAction({ id: 'open-vc' }).catch(() => {});
            panel.onAction = prevAction;
            panel.hide();
            return;
          }
          if (id === 'copy-error') {
            host.menuAction({ id: 'copy-error', value: line }).catch(() => {});
            panel.onAction = prevAction;
            return;
          }
          prevAction?.(id);
        };
      }
    }
  });

  // Gamepad LB+RB (configurable) = push-to-talk while a pad is connected.
  startGamepadPtt({
    getCombo: () => config.gaming?.gamepadPtt || [6, 7],
    onStart: () => host.pttStart?.(),
    onStop: () => host.pttStop?.(),
  });
}
