export async function listCameras(){ return [{id:"0",name:"back"}]; }
export async function capturePhoto({cameraId,outPath}){ return outPath; }
export async function postProcess({path,maxWidth,quality}){ return {path,width:0,height:0,bytes:1024}; }
