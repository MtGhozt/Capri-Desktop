#!/usr/bin/env node
'use strict';

// Claude Code hook -> Capri.
// Reads the hook event on stdin and forwards a trimmed copy to the Capri app.
// Rule #1: never get in Claude's way. No output, always exit 0, give up fast.

const { run } = require('./capri-forward');

run((evt) => ({ ...evt, origin: 'claude' }), () => process.exit(0));
