#!/usr/bin/env node
'use strict';

// Codex hook -> Capri. Codex's event names already match Claude's almost one to one; the
// two exceptions are PermissionRequest (Capri shows it as a permission notification) and
// Interrupt (Capri shows it as an interrupted tool). Codex wants JSON on stdout, so print
// an empty object: it means "no decision" and never blocks the agent.

const { run } = require('./capri-forward');

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Interrupt',
];

function codexMap(evt) {
  const name = evt?.hook_event_name;
  if (!name) return null;
  if (name === 'PermissionRequest') {
    return {
      ...evt,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: evt.tool_input?.description || evt.message || 'Codex needs permission',
    };
  }
  if (name === 'Interrupt') {
    return { ...evt, hook_event_name: 'PostToolUseFailure', tool_name: 'Codex', is_interrupt: true };
  }
  return evt;
}

if (require.main === module) {
  run(codexMap, () => {
    process.stdout.write('{}\n');
    process.exit(0);
  });
}

module.exports = { codexMap, EVENTS };
