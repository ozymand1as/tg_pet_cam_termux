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
