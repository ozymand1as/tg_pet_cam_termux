#!/usr/bin/env node
const path = require('path');
const args = process.argv.slice(2);
if (args[0] === 'web') {
  const w = require(path.resolve(__dirname, '..', 'src', 'web.js'));
  w.start(args.includes('--port') ? parseInt(args[args.indexOf('--port')+1]) : 8765);
} else {
  // Load cli exports (CJS stub); for now just show command
  console.log('petcam:', args[0] || 'no command');
}
