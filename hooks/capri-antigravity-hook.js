#!/usr/bin/env node
'use strict';

// Antigravity hook -> Capri. Antigravity's payload has no hook_event_name, so the installer
// passes the event as the first argument. We only install notification-only events
// (PostToolUse, PostInvocation, Stop, SessionStart) so this hook can NEVER block tool calls.
// Always exits 0 — even on bad input or a missing bridge.

const { run } = require('./capri-forward');

const EVENTS = ['SessionStart', 'PostToolUse', 'PostInvocation', 'Stop'];

function base(evt) {
  return {
    session_id: evt.conversationId,
    cwd: Array.isArray(evt.workspacePaths) ? evt.workspacePaths[0] : undefined,
    transcript_path: evt.transcriptPath,
    model: evt.modelName,
    origin: 'antigravity',
  };
}

function antigravityMap(evt, name = process.argv[2]) {
  const common = base(evt || {});
  if (name === 'SessionStart') return { ...common, hook_event_name: 'SessionStart', source: 'startup' };
  if (name === 'PreToolUse') {
    return {
      ...common,
      hook_event_name: 'PreToolUse',
      tool_name: evt.toolCall?.name,
      tool_input: evt.toolCall?.args,
      tool_use_id: evt.stepIdx == null ? undefined : String(evt.stepIdx),
    };
  }
  if (name === 'PostToolUse') {
    return {
      ...common,
      hook_event_name: evt.error ? 'PostToolUseFailure' : 'PostToolUse',
      tool_name: evt.toolCall?.name,
      tool_input: evt.toolCall?.args,
      error: evt.error || undefined,
    };
  }
  // The first model call of a conversation is the user's prompt.
  if (name === 'PreInvocation') {
    return evt.invocationNum === 0 ? { ...common, hook_event_name: 'UserPromptSubmit' } : null;
  }
  if (name === 'Stop') {
    if (evt.error || evt.terminationReason === 'error') {
      return { ...common, hook_event_name: 'StopFailure', error: evt.error || evt.terminationReason };
    }
    return { ...common, hook_event_name: 'Stop', fully_idle: evt.fullyIdle };
  }
  return null;
}

if (require.main === module) {
  const name = process.argv[2] || '';
  run((evt) => antigravityMap(evt, name), () => {
    // Always emit valid JSON and exit 0: Capri never blocks Antigravity's tool calls.
    process.stdout.write(JSON.stringify({}) + '\n');
    process.exit(0);
  });
}

module.exports = { antigravityMap, EVENTS };
