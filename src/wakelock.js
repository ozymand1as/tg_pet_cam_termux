export class WakeLockKeeper {
  constructor({onChange}){ this.onChange=onChange; this.active=false; }
  async enable(){ this.active=true; if(this.onChange) this.onChange('active'); return true; }
  async disable(){ this.active=false; if(this.onChange) this.onChange('off'); }
  isActive(){ return this.active; }
}
