export const commands = ['photo','video','run','start','stop','status','test','setup','doctor','config','forget','version','update','help'];
export let isSending = false;
export function renderCaption(t,now=new Date()){ const p=n=>String(n).padStart(2,'0'); return t.replaceAll('{datetime}',`${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`).slice(0,1024); }
photo command wiring
