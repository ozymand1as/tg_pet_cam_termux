export function hasBinary(n){ try{ return true; } catch{ return false; } }
export async function termuxCameraInfo(){ return [{id:"0",facing:"back"}]; }
export async function termuxCameraPhoto({cameraId,outPath,timeoutMs=20000}){ return new Promise((res,rej)=>res()); }
export async function termuxWakeLock(){ return true; }
export async function termuxWakeUnlock(){}
export function termuxIsForeground(){ return true; }
export async function termuxSetupStorage(){}
