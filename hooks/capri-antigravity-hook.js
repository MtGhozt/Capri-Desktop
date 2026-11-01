#!/usr/bin/env node
'use strict';

// Antigravity hook -> Capri. Antigravity's payload has no hook_event_name, so the installer
// passes the event as the first argument. Antigravity always expects valid JSON on stdout:
// PreToolUse and Stop get an explicit "allow", everything else an empty object.

const { run } = require('./capri-forward');

const EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'PreInvocation', 'PostInvocation', 'Stop'];

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
    const out = name === 'PreToolUse' || name === 'Stop' ? { decision: 'allow' } : {};
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(0);
  });
}

module.exports = { antigravityMap, EVENTS };
