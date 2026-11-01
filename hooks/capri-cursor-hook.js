#!/usr/bin/env node
'use strict';

// Cursor hook -> Capri. Cursor uses camelCase event names and its permission hooks block on
// invalid JSON, so always print a valid answer: "allow" for the permission hooks, {} for the
// rest. Never deny anything on Capri's behalf.

const { run } = require('./capri-forward');

const EVENTS = [
  'sessionStart', 'sessionEnd', 'beforeSubmitPrompt',
  'preToolUse', 'postToolUse', 'postToolUseFailure',
  'beforeShellExecution', 'afterShellExecution',
  'beforeMCPExecution', 'afterMCPExecution',
  'beforeReadFile', 'afterFileEdit',
  'subagentStart', 'subagentStop', 'preCompact', 'stop',
];

const PERMISSION = new Set(['preToolUse', 'beforeShellExecution', 'beforeMCPExecution', 'beforeReadFile', 'subagentStart']);

function base(evt) {
  return {
    session_id: evt.conversation_id,
    cwd: evt.cwd || (Array.isArray(evt.workspace_roots) ? evt.workspace_roots[0] : undefined),
    transcript_path: evt.transcript_path,
    model: evt.model,
    origin: 'cursor',
  };
}

function cursorMap(evt) {
  const name = evt?.hook_event_name;
  const common = base(evt || {});
  switch (name) {
    case 'sessionStart':
      return { ...common, hook_event_name: 'SessionStart', source: 'startup' };
    case 'sessionEnd':
      return { ...common, hook_event_name: 'SessionEnd', reason: evt.reason };
    case 'beforeSubmitPrompt':
      return { ...common, hook_event_name: 'UserPromptSubmit', prompt: evt.prompt || evt.user_message || '' };
    case 'preToolUse':
    case 'postToolUse':
      return {
        ...common,
        hook_event_name: name === 'preToolUse' ? 'PreToolUse' : 'PostToolUse',
        tool_name: evt.tool_name,
        tool_input: evt.tool_input,
        tool_use_id: evt.tool_use_id,
      };
    case 'postToolUseFailure':
      return {
        ...common,
        hook_event_name: 'PostToolUseFailure',
        tool_name: evt.tool_name,
        tool_input: evt.tool_input,
        error: evt.error_message,
        is_interrupt: evt.is_interrupt,
      };
    case 'beforeShellExecution':
    case 'afterShellExecution':
      return {
        ...common,
        hook_event_name: name === 'beforeShellExecution' ? 'PreToolUse' : 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: evt.command, cwd: evt.cwd },
      };
    case 'beforeMCPExecution':
    case 'afterMCPExecution':
      return {
        ...common,
        hook_event_name: name === 'beforeMCPExecution' ? 'PreToolUse' : 'PostToolUse',
        tool_name: evt.tool_name || 'MCP',
        tool_input: evt.tool_input,
      };
    case 'beforeReadFile':
      return {
        ...common,
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: evt.file_path || evt.path },
      };
    case 'afterFileEdit':
      return {
        ...common,
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: evt.file_path || evt.path },
      };
    case 'subagentStart':
      return { ...common, hook_event_name: 'SubagentStart', agent_type: evt.subagent_type, agent_id: evt.subagent_id };
    case 'subagentStop':
      return {
        ...common,
        hook_event_name: 'SubagentStop',
        agent_type: evt.subagent_type,
        agent_id: evt.subagent_id,
        last_assistant_message: evt.summary,
      };
    case 'preCompact':
      return { ...common, hook_event_name: 'PreCompact' };
    case 'stop':
      return {
        ...common,
        hook_event_name: 'Stop',
        last_assistant_message: evt.last_assistant_message || evt.summary || '',
      };
    default:
      return null;
  }
}

if (require.main === module) {
  let name = '';
  run((evt) => {
    name = evt?.hook_event_name || '';
    return cursorMap(evt);
  }, () => {
    const out = PERMISSION.has(name) ? { permission: 'allow' } : {};
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(0);
  });
}

module.exports = { cursorMap, EVENTS, PERMISSION };
