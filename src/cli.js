export const colors = { ok: s=>s, warn: s=>s, err: s=>s, dim: s=>s, bold: s=>s, cyan: s=>s, green: s=>s, yellow: s=>s, red: s=>s };
export async function prompt(q,{default:d,validate}={}){ return d||''; }
export async function promptPassword(q){ return ''; }
export async function confirm(q,{default:d}={}){ return !!d; }
export async function choose(q,opts){ return opts[0].value; }
export async function withSpinner(l,fn){ return await fn(); }
export function log(l,m){ console.error(`[${l}] ${m}`); }
export function status(msg){ console.error(msg); }
export function clearStatus(){}
export function banner(t){ console.log(t); }
export function table(r){ r.forEach(x=>console.log(x.join(' \t'))); }
export function die(msg,c=1){ console.error(msg); process.exit(c); }
// CLI entry: if called directly (require/run), dispatch web/setup commands
if (require.main === module || (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].includes('petcam'))) {
  const args = process.argv.slice(2);
  if (args[0] === 'web') { const w = require('./web.js'); w.start(args.includes('--port') ? parseInt(args[args.indexOf('--port')+1]) : 8765); }
  else if (args[0] === 'setup') console.log('setup stub');
  else console.log('petcam:', args[0] || 'no command');
}
