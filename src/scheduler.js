export class AutoUploadScheduler {
  constructor({onDue}){ this.onDue=onDue; this.intervalMs=60000; this.nextAt=null; this._busy=false; }
  start(s){ this.intervalMs=s*1000; this.nextAt=Date.now()+this.intervalMs; this._t=setInterval(()=>this._tick(),1000); }
  stop(){ clearInterval(this._t); this.nextAt=null; }
  setInterval(s){ if(this._t) this.intervalMs=s*1000; }
  isRunning(){ return !!this._t; }
  secondsUntilNext(){ return this.nextAt?Math.max(0,Math.round((this.nextAt-Date.now())/1000)):null; }
  _tick(){ if(!this.nextAt||this._busy) return; if(Date.now()<this.nextAt) return; this.nextAt=Date.now()+this.intervalMs; this._busy=true; Promise.resolve(this.onDue()).catch(()=>{}).finally(()=>this._busy=false); }
}
