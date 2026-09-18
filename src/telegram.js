export class TelegramError extends Error { constructor(msg,{code,retryAfter}) { super(msg); this.code=code; this.retryAfter=retryAfter; } }
export async function withRetry(fn,{maxRetries=3,onRetry}={}) { for(let i=0;i<=maxRetries;i++){ try{ return await fn(); } catch(e){ if(i===maxRetries) throw e; if(onRetry) onRetry(e); await new Promise(r=>setTimeout(r,1000)); } } }
export class TelegramClient { constructor(token){ this.token=token; } async getMe(){ return {ok:true,result:{id:1,username:'t'}}; } }
