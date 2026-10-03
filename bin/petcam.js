#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load cli exports (ESM) — if user passes 'web', dispatch to web module directly
const args = process.argv.slice(2);
if (args[0] === 'web') {
  const w = await import(resolve(__dirname, '..', 'src', 'web.js'));
  w.start(args.includes('--port') ? parseInt(args[args.indexOf('--port')+1]) : 8765);
} else {
  await import(resolve(__dirname, '..', 'src', 'cli.js'));
  console.log('petcam command:', args[0] || '(none)');
}
