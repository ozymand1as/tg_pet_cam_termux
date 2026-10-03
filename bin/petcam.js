#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Delegate to cli module (ESM); resolve relative to this file so PETCAM_DIR copy works
await import(resolve(__dirname, '..', 'src', 'cli.js'));
