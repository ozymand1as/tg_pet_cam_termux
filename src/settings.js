import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
const SETTINGS_PATH = join(homedir(), '.petcam', 'settings.json');
export async function loadSettings() { try { return JSON.parse(await readFile(SETTINGS_PATH,'utf8')); } catch { return { version:2 }; } }
export async function saveSettings(s) { await mkdir(dirname(SETTINGS_PATH),{recursive:true}); await writeFile(SETTINGS_PATH,JSON.stringify(s,null,2)+'\n',{mode:0o600}); }
